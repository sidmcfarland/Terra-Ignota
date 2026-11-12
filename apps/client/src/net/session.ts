import {
  EDITS_PER_SEC, EDIT_REACH, PLAYER_SPEED, PROTOCOL_VERSION, STATUS_INTERVAL_MS, TICK_HZ,
  canHost, hostScore, isWalkable, isWellFormed, verifyOp, zoneChunkKeys,
  type FromSignal, type HostMetrics, type Identity, type LinkKind, type PlayerInfo, type Reliable, type TileEdits, type TileLookup,
  type TileOp, type Unreliable, type ZoneId,
} from '@terra/shared';
import { BorderLinks, type BorderDebug, type LocalPlayer } from './border.ts';
import { Peer } from './peer.ts';
import { SignalClient } from './signal.ts';

/** How far behind real time remote players are rendered, for smoothness. */
const INTERP_DELAY_MS = 100;
const BUFFER_MS = 1000;
/** A neighbouring zone's player disappears after this long without a position. */
const FOREIGN_TTL_MS = 1000;
const TICK_MS = 1000 / TICK_HZ;
/** A host tick counts as late when it fires this much after the previous one. */
const LATE_TICK_MS = 1.5 * TICK_MS;
/** How many recent host ticks the late-tick fraction covers. */
const LATE_WINDOW = 100;
/** Round-trip time assumed before any measurement arrives. */
const DEFAULT_RTT_MS = 100;
/** Host ticks between state updates to the backups (5 per second). */
const STATE_EVERY_TICKS = 4;
/** A client reports its host to the directory after this long without a snapshot. */
const HOST_SILENCE_MS = 1000;
/** A successor only uses backup state younger than this. */
const STATE_MAX_AGE_MS = 5000;
/** Ops per 'edits' message, to keep data-channel messages small. */
const OPS_PER_MESSAGE = 200;

/** Zone state streamed from the host to its backups. */
interface BackupState {
  tick: number;
  players: Map<string, { x: number; y: number }>;
  t: number;
}

export type Role = 'offline' | 'connecting' | 'host' | 'client';

/**
 * What a session needs from the device's hosting profile. The browser's is
 * HostingProfile (hosting.ts); headless peers such as bots supply their own.
 */
export interface HostProfile {
  /** The session sets this, to be called when something the directory should know changes. */
  onChange: () => void;
  setHosting(on: boolean): void;
  metrics(rttMs: number, lateTicks: number): HostMetrics;
}

/** Counters a session keeps about itself, for the debug panel and the bot swarm's metrics. */
export interface SessionStats {
  /** As a client: snapshots received, and the player positions in them. */
  snaps: number;
  snapPlayers: number;
  /** As a host: ticks run, time spent in them (total and the worst one), and how many started late. */
  ticks: number;
  tickMs: number;
  tickMaxMs: number;
  lateTicks: number;
  /** Times this zone's host changed while we stayed in the zone (a failover or a hand-over). */
  hostChanges: number;
}

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
  /** Smoothed round trip to this client, once measured. */
  rttMs: number | null;
  /** The client's public key (from hello): the only author whose edits it may send. */
  pub?: string;
  /** Edit rate limiting: edits allowed this second, and when the second started. */
  editBudget: number;
  editT: number;
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
  rttMs: number | null;
}

/** This peer's standing in host election, for the debug panel. */
export interface HostingDebug {
  metrics: HostMetrics;
  eligible: boolean;
  /** Why it can't host right now, if it can't. */
  reasons: string[];
  score: number;
}

/** What a client knows about its host, for the debug panel. */
export interface HostDebug {
  id: string;
  name: string | null;
  open: boolean;
  snapTick: number;
  snapAgeMs: number | null;
  /** This peer's place in the host's succession (1 = first), or null if it isn't a backup. */
  backupRank: number | null;
  stateTick: number | null;
  stateAgeMs: number | null;
}

/** One of a host's backups, for the debug panel. */
export interface BackupDebug {
  id: string;
  name: string | null;
  /** The backup is connected, so state is reaching it. */
  streaming: boolean;
}

