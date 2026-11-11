import {
  PLAYER_SPEED, PROTOCOL_VERSION, TICK_HZ, isWalkable,
  type FromSignal, type PlayerInfo, type Reliable, type TileLookup, type Unreliable, type ZoneId,
} from '@terra/shared';
import { BorderLinks, type BorderDebug, type LocalPlayer } from './border.ts';
import { Peer } from './peer.ts';
import { SignalClient } from './signal.ts';

/** How far behind real time remote players are rendered, for smoothness. */
const INTERP_DELAY_MS = 100;
const BUFFER_MS = 1000;
/** A neighbouring zone's player disappears after this long without a position. */
const FOREIGN_TTL_MS = 1000;

export type Role = 'offline' | 'connecting' | 'host' | 'client';

interface Sample { t: number; x: number; y: number }

export interface Remote {
  info: PlayerInfo;
  samples: Sample[];
}

/** Server-side record the host keeps for each connected client. */
interface HostedClient {
  peer: Peer;
  info?: PlayerInfo;
  x: number;
  y: number;
  lastSeq: number;
  lastT: number;
  /** Position reports accepted, and reports clamped or rejected by validation. */
  reports: number;
  corrections: number;
}

/** What a host knows about one of its clients, for the debug panel. */
export interface ClientDebug {
  id: string;
  name: string | null;
  open: boolean;
  x: number;
  y: number;
  seq: number;
  reportAgeMs: number | null;
  reports: number;
  corrections: number;
}

/** What a client knows about its host, for the debug panel. */
export interface HostDebug {
  id: string;
  name: string | null;
  open: boolean;
  snapTick: number;
  snapAgeMs: number | null;
}

export interface SessionOptions {
  signalUrl: string;
  world: string;
  zone: ZoneId;
  peerId: string;
  info: PlayerInfo;
  iceServers: RTCIceServer[];
  tiles: TileLookup;
  getSelf(): { x: number; y: number };
}

/**
 * Zone session. The zone host (chosen by the directory) runs the
 * authoritative tick and relays state in a star topology; everyone else
 * connects only to the host.
 */
export class Session {
  role: Role = 'connecting';
  hostId: string | null = null;
  /** The zone this session is joined to. Changes via setZone(). */
  zone: ZoneId;
  readonly remotes = new Map<string, Remote>();

  private signal: SignalClient;
  // Client-side state
  private hostPeer: Peer | null = null;
  private seq = 0;
  private snapTick = 0;
  private snapT = 0;
  // Host-side state
  private clients = new Map<string, HostedClient>();
  private borders: BorderLinks;
  /** Players from neighbouring zones, relayed by their hosts (ids into remotes). */
  private foreign = new Set<string>();
  private rosterDirty = false;
  private tick = 0;
  private timer: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;

  private readonly o: SessionOptions;

  constructor(o: SessionOptions) {
    this.o = o;
    this.zone = o.zone;
    this.borders = new BorderLinks(
      o.peerId,
      o.iceServers,
      (to, data) => this.signal.send({ t: 'signal', to, link: 'border', data }),
      (info, x, y) => this.onForeign(info, x, y),
    );
    this.signal = new SignalClient(
      o.signalUrl,
      () => this.join(),
      (m) => this.onSignal(m),
      () => {
        // Lost the directory. Keep existing P2P links; just mark state.
        if (this.role !== 'host' && !this.hostPeer?.isOpen) this.role = 'offline';
      },
    );
    this.timer = setInterval(() => this.onTick(), 1000 / TICK_HZ);
  }

  get playerCount(): number {
    return this.remotes.size + 1;
  }

  /**
   * Move to another zone: drop links to the old zone's host or clients and
   * re-join through the directory, which promotes a new host for the old zone
   * if we were hosting it.
   */
  setZone(zone: ZoneId) {
    if (zone === this.zone) return;
    this.zone = zone;
    this.dropLinks();
    this.role = 'connecting';
    this.hostId = null;
    this.join(); // No-op while the directory is down; onOpen joins this.zone.
  }

  private join() {
    this.signal.send({ t: 'join', v: PROTOCOL_VERSION, world: this.o.world, zone: this.zone, peerId: this.o.peerId });
  }

  private dropLinks() {
    clearTimeout(this.retryTimer);
    const hostPeer = this.hostPeer;
    const clients = [...this.clients.values()];
    this.hostPeer = null;
    this.clients.clear();
    this.remotes.clear();
    this.foreign.clear();
    this.borders.close();
    this.snapT = 0;
    hostPeer?.close();
    for (const c of clients) c.peer.close();
  }

  // ---------------- signaling ----------------

