import {
  BORDER_VIEW, HOST_LINK_LIMITS, LAYERS, LinkGuard, OPS_PER_MESSAGE, RELAY_FLUSH_MS, distToZone, opPoint,
  type NeighbourHost, type Op, type PlayerEntry, type PlayerInfo, type PlayerPos, type SignalData, type ZoneId,
} from '@terra/shared';
import { Peer } from './peer.ts';

/** Redial a dropped border link after this long, if the neighbour is still listed. */
const REDIAL_MS = 2000;

/** A player this host is the authority for, with the number its snapshots use for it. */
export interface LocalPlayer {
  info: PlayerInfo;
  n: number;
  x: number;
  y: number;
}

interface Link {
  hostId: string;
  /** The neighbour's zone, once the directory has listed it. */
  zone: ZoneId | null;
  peer: Peer;
  initiator: boolean;
  /** The neighbour's players by the neighbour's number for them, as it last told us. */
  roster: Map<number, PlayerInfo>;
  /** Players it last said were near our zone, and when. */
  visible: number;
  edgeT: number;
  /** World-scope ops waiting to go to it: sent together a few times a second, so they fit its message budget. */
  queue: Op[];
}

/** One border link, for the debug panel. */
export interface BorderDebug {
  zone: ZoneId | null;
  hostId: string;
  open: boolean;
  visible: number;
  edgeAgeMs: number | null;
}

/**
 * A zone host's links to the hosts of neighbouring zones. Each pair of
 * neighbours shares one link (the lower peer id dials), over which each side
 * sends the players it hosts that are within BORDER_VIEW of the other's zone.
 * That stream is per zone; the receiving host then shows each of its players
 * only the ones within that player's own view.
 */
export class BorderLinks {
  private links = new Map<string, Link>();
  /** hostId -> zone, from the latest directory listing. */
  private wanted = new Map<string, ZoneId>();
  private redial = new Map<string, ReturnType<typeof setTimeout>>();
  private rosterKey = '';
  private roster: PlayerEntry[] = [];
  private flushT = 0;

  private readonly selfId: string;
  private readonly iceServers: RTCIceServer[];
  private readonly sendSignal: (to: string, data: SignalData) => void;
  private readonly onPlayer: (info: PlayerInfo, x: number, y: number) => void;
  private readonly onOps: (ops: unknown, from: string) => void;

  constructor(
    selfId: string,
    iceServers: RTCIceServer[],
    sendSignal: (to: string, data: SignalData) => void,
    onPlayer: (info: PlayerInfo, x: number, y: number) => void,
    onOps: (ops: unknown, from: string) => void,
  ) {
    this.selfId = selfId;
    this.iceServers = iceServers;
    this.sendSignal = sendSignal;
    this.onPlayer = onPlayer;
    this.onOps = onOps;
  }

  /**
   * Pass ops to the neighbouring hosts, except the one they came from. A
   * zone-scope op goes at once to each neighbour whose zone it's near (within
   * BORDER_VIEW). A world-scope op goes to every neighbour, with the next
   * batch. Player-scope ops never cross between hosts.
   */
  sendOps(ops: Op[], except: string | null = null) {
    const atlas = ops.filter((op) => LAYERS[op.l].scope === 'world');
    const local = ops.filter((op) => LAYERS[op.l].scope === 'zone');
    for (const link of this.links.values()) {
      if (!link.zone || !link.peer.isOpen || link.hostId === except) continue;
      const zone = link.zone;
      send(link.peer, local.filter((op) => {
        const at = opPoint(op);
        return !!at && distToZone(at.x, at.y, zone) <= BORDER_VIEW;
      }));
      for (const op of atlas) link.queue.push(op);
    }
  }

  /** The directory's list of neighbouring hosts. Opens, keeps or closes links to match. */
  setNeighbours(hosts: NeighbourHost[]) {
    this.wanted = new Map(hosts.map((h) => [h.hostId, h.zone]));
    for (const [id, link] of this.links) {
      const zone = this.wanted.get(id);
      if (zone === undefined) this.drop(id);
      else link.zone = zone;
    }
    for (const id of this.wanted.keys()) if (!this.links.has(id) && this.selfId < id) this.dial(id);
  }