export interface SessionOptions {
  signalUrl: string;
  world: string;
  zone: ZoneId;
  peerId: string;
  info: PlayerInfo;
  identity: Identity;
  /** This peer's replica of the world's edits (already loaded from storage). */
  edits: TileEdits;
  /** Called for each op that changed the replica, to persist it. */
  onMerged(op: TileOp): void;
  profile: HostProfile;
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
  /** The zone's backups as the directory last announced them, best first. */
  backups: string[] = [];
  readonly remotes = new Map<string, Remote>();
  readonly stats: SessionStats = { snaps: 0, snapPlayers: 0, ticks: 0, tickMs: 0, tickMaxMs: 0, lateTicks: 0, hostChanges: 0 };

  private signal: SignalClient;
  // Client-side state
  private hostPeer: Peer | null = null;
  private seq = 0;
  private snapTick = 0;
  private snapT = 0;
  private lastDownReport = 0;
  /** Latest zone state from the host, when this peer is one of its backups. */
  private backupState: BackupState | null = null;
  // Host-side state
  private clients = new Map<string, HostedClient>();
  private borders: BorderLinks;
  /** Players from neighbouring zones, relayed by their hosts (ids into remotes). */
  private foreign = new Set<string>();
  private rosterDirty = false;
  /** Seed peers replicating this zone's edits, by peer id. */
  private seedLinks = new Map<string, Peer>();
  /** After taking over: where each player was in the old host's last state, to validate their reconnect. */
  private inherited: BackupState | null = null;
  private tick = 0;
  private lastTickT = 0;
  private late: boolean[] = [];
  private timer: ReturnType<typeof setTimeout>;
  /** When the next tick is due on the ideal 20 Hz timeline. */
  private tickDue = performance.now();
  private statusTimer: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  // Round trip to the signal server
  private signalRtt: number | null = null;
  private pings = new Map<number, number>();
  private pingN = 0;

  private readonly o: SessionOptions;