  private onSignal(m: FromSignal) {
    switch (m.t) {
      case 'host':
        if (m.zone !== this.zone) break; // Stale: about a zone we've left.
        if (m.hostId === this.o.peerId) this.becomeHost();
        else this.becomeClient(m.hostId);
        break;
      case 'neighbours':
        if (this.role === 'host' && m.zone === this.zone) this.borders.setNeighbours(m.hosts);
        break;
      case 'signal': {
        if (m.link === 'border') {
          if (this.role === 'host') this.borders.handleSignal(m.from, m.data);
          break;
        }
        if (this.role === 'host') {
          if (m.data.kind === 'offer') this.acceptClient(m.from);
          this.clients.get(m.from)?.peer.handleSignal(m.data);
        } else if (this.hostPeer?.remoteId === m.from) {
          void this.hostPeer.handleSignal(m.data);
        }
        break;
      }
      case 'left':
        this.clients.get(m.peerId)?.peer.close();
        break;
      case 'error':
        console.error('signal error:', m.message);
        break;
    }
  }

  private sendSignal(to: string) {
    return (data: Parameters<Peer['handleSignal']>[0]) => this.signal.send({ t: 'signal', to, link: 'zone', data });
  }

  // ---------------- host role ----------------

  private becomeHost() {
    clearTimeout(this.retryTimer);
    const old = this.hostPeer;
    this.hostPeer = null;
    old?.close();
    this.role = 'host';
    this.hostId = this.o.peerId;
    this.remotes.clear();
    this.foreign.clear();
  }

  private acceptClient(id: string) {
    this.clients.get(id)?.peer.close();
    const peer: Peer = new Peer(id, false, this.o.iceServers, this.sendSignal(id), {
      onOpen: () => {},
      onClose: () => {
        if (this.clients.get(id)?.peer !== peer) return;
        this.clients.delete(id);
        this.remotes.delete(id);
        this.broadcastRoster();
      },
      onReliable: (m) => this.hostOnReliable(id, m),
      onUnreliable: (m) => this.hostOnUnreliable(id, m),
    });
    this.clients.set(id, { peer, x: 0, y: 0, lastSeq: -1, lastT: 0, reports: 0, corrections: 0 });
  }

  private hostOnReliable(id: string, m: Reliable) {
    const c = this.clients.get(id);
    if (!c) return;
    if (m.t === 'hello' && !c.info) {
      c.info = { id, name: String(m.info.name).slice(0, 32), hue: Number(m.info.hue) % 360 || 0 };
      c.x = Number(m.x) || 0;
      c.y = Number(m.y) || 0;
      c.lastT = performance.now();
      this.foreign.delete(id); // Now hosted here; no longer relayed by a neighbour.
      this.remotes.set(id, { info: c.info, samples: [{ t: c.lastT, x: c.x, y: c.y }] });
      this.broadcastRoster();
    }
  }