  /** A border-link signal from another host. */
  handleSignal(from: string, data: SignalData) {
    let link = this.links.get(from);
    if (!link && data.kind === 'offer') link = this.open(from, false);
    void link?.peer.handleSignal(data);
  }

  /** Each host tick: share our players near each neighbour's zone. */
  tick(players: LocalPlayer[]) {
    const key = players.map((p) => `${p.n}:${p.info.id}:${p.info.name}:${p.info.hue}`).join('|');
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      this.roster = players.map((p) => ({ ...p.info, n: p.n }));
      for (const link of this.links.values()) link.peer.sendR({ t: 'border', players: this.roster });
    }
    for (const link of this.links.values()) {
      if (!link.zone || !link.peer.isOpen) continue;
      const p: PlayerPos[] = [];
      for (const pl of players) {
        if (distToZone(pl.x, pl.y, link.zone) <= BORDER_VIEW) p.push([pl.n, pl.x, pl.y]);
      }
      link.peer.sendU({ t: 'edge', p });
    }
    const now = performance.now();
    if (now - this.flushT >= RELAY_FLUSH_MS) {
      this.flushT = now;
      for (const link of this.links.values()) if (link.queue.length) send(link.peer, link.queue.splice(0));
    }
  }

  debug(): BorderDebug[] {
    const now = performance.now();
    return [...this.links.values()].map((l) => ({
      zone: l.zone,
      hostId: l.hostId,
      open: l.peer.isOpen,
      visible: l.visible,
      edgeAgeMs: l.edgeT ? now - l.edgeT : null,
    }));
  }

  close() {
    this.wanted.clear();
    for (const id of [...this.links.keys()]) this.drop(id);
    for (const t of this.redial.values()) clearTimeout(t);
    this.redial.clear();
    this.rosterKey = '';
  }

  private dial(id: string) {
    clearTimeout(this.redial.get(id));
    this.redial.delete(id);
    this.open(id, true);
  }

  private open(id: string, initiator: boolean): Link {
    const peer: Peer = new Peer(id, initiator, this.iceServers, (d) => this.sendSignal(id, d), {
      onOpen: () => peer.sendR({ t: 'border', players: this.roster }),
      onClose: () => {
        if (this.links.get(id)?.peer !== peer) return;
        this.links.delete(id);
        if (initiator && this.wanted.has(id)) {
          this.redial.set(id, setTimeout(() => {
            if (this.wanted.has(id) && !this.links.has(id)) this.dial(id);
          }, REDIAL_MS));
        }
      },
      onReliable: (m) => {
        if (m.t === 'edits') return this.onOps(m.ops, id);
        if (m.t !== 'border' || !Array.isArray(m.players)) return;
        link.roster = new Map(m.players.slice(0, 4096).map((p) => [Number(p?.n), sanitize(p)]));
      },
      onUnreliable: (m) => {
        if (m.t !== 'edge') return;
        link.edgeT = performance.now();
        link.visible = 0;
        for (const [n, x, y] of m.p) {
          const info = link.roster.get(n);
          if (!info) continue;
          link.visible++;
          this.onPlayer(info, x, y);
        }
      },
    }, new LinkGuard(HOST_LINK_LIMITS));
    const link: Link = {
      hostId: id, zone: this.wanted.get(id) ?? null, peer, initiator, roster: new Map(), visible: 0, edgeT: 0, queue: [],
    };
    const old = this.links.get(id);
    this.links.set(id, link);
    old?.peer.close();
    return link;
  }

  private drop(id: string) {
    const link = this.links.get(id);
    this.links.delete(id);
    link?.peer.close();
  }
}

function send(peer: Peer, ops: Op[]) {
  for (let i = 0; i < ops.length; i += OPS_PER_MESSAGE) peer.sendR({ t: 'edits', ops: ops.slice(i, i + OPS_PER_MESSAGE) });
}

/** A player's info as received from another peer, coerced into shape. */
export const sanitize = (p: PlayerInfo): PlayerInfo => ({
  id: String(p?.id).slice(0, 64), name: String(p?.name).slice(0, 32), hue: Number(p?.hue) % 360 || 0,
});