  constructor(o: SessionOptions) {
    this.o = o;
    this.zone = o.zone;
    this.borders = new BorderLinks(
      o.peerId,
      o.iceServers,
      (to, data) => this.signal.send({ t: 'signal', to, link: 'border', data }),
      (info, x, y) => this.onForeign(info, x, y),
      (ops) => void this.receiveOps(ops, null),
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
    this.timer = setTimeout(this.runTick, TICK_MS);
    this.statusTimer = setInterval(() => this.heartbeat(), STATUS_INTERVAL_MS);
    o.profile.onChange = () => this.sendStatus();
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
    this.sendStatus(); // Before joining, so an empty zone's election can use it.
    this.signal.send({ t: 'join', v: PROTOCOL_VERSION, world: this.o.world, zone: this.zone, peerId: this.o.peerId });
  }

  // ---------------- election status ----------------

  /** Fraction of recent host ticks that ran late. */
  private get lateTicks(): number {
    return this.late.length ? this.late.filter(Boolean).length / this.late.length : 0;
  }

  /** Average round trip to our clients while hosting; otherwise to the signal server. */
  private get rttMs(): number {
    if (this.role === 'host') {
      const rtts = [...this.clients.values()].map((c) => c.rttMs).filter((v): v is number => v !== null);
      if (rtts.length) return rtts.reduce((a, b) => a + b, 0) / rtts.length;
    }
    return this.signalRtt ?? DEFAULT_RTT_MS;
  }

  private metrics(): HostMetrics {
    return this.o.profile.metrics(this.rttMs, this.lateTicks);
  }

  private sendStatus() {
    this.signal.send({ t: 'status', m: this.metrics() });
  }

  private heartbeat() {
    this.o.profile.setHosting(this.role === 'host');
    const n = ++this.pingN;
    this.pings.set(n, performance.now());
    if (this.pings.size > 10) this.pings.delete(this.pings.keys().next().value!);
    this.signal.send({ t: 'ping', n });
    this.sendStatus();
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
    this.closeSeeds();
    this.snapT = 0;
    this.backups = [];
    this.backupState = null;
    this.inherited = null;
    hostPeer?.close();
    for (const c of clients) c.peer.close();
  }

  // ---------------- edits ----------------

  /**
   * Pass on an edit this peer just made (already merged locally): to the host
   * when a client, or to clients and neighbouring hosts when the host. With no
   * host yet, it stays local and goes out on the next sync.
   */
  publish(op: TileOp) {
    if (this.role === 'host') this.spread([op], null);
    else if (this.role === 'client') this.hostPeer?.sendR({ t: 'edit', op });
  }

  /** The chunk keys of the zone this session is in. */
  private zoneChunks(): string[] {
    return zoneChunkKeys(this.zone);
  }

  private chunkOps(keys: string[]): TileOp[] {
    return keys.flatMap((k) => this.o.edits.chunkOps(k));
  }

  /** Verify untrusted ops, merge them, persist what changed, and spread it if hosting. */
  private async receiveOps(ops: unknown, from: string | null): Promise<TileOp[]> {
    if (!Array.isArray(ops)) return [];
    const valid = (await Promise.all(
      ops.slice(0, 5000).map(async (op) => (isWellFormed(op) && (await verifyOp(this.o.world, op)) ? op : null)),
    )).filter((op): op is TileOp => op !== null);
    const changed = valid.filter((op) => this.o.edits.merge(op));
    for (const op of changed) this.o.onMerged(op);
    if (changed.length && this.role === 'host') this.spread(changed, from);
    return changed;
  }

  /** Host: send ops to every client and seed (except the one they came from) and to neighbouring hosts. */
  private spread(ops: TileOp[], except: string | null) {
    for (let i = 0; i < ops.length; i += OPS_PER_MESSAGE) {
      const msg: Reliable = { t: 'edits', ops: ops.slice(i, i + OPS_PER_MESSAGE) };
      for (const [id, c] of this.clients) if (c.info && id !== except) c.peer.sendR(msg);
      for (const [id, peer] of this.seedLinks) if (id !== except) peer.sendR(msg);
    }
    this.borders.sendOps(ops);
  }

  private sendOps(peer: Peer, ops: TileOp[]) {
    for (let i = 0; i < ops.length; i += OPS_PER_MESSAGE) peer.sendR({ t: 'edits', ops: ops.slice(i, i + OPS_PER_MESSAGE) });
  }

  /** Host: a client's new edit. Accept it only from its author, near where the client is, within the rate limit. */
  private async hostOnEdit(id: string, op: unknown) {
    const c = this.clients.get(id);
    if (!c?.info || !c.pub || !isWellFormed(op) || op.author !== c.pub) return;
    const now = performance.now();
    if (now - c.editT > 1000) (c.editT = now), (c.editBudget = EDITS_PER_SEC);
    if (c.editBudget-- <= 0) return;
    if (Math.hypot(op.x + 0.5 - c.x, op.y + 0.5 - c.y) > EDIT_REACH + 1) return;
    await this.receiveOps([op], id);
  }

  /** Host: a client's digests. */
  private hostOnSync(id: string, d: unknown) {
    const c = this.clients.get(id);
    if (c) this.syncWith(c.peer, d);
  }

  /** Host: compare a peer's digests with ours. Send it what it lacks; ask for what we lack. */
  private syncWith(peer: Peer, d: unknown) {
    if (!d || typeof d !== 'object') return;
    const theirs = d as Record<string, unknown>;
    const send: string[] = [], want: string[] = [];
    for (const key of this.zoneChunks()) {
      const ours = this.o.edits.digest(key);
      const them = typeof theirs[key] === 'string' ? (theirs[key] as string) : '';
      if (ours === them) continue;
      if (ours) send.push(key);
      if (them) want.push(key);
    }
    this.sendOps(peer, this.chunkOps(send));
    if (want.length) peer.sendR({ t: 'syncWant', chunks: want });
  }

  /** Host: a seed peer is dialling in. It's a replica of the zone's edits, not a player. */
  private acceptSeed(id: string) {
    this.seedLinks.get(id)?.close();
    const peer: Peer = new Peer(id, false, this.o.iceServers, this.sendSignal(id, 'seed'), {
      onOpen: () => {},
      onClose: () => {
        if (this.seedLinks.get(id) === peer) this.seedLinks.delete(id);
      },
      onReliable: (m) => {
        if (m.t === 'sync') this.syncWith(peer, m.d);
        else if (m.t === 'edits') void this.receiveOps(m.ops, id);
      },
      onUnreliable: () => {},
    });
    this.seedLinks.set(id, peer);
  }

  private closeSeeds() {
    const links = [...this.seedLinks.values()];
    this.seedLinks.clear();
    for (const peer of links) peer.close();
  }

  /** Client: right after connecting, tell the host what we hold for this zone. */
  private sendSync(peer: Peer) {
    const d: Record<string, string> = {};
    for (const key of this.zoneChunks()) {
      const dg = this.o.edits.digest(key);
      if (dg) d[key] = dg;
    }
    peer.sendR({ t: 'sync', d });
  }

  // ---------------- signaling ----------------

  private onSignal(m: FromSignal) {
    switch (m.t) {
      case 'host':
        if (m.zone !== this.zone) break; // Stale: about a zone we've left.
        this.backups = Array.isArray(m.backups) ? m.backups : [];
        if (this.hostId && m.hostId !== this.hostId) this.stats.hostChanges++;
        if (!this.backups.includes(this.o.peerId) && m.hostId !== this.o.peerId) this.backupState = null;
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
        if (m.link === 'seed') {
          if (this.role !== 'host') break;
          if (m.data.kind === 'offer') this.acceptSeed(m.from);
          void this.seedLinks.get(m.from)?.handleSignal(m.data);
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
      case 'probe':
        this.signal.send({ t: 'alive', n: m.n });
        break;
      case 'pong': {
        const t = this.pings.get(m.n);
        if (t === undefined) break;
        this.pings.delete(m.n);
        this.signalRtt = smooth(this.signalRtt, performance.now() - t);
        break;
      }
      case 'error':
        console.error('signal error:', m.message);
        break;
    }
  }

  private sendSignal(to: string, link: LinkKind = 'zone') {
    return (data: Parameters<Peer['handleSignal']>[0]) => this.signal.send({ t: 'signal', to, link, data });
  }

  // ---------------- host role ----------------

  private becomeHost() {
    if (this.role === 'host') return;
    clearTimeout(this.retryTimer);
    const old = this.hostPeer;
    this.hostPeer = null;
    old?.close();
    this.role = 'host';
    this.hostId = this.o.peerId;
    this.remotes.clear();
    this.foreign.clear();
    this.late = [];
    this.lastTickT = 0;
    this.o.profile.setHosting(true);
    // A backup taking over carries on from the old host's state.
    const st = this.backupState;
    this.backupState = null;
    this.inherited = st && performance.now() - st.t < STATE_MAX_AGE_MS ? st : null;
    if (this.inherited) this.tick = this.inherited.tick;
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
    this.clients.set(id, {
      peer, x: 0, y: 0, lastSeq: -1, lastT: 0, reports: 0, corrections: 0, rttMs: null, editBudget: EDITS_PER_SEC, editT: 0,
    });
  }

  private hostOnReliable(id: string, m: Reliable) {
    const c = this.clients.get(id);
    if (!c) return;
    if (m.t === 'edit') return void this.hostOnEdit(id, m.op);
    if (m.t === 'edits') return void (c.info && this.receiveOps(m.ops, id));
    if (m.t === 'sync') return this.hostOnSync(id, m.d);
    if (m.t === 'hello' && !c.info) {
      c.info = { id, name: String(m.info.name).slice(0, 32), hue: Number(m.info.hue) % 360 || 0 };
      if (typeof m.pub === 'string' && m.pub.length <= 64) c.pub = m.pub;
      c.x = Number(m.x) || 0;
      c.y = Number(m.y) || 0;
      c.lastT = performance.now();
      // Reconnecting after a takeover: hold the claimed position to what the old host last validated.
      const known = this.inherited?.players.get(id);
      if (known && this.inherited) {
        const maxD = PLAYER_SPEED * ((c.lastT - this.inherited.t) / 1000 + 0.25) * 1.5;
        const dx = c.x - known.x, dy = c.y - known.y, d = Math.hypot(dx, dy);
        if (d > maxD) {
          c.x = known.x + (dx * maxD) / d;
          c.y = known.y + (dy * maxD) / d;
          c.corrections++;
        }
        this.inherited.players.delete(id);
      }
      this.foreign.delete(id); // Now hosted here; no longer relayed by a neighbour.
      this.remotes.set(id, { info: c.info, samples: [{ t: c.lastT, x: c.x, y: c.y }] });
      this.broadcastRoster();
    }
  }

  private hostOnUnreliable(id: string, m: Unreliable) {
    const c = this.clients.get(id);
    if (c && m.t === 'pong' && Number.isFinite(m.ts)) {
      const rtt = performance.now() - m.ts;
      if (rtt >= 0 && rtt < 10_000) c.rttMs = smooth(c.rttMs, rtt);
      return;
    }
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
    if (this.role === 'client' && this.hostId === hostId && this.hostPeer?.isOpen) return; // Already connected.
    if (this.role === 'host') {
      this.o.profile.setHosting(false);
      for (const c of this.clients.values()) c.peer.close();
      this.clients.clear();
      this.foreign.clear();
      this.borders.close();
      this.closeSeeds();
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
        peer.sendR({ t: 'hello', info: this.o.info, x: self.x, y: self.y, pub: this.o.identity.pub });
        this.sendSync(peer);
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
        if (m.t === 'edits') return void this.receiveOps(m.ops, null);
        if (m.t === 'syncWant') {
          const zone = new Set(this.zoneChunks());
          const keys = Array.isArray(m.chunks) ? m.chunks.filter((k) => typeof k === 'string' && zone.has(k)) : [];
          return this.sendOps(peer, this.chunkOps(keys));
        }
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
        if (m.t === 'ping') return peer.sendU({ t: 'pong', ts: m.ts });
        if (m.t === 'state') {
          if (!this.backups.includes(this.o.peerId) || !Array.isArray(m.p)) return;
          const players = new Map<string, { x: number; y: number }>();
          for (const [pid, x, y] of m.p) if (Number.isFinite(x) && Number.isFinite(y)) players.set(pid, { x, y });
          this.backupState = { tick: Number(m.tick) || 0, players, t: performance.now() };
          return;
        }
        if (m.t !== 'snap') return;
        const now = performance.now();
        this.snapTick = m.tick;
        this.snapT = now;
        this.stats.snaps++;
        this.stats.snapPlayers += m.p.length;
        for (const [id, x, y] of m.p) pushSample(this.remotes.get(id), now, x, y);
      },
    });
    this.hostPeer = peer;
  }

