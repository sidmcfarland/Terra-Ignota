import {
  BORDER_VIEW, ZONE_TILES, parseZone,
  type NeighbourHost, type PlayerInfo, type SignalData, type TileOp, type ZoneId,
} from '@terra/shared';
import { Peer } from './peer.ts';

/** Redial a dropped border link after this long, if the neighbour is still listed. */
const REDIAL_MS = 2000;

export interface LocalPlayer {
  info: PlayerInfo;
  x: number;
  y: number;
}

interface Link {
  hostId: string;
  /** The neighbour's zone, once the directory has listed it. */
  zone: ZoneId | null;
  peer: Peer;
  initiator: boolean;
  /** Player infos the neighbour last told us about. */
  roster: Map<string, PlayerInfo>;
  /** Players it last said were near our zone, and when. */
  visible: number;
  edgeT: number;
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
 */
export class BorderLinks {
  private links = new Map<string, Link>();
  /** hostId -> zone, from the latest directory listing. */
  private wanted = new Map<string, ZoneId>();
  private redial = new Map<string, ReturnType<typeof setTimeout>>();
  private rosterKey = '';
  private roster: PlayerInfo[] = [];

  private readonly selfId: string;
  private readonly iceServers: RTCIceServer[];
  private readonly sendSignal: (to: string, data: SignalData) => void;
  private readonly onPlayer: (info: PlayerInfo, x: number, y: number) => void;
  private readonly onOps: (ops: unknown) => void;

  constructor(
    selfId: string,
    iceServers: RTCIceServer[],
    sendSignal: (to: string, data: SignalData) => void,
    onPlayer: (info: PlayerInfo, x: number, y: number) => void,
    onOps: (ops: unknown) => void,
  ) {
    this.selfId = selfId;
    this.iceServers = iceServers;
    this.sendSignal = sendSignal;
    this.onPlayer = onPlayer;
    this.onOps = onOps;
  }

  /** Pass edits to each neighbouring host whose zone they're near (within BORDER_VIEW). */
  sendOps(ops: TileOp[]) {
    for (const link of this.links.values()) {
      if (!link.zone || !link.peer.isOpen) continue;
      const [zx, zy] = parseZone(link.zone);
      const near = ops.filter((op) => distToZone(op.x + 0.5, op.y + 0.5, zx, zy) <= BORDER_VIEW);
      for (let i = 0; i < near.length; i += 200) link.peer.sendR({ t: 'edits', ops: near.slice(i, i + 200) });
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
    const key = players.map((p) => `${p.info.id}:${p.info.name}:${p.info.hue}`).join('|');
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      this.roster = players.map((p) => p.info);
      for (const link of this.links.values()) link.peer.sendR({ t: 'border', players: this.roster });
    }
    for (const link of this.links.values()) {
      if (!link.zone || !link.peer.isOpen) continue;
      const [zx, zy] = parseZone(link.zone);
      const p: Array<[string, number, number]> = [];
      for (const pl of players) {
        if (distToZone(pl.x, pl.y, zx, zy) <= BORDER_VIEW) p.push([pl.info.id, round(pl.x), round(pl.y)]);
      }
      link.peer.sendU({ t: 'edge', p });
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
        if (m.t === 'edits') return this.onOps(m.ops);
        if (m.t !== 'border') return;
        link.roster = new Map(m.players.map((p) => [p.id, sanitize(p)]));
      },
      onUnreliable: (m) => {
        if (m.t !== 'edge') return;
        link.edgeT = performance.now();
        link.visible = 0;
        for (const [pid, x, y] of m.p) {
          const info = link.roster.get(pid);
          if (!info || !Number.isFinite(x) || !Number.isFinite(y)) continue;
          link.visible++;
          this.onPlayer(info, x, y);
        }
      },
    });
    const link: Link = {
      hostId: id, zone: this.wanted.get(id) ?? null, peer, initiator, roster: new Map(), visible: 0, edgeT: 0,
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

/** Distance from (x, y) to the nearest point of zone (zx, zy); 0 inside it. */
function distToZone(x: number, y: number, zx: number, zy: number): number {
  const x0 = zx * ZONE_TILES, y0 = zy * ZONE_TILES;
  const dx = Math.max(x0 - x, 0, x - (x0 + ZONE_TILES));
  const dy = Math.max(y0 - y, 0, y - (y0 + ZONE_TILES));
  return Math.hypot(dx, dy);
}

const sanitize = (p: PlayerInfo): PlayerInfo => ({
  id: String(p.id), name: String(p.name).slice(0, 32), hue: Number(p.hue) % 360 || 0,
});

const round = (v: number) => Math.round(v * 100) / 100;