  private hostOnUnreliable(id: string, m: Unreliable) {
    const c = this.clients.get(id);
    if (!c?.info || m.t !== 'pos' || !(m.seq > c.lastSeq)) return;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    const now = performance.now();
    // Lenient anti-teleport: clamp to max plausible travel since last update.
    const maxD = PLAYER_SPEED * ((now - c.lastT) / 1000 + 0.25) * 1.5;
    let dx = m.x - c.x, dy = m.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d > maxD) (dx *= maxD / d), (dy *= maxD / d), c.corrections++;
    const nx = c.x + dx, ny = c.y + dy;
    if (!isWalkable(this.o.tiles(Math.floor(nx), Math.floor(ny)))) {
      c.corrections++;
      return;
    }
    c.reports++;
    c.x = nx;
    c.y = ny;
    c.lastSeq = m.seq;
    c.lastT = now;
    pushSample(this.remotes.get(id), now, nx, ny);
  }

  private broadcastRoster() {
    this.rosterDirty = false;
    const players: PlayerInfo[] = [this.o.info];
    for (const c of this.clients.values()) if (c.info) players.push(c.info);
    for (const id of this.foreign) {
      const r = this.remotes.get(id);
      if (r) players.push(r.info);
    }
    for (const c of this.clients.values()) if (c.info) c.peer.sendR({ t: 'roster', players });
  }

  /** A neighbouring host reported one of its players near our zone. */
  private onForeign(info: PlayerInfo, x: number, y: number) {
    if (this.role !== 'host' || info.id === this.o.peerId || this.clients.has(info.id)) return;
    let r = this.remotes.get(info.id);
    if (!r) {
      r = { info, samples: [] };
      this.remotes.set(info.id, r);
      this.foreign.add(info.id);
      this.rosterDirty = true;
    } else if (r.info.name !== info.name || r.info.hue !== info.hue) {
      r.info = info;
      this.rosterDirty = true;
    }
    pushSample(r, performance.now(), x, y);
  }

  /** Forget neighbouring zones' players that have gone quiet (out of range, or their link dropped). */
  private expireForeign(now: number) {
    for (const id of this.foreign) {
      const r = this.remotes.get(id);
      const last = r?.samples[r.samples.length - 1];
      if (!last || last.t < now - FOREIGN_TTL_MS) {
        this.foreign.delete(id);
        this.remotes.delete(id);
        this.rosterDirty = true;
      }
    }
  }

  // ---------------- client role ----------------

  private becomeClient(hostId: string) {
    if (this.role === 'host') {
      for (const c of this.clients.values()) c.peer.close();
      this.clients.clear();
      this.foreign.clear();
      this.borders.close();
    }
    if (this.hostPeer?.remoteId === hostId && !this.hostPeer.isOpen) return; // already dialing
    this.hostPeer?.close();
    this.role = 'connecting';
    this.hostId = hostId;
    this.remotes.clear();
    this.dial(hostId);
  }

  private dial(hostId: string) {
    clearTimeout(this.retryTimer);
    const peer: Peer = new Peer(hostId, true, this.o.iceServers, this.sendSignal(hostId), {
      onOpen: () => {
        this.role = 'client';
        const self = this.o.getSelf();
        peer.sendR({ t: 'hello', info: this.o.info, x: self.x, y: self.y });
      },
      onClose: () => {
        if (this.hostPeer !== peer) return;
        this.hostPeer = null;
        this.remotes.clear();
        this.snapT = 0;
        if (this.role === 'host') return;
        this.role = 'connecting';
        // Host may be gone; the directory will tell us about a new one.
        // Otherwise, redial the same host shortly.
        this.retryTimer = setTimeout(() => {
          if (this.hostId === hostId && !this.hostPeer && this.role === 'connecting') this.dial(hostId);
        }, 2000);
      },
      onReliable: (m) => {
        if (m.t !== 'roster') return;
        const ids = new Set<string>();
        for (const p of m.players) {
          if (p.id === this.o.peerId) continue;
          ids.add(p.id);
          const r = this.remotes.get(p.id);
          if (r) r.info = p;
          else this.remotes.set(p.id, { info: p, samples: [] });
        }
        for (const id of this.remotes.keys()) if (!ids.has(id)) this.remotes.delete(id);
      },
      onUnreliable: (m) => {
        if (m.t !== 'snap') return;
        const now = performance.now();
        this.snapTick = m.tick;
        this.snapT = now;
        for (const [id, x, y] of m.p) pushSample(this.remotes.get(id), now, x, y);
      },
    });
    this.hostPeer = peer;
  }

  // ---------------- tick ----------------

  private onTick() {
    const self = this.o.getSelf();
    if (this.role === 'host') {
      this.tick++;
      const now = performance.now();
      const local: LocalPlayer[] = [{ info: this.o.info, x: self.x, y: self.y }];
      for (const c of this.clients.values()) if (c.info) local.push({ info: c.info, x: c.x, y: c.y });
      this.borders.tick(local);
      this.expireForeign(now);
      if (this.rosterDirty) this.broadcastRoster();

      const p: Array<[string, number, number]> = local.map((l) => [l.info.id, round(l.x), round(l.y)]);
      for (const id of this.foreign) {
        const s = this.remotes.get(id)?.samples;
        const last = s?.[s.length - 1];
        if (last) p.push([id, round(last.x), round(last.y)]);
      }
      const snap: Unreliable = { t: 'snap', tick: this.tick, p };
      for (const c of this.clients.values()) if (c.info) c.peer.sendU(snap);
    } else if (this.role === 'client' && this.hostPeer) {
      this.hostPeer.sendU({ t: 'pos', seq: this.seq++, x: round(self.x), y: round(self.y) });
    }
  }

  // ---------------- debug ----------------

  get signalUp(): boolean {
    return this.signal.connected;
  }

  /** The host this client reports to, or null when hosting or not yet assigned. */
  hostDebug(): HostDebug | null {
    if (this.role === 'host' || !this.hostId) return null;
    const now = performance.now();
    return {
      id: this.hostId,
      name: this.remotes.get(this.hostId)?.info.name ?? null,
      open: !!this.hostPeer?.isOpen,
      snapTick: this.snapTick,
      snapAgeMs: this.snapT ? now - this.snapT : null,
    };
  }

  /** Links to neighbouring zones' hosts, when this peer is a host. */
  bordersDebug(): BorderDebug[] {
    return this.role === 'host' ? this.borders.debug() : [];
  }

  /** What each client has reported, when this peer is the host. */
  clientsDebug(): ClientDebug[] {
    if (this.role !== 'host') return [];
    const now = performance.now();
    return [...this.clients].map(([id, c]) => ({
      id,
      name: c.info?.name ?? null,
      open: c.peer.isOpen,
      x: c.x,
      y: c.y,
      seq: c.lastSeq,
      reportAgeMs: c.info ? now - c.lastT : null,
      reports: c.reports,
      corrections: c.corrections,
    }));
  }

  /** Interpolated position of a remote player for rendering, or null. */
  sample(r: Remote, now: number): { x: number; y: number } | null {
    const s = r.samples;
    if (s.length === 0) return null;
    const t = now - INTERP_DELAY_MS;
    if (t <= s[0].t) return s[0];
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1], b = s[i];
      if (t >= a.t) {
        if (t >= b.t) return b;
        const k = (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return s[s.length - 1];
  }

  close() {
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.signal.close();
    this.hostPeer?.close();
    for (const c of this.clients.values()) c.peer.close();
    this.borders.close();
  }
}

function pushSample(r: Remote | undefined, t: number, x: number, y: number) {
  if (!r) return;
  r.samples.push({ t, x, y });
  while (r.samples.length > 2 && r.samples[0].t < t - BUFFER_MS) r.samples.shift();
}

const round = (v: number) => Math.round(v * 100) / 100;