  // ---------------- tick ----------------

  /**
   * Run a tick and book the next one against the ideal timeline, not against
   * now. Timers that fire late (Windows rounds Node's to about 16ms; busy tabs
   * drift) then cost jitter, not tick rate. After a long stall the timeline
   * restarts, so missed ticks aren't replayed in a burst.
   */
  private runTick = () => {
    const now = performance.now();
    this.tickDue += TICK_MS;
    if (this.tickDue < now - TICK_MS) this.tickDue = now;
    this.timer = setTimeout(this.runTick, Math.max(0, this.tickDue - now));
    this.onTick();
  };

  private onTick() {
    const self = this.o.getSelf();
    if (this.role === 'host') {
      this.tick++;
      const now = performance.now();
      if (this.lastTickT) {
        const late = now - this.lastTickT > LATE_TICK_MS;
        if (late) this.stats.lateTicks++;
        this.late.push(late);
        if (this.late.length > LATE_WINDOW) this.late.shift();
      }
      this.lastTickT = now;
      if (this.tick % TICK_HZ === 0) {
        for (const c of this.clients.values()) if (c.info) c.peer.sendU({ t: 'ping', ts: now });
      }
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

      if (this.tick % STATE_EVERY_TICKS === 0 && this.backups.length) {
        const state: Unreliable = {
          t: 'state', tick: this.tick, p: local.map((l) => [l.info.id, round(l.x), round(l.y)]),
        };
        for (const id of this.backups) this.clients.get(id)?.peer.sendU(state);
      }
      const spent = performance.now() - now;
      this.stats.ticks++;
      this.stats.tickMs += spent;
      if (spent > this.stats.tickMaxMs) this.stats.tickMaxMs = spent;
    } else if (this.role === 'client' && this.hostPeer) {
      this.hostPeer.sendU({ t: 'pos', seq: this.seq++, x: round(self.x), y: round(self.y) });
      // The host has gone quiet: ask the directory to check on it.
      const now = performance.now();
      if (this.snapT && now - this.snapT > HOST_SILENCE_MS && now - this.lastDownReport > HOST_SILENCE_MS) {
        this.lastDownReport = now;
        this.signal.send({ t: 'hostDown', zone: this.zone });
      }
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
    const rank = this.backups.indexOf(this.o.peerId);
    const st = this.backupState;
    return {
      id: this.hostId,
      name: this.remotes.get(this.hostId)?.info.name ?? null,
      open: !!this.hostPeer?.isOpen,
      snapTick: this.snapTick,
      snapAgeMs: this.snapT ? now - this.snapT : null,
      backupRank: rank >= 0 ? rank + 1 : null,
      stateTick: st ? st.tick : null,
      stateAgeMs: st ? now - st.t : null,
    };
  }

  /** The members this host streams its state to, best first. */
  backupsDebug(): BackupDebug[] {
    if (this.role !== 'host') return [];
    return this.backups.map((id) => {
      const c = this.clients.get(id);
      return { id, name: c?.info?.name ?? null, streaming: !!(c?.info && c.peer.isOpen) };
    });
  }

  /** The host simulation tick (continues across a takeover by a backup). */
  get currentTick(): number {
    return this.role === 'host' ? this.tick : this.snapTick;
  }

  /** Links to neighbouring zones' hosts, when this peer is a host. */
  /** Seed peers linked to this host (open links only). */
  get seedCount(): number {
    return this.role === 'host' ? [...this.seedLinks.values()].filter((p) => p.isOpen).length : 0;
  }

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
      rttMs: c.rttMs,
    }));
  }

  /** This peer's eligibility and score as the directory sees them. */
  hostingDebug(): HostingDebug {
    const m = this.metrics();
    const reasons: string[] = [];
    if (!m.optIn) reasons.push('opted out');
    if (!m.visible) reasons.push('tab in background');
    if (m.mobile) reasons.push('mobile');
    if (m.battery) reasons.push('on battery');
    const members = this.role === 'host' ? this.clients.size + 1 : 1;
    return { metrics: m, eligible: canHost(m), reasons, score: hostScore(m, members) };
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
    clearTimeout(this.timer);
    clearInterval(this.statusTimer);
    clearTimeout(this.retryTimer);
    this.signal.close();
    this.hostPeer?.close();
    for (const c of this.clients.values()) c.peer.close();
    this.borders.close();
    this.closeSeeds();
  }
}

function pushSample(r: Remote | undefined, t: number, x: number, y: number) {
  if (!r) return;
  r.samples.push({ t, x, y });
  while (r.samples.length > 2 && r.samples[0].t < t - BUFFER_MS) r.samples.shift();
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Exponentially smoothed round-trip time. */
const smooth = (prev: number | null, sample: number) => (prev === null ? sample : prev * 0.8 + sample * 0.2);
