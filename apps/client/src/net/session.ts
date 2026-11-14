import {
  AT_LIVE_S, BORDER_VIEW, CLIENT_LIMITS, EDITS_PER_SEC, HOST_LINK_LIMITS, LAYERS, LinkGuard, MAX_OPS_PER_MESSAGE,
  MAX_VIEW_RADIUS, MIN_VIEW_RADIUS, OPS_PER_MESSAGE, PLAYER_SPEED, PROTOCOL_VERSION, STATUS_INTERVAL_MS, SYNC_ANSWER_MS,
  SYNC_ATLAS_ZONES, SYNC_CHUNKS_AT_ONCE, SYNC_OPS_BURST, SYNC_OPS_PER_SEC, TICK_HZ, TokenBucket, VIEW_HYSTERESIS, VIEW_RADIUS,
  ZONE_MARGIN, ZONE_SLACK,
  asOp, atlasZone, bucketCap, bucketOf, canHost, clampToZone, distToZone, hostScore, inReach, isExpired, isTooNew, isWalkable,
  opKey, opPoint, playerBucket, syncDigests, verifyOp, zoneChunkBuckets,
  type FromSignal, type HostMetrics, type Identity, type LinkKind, type Op, type OpStore, type PlayerEntry, type PlayerInfo,
  type PlayerPos, type Reliable, type TileLookup, type Unreliable, type ZoneId,
} from '@terra/shared';
import { BorderLinks, sanitize, type BorderDebug, type LocalPlayer } from './border.ts';
import { Peer } from './peer.ts';
import { SignalClient } from './signal.ts';
import { netStats } from './stats.ts';

/** How far behind real time remote players are rendered, for smoothness. */
const INTERP_DELAY_MS = 100;
const BUFFER_MS = 1000;
/** A neighbouring zone's player disappears after this long without a position. */
const FOREIGN_TTL_MS = 1000;
/** A client forgets a player its host has stopped sending (one that left its view) after this long. */
const VIEW_TTL_MS = 500;
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
/** A host holds back catch-up buckets for a peer while this much is still queued to it. */
const SYNC_BACKLOG_BYTES = 256 * 1024;
/** Buckets read from one peer's digests. (A sync message is at most 64,000 characters, about 30 a bucket.) */
const MAX_SYNC_KEYS = 4096;
/** Ops of ours remembered in case the host refuses them. */
const PENDING_MAX = 256;
/** Host or client ticks between sweeps for expired ops (every 30 seconds). */
const EXPIRE_EVERY_TICKS = 30 * TICK_HZ;

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
  /**
   * As a host: ops refused. A client's live op from the wrong author, over the rate limit, out of reach, dated
   * too far from the host's clock or badly signed; and ops passed on that nobody asked for or that aren't this zone's.
   */
  opsRefused: number;
  /** As a client: ops of ours the host refused, which we took back. */
  opsRetracted: number;
}

interface Sample { t: number; x: number; y: number }

/** A player this peer currently sees. */
export interface Remote {
  info: PlayerInfo;
  samples: Sample[];
}

/**
 * A host's side of one peer's catch-up (a client's or a seed's). The host sets
 * the pace: it sends what the peer lacks a bucket at a time, asks for a few
 * buckets at a time, and accepts catch-up ops only for buckets it has asked for.
 * A bucket is a chunk's ops, a zone's atlas, or a player's own ops (BucketId).
 */
interface SyncState {
  /** The peer's digests have been handled; it gets one catch-up per link. */
  started: boolean;
  /** Buckets of ours the peer lacks, still to send. */
  send: string[];
  /** Buckets where the peer holds ops we may lack, not asked for yet, with how many ops it says each has. */
  want: Array<{ key: string; count: number }>;
  /** Buckets on request: how many ops may still arrive for each, and when it was asked. */
  asked: Map<string, { left: number; t: number }>;
  /** Ops this peer's catch-up may still bring. */
  budget: TokenBucket;
}

const newSync = (): SyncState => ({
  started: false, send: [], want: [], asked: new Map(), budget: new TokenBucket(SYNC_OPS_PER_SEC, SYNC_OPS_BURST),
});

/** Server-side record the host keeps for each connected client. */
interface HostedClient {
  peer: Peer;
  info?: PlayerInfo;
  /** The number this host's snapshots use for the client. Set with info. */
  n: number;
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
  /** New edits the client may still send this second. */
  editBudget: TokenBucket;
  /** How far the client sees, in tiles (its request, held within bounds). */
  view: number;
  /** Players within the client's view as of the last tick, by number. */
  inView: Set<number>;
  /** Players the client has been told about (their info), by number. */
  met: Set<number>;
  sync: SyncState;
}

/** A neighbouring zone's player near this zone, as relayed by its host. */
interface Foreign {
  info: PlayerInfo;
  n: number;
  x: number;
  y: number;
  t: number;
}

/** A seed peer linked to this host. */
interface SeedLink {
  peer: Peer;
  sync: SyncState;
  /** Ops the seed may still pass on unasked: the world's atlas ops, as they are made. */
  relay: TokenBucket;
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
  /** Players the host is currently sending this client. */
  sees: number;
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
  /** This peer's replica of the world's edits (already loaded from storage). Its clock dates everything the session checks. */
  edits: OpStore;
  /** Called for each op that changed the replica, to persist it. */
  onMerged(op: Op): void;
  /** Called for each op the replica has dropped with nothing in its place (expired, or refused by the host), to drop it from storage. */
  onRemoved?(op: Op): void;
  /** Called when the host refused an op of ours and it was taken back, with which check failed (see the reject message). */
  onRejected?(op: Op, why: string): void;
  profile: HostProfile;
  iceServers: RTCIceServer[];
  tiles: TileLookup;
  getSelf(): { x: number; y: number };
  /** How far this player can see other players, in tiles (what the screen shows). Default VIEW_RADIUS. */
  getView?(): number;
}

/**
 * Zone session. The zone host (chosen by the directory) runs the
 * authoritative tick and relays state in a star topology; everyone else
 * connects only to the host. The host sends each client only the players
 * within that client's view.
 */
export class Session {
  role: Role = 'connecting';
  hostId: string | null = null;
  /** The zone this session is joined to. Changes via setZone(). */
  zone: ZoneId;
  /** The zone's backups as the directory last announced them, best first. */
  backups: string[] = [];
  /** The players this peer currently sees: those within its view, in its zone or across a border. */
  readonly remotes = new Map<string, Remote>();
  readonly stats: SessionStats = {
    snaps: 0, snapPlayers: 0, ticks: 0, tickMs: 0, tickMaxMs: 0, lateTicks: 0, hostChanges: 0, opsRefused: 0, opsRetracted: 0,
  };

  private signal: SignalClient;
  // Client-side state
  private hostPeer: Peer | null = null;
  private seq = 0;
  private snapTick = 0;
  private snapT = 0;
  private lastDownReport = 0;
  /** Players the host has announced, by the host's number for them. */
  private met = new Map<number, PlayerInfo>();
  private hostInfo: PlayerInfo | null = null;
  /** Players in the zone, as the host's last snapshot counted them. */
  private zonePlayers = 0;
  /** Buckets already sent to the host in answer to its catch-up requests. */
  private answered = new Set<string>();
  /** Ops of ours sent to the host, which may yet refuse them: by signature, with the op each displaced. */
  private pending = new Map<string, { op: Op; prev: Op | null }>();
  /** Ticks since the replica was last swept for expired ops. */
  private sinceExpire = 0;
  /** Latest zone state from the host, when this peer is one of its backups. */
  private backupState: BackupState | null = null;
  // Host-side state
  private clients = new Map<string, HostedClient>();
  private borders: BorderLinks;
  /** Players from neighbouring zones, relayed by their hosts, by peer id. */
  private foreign = new Map<string, Foreign>();
  /** Numbers for snapshots: the host is 0, everyone else gets the next one. Never reused while hosting. */
  private nextN = 1;
  /** Players within the host player's own view as of the last tick, by number. */
  private hostView = new Set<number>();
  /** Edits each neighbouring host may still pass us. */
  private borderBudgets = new Map<string, TokenBucket>();
  /** Seed peers replicating this zone's edits, by peer id. */
  private seedLinks = new Map<string, SeedLink>();
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
      (ops, from) => this.onBorderOps(ops, from),
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

  /** Players in this zone, counting this one. */
  get playerCount(): number {
    if (this.role === 'host') {
      let n = 1;
      for (const c of this.clients.values()) if (c.info) n++;
      return n;
    }
    return this.zonePlayers || this.remotes.size + 1;
  }

  /** How far this peer sees other players, in tiles. */
  get viewRadius(): number {
    return clampView(this.o.getView?.() ?? VIEW_RADIUS);
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
    this.clearHostView();
    this.clearClientView();
    this.borders.close();
    this.closeSeeds();
    this.snapT = 0;
    this.backups = [];
    this.backupState = null;
    this.inherited = null;
    hostPeer?.close();
    for (const c of clients) c.peer.close();
  }

  /** Forget what a host tracked about who is where. */
  private clearHostView() {
    this.foreign.clear();
    this.hostView.clear();
    this.borderBudgets.clear();
  }

  /** Forget what a client learned from its host. */
  private clearClientView() {
    this.met.clear();
    this.hostInfo = null;
    this.zonePlayers = 0;
    this.answered.clear();
    this.pending.clear();
  }

  // ---------------- edits ----------------

  /**
   * Pass on an op this peer just made (already merged locally): to the host
   * when a client, or to clients, seeds and neighbouring hosts when the host.
   * With no host yet, it stays local and goes out on the next sync. `prev` is
   * the op it displaced in this replica, if any: should the host refuse the
   * op, it is taken back and `prev` stands again.
   */
  publish(op: Op, prev: Op | null = null) {
    if (this.role === 'host') {
      this.spread([op], null);
    } else if (this.role === 'client' && this.hostPeer) {
      this.pending.set(op.sig, { op, prev });
      if (this.pending.size > PENDING_MAX) this.pending.delete(this.pending.keys().next().value!);
      this.hostPeer.sendR({ t: 'edit', op });
    }
  }

  /** The players this host is the authority for, by public key: itself and its clients. */
  private isHere(author: string): boolean {
    if (author === this.o.identity.pub) return true;
    for (const c of this.clients.values()) if (c.pub === author) return true;
    return false;
  }

  /** The well-formed ops in an untrusted list, each with only an op's own fields. */
  private clean(ops: unknown): Op[] {
    if (!Array.isArray(ops)) return [];
    const out: Op[] = [];
    for (const raw of ops.slice(0, MAX_OPS_PER_MESSAGE)) {
      const op = asOp(raw);
      if (op) out.push(op);
    }
    return out;
  }

  /**
   * Verify untrusted ops, merge them, persist what changed, and spread it if
   * hosting. Ops that wouldn't change the replica (ones it already has, ones
   * that lose to what it has, expired ones) and ops dated too far ahead are
   * dropped before the signature check, which is the costly part.
   */
  private async receiveOps(ops: Op[], from: string | null, verified = false): Promise<Op[]> {
    const store = this.o.edits, now = store.now();
    const news = ops.filter((op) => !isTooNew(op, now) && store.wouldChange(op));
    if (!news.length) return [];
    const valid = verified
      ? news
      : (await Promise.all(news.map(async (op) => ((await verifyOp(this.o.world, op)) ? op : null))))
        .filter((op): op is Op => op !== null);
    const changed = valid.filter((op) => store.merge(op));
    for (const op of changed) this.o.onMerged(op);
    if (changed.length && this.role === 'host') this.spread(changed, from);
    return changed;
  }

  /**
   * Host: send ops on, except to the link they came from. Zone-scope ops go to
   * every client, every seed and the neighbouring hosts they're near; world-
   * scope ops to every client, seed and neighbouring host; a player's own ops
   * to the seeds and to that player, nobody else.
   */
  private spread(ops: Op[], except: string | null) {
    const shared = ops.filter((op) => LAYERS[op.l].scope !== 'player');
    const personal = ops.filter((op) => LAYERS[op.l].scope === 'player');
    for (const [id, c] of this.clients) {
      if (!c.info || id === except) continue;
      const own = personal.filter((op) => op.author === c.pub);
      this.sendOps(c.peer, own.length ? shared.concat(own) : shared);
    }
    for (const [id, s] of this.seedLinks) if (id !== except) this.sendOps(s.peer, ops);
    this.borders.sendOps(shared, except);
  }

  private sendOps(peer: Peer, ops: Op[]) {
    for (let i = 0; i < ops.length; i += OPS_PER_MESSAGE) peer.sendR({ t: 'edits', ops: ops.slice(i, i + OPS_PER_MESSAGE) });
  }

  /**
   * Host: a client's new op. It is accepted only from its author, within the
   * rate limit, within reach of where the client is, and dated close to the
   * host's own clock. A refused op is sent back, so the client takes it back.
   */
  private async hostOnEdit(id: string, raw: unknown) {
    const c = this.clients.get(id);
    const op = asOp(raw);
    if (!c?.info || !op) return;
    const store = this.o.edits, now = store.now();
    const why =
      op.author !== c.pub ? 'author'
      : !c.editBudget.take(performance.now()) ? 'rate'
      : !inReach(op, c.x, c.y) ? 'reach'
      : Math.abs(op.at - now) > AT_LIVE_S || isExpired(op, now) ? 'clock'
      : null;
    if (why) {
      this.stats.opsRefused++;
      return this.reject(c, op, why);
    }
    if (store.current(op)?.sig === op.sig) return; // Held already (it also came by catch-up).
    if (!store.wouldChange(op)) return this.reject(c, op, 'lost');
    if (!(await verifyOp(this.o.world, op))) {
      this.stats.opsRefused++;
      return this.reject(c, op, 'sig');
    }
    const changed = await this.receiveOps([op], id, true);
    if (!changed.length && store.current(op)?.sig !== op.sig) this.reject(c, op, 'lost');
  }

  /** Host: tell a client its op was refused, and what stands at that key here, so its replica comes back in step. */
  private reject(c: HostedClient, op: Op, why: string) {
    const cur = this.o.edits.current(op);
    c.peer.sendR(cur && cur.sig !== op.sig ? { t: 'reject', sig: op.sig, why, cur } : { t: 'reject', sig: op.sig, why });
  }

  /** Client: the host refused an op of ours. Take it back, and take what the host holds there instead. */
  private async onReject(sig: unknown, why: unknown, cur: unknown) {
    const p = typeof sig === 'string' ? this.pending.get(sig) : undefined;
    if (!p) return;
    this.pending.delete(p.op.sig);
    const store = this.o.edits;
    if (store.retract(p.op, p.prev)) {
      this.stats.opsRetracted++;
      const stands = store.current(p.op);
      if (stands) this.o.onMerged(stands);
      else this.o.onRemoved?.(p.op);
    }
    const theirs = asOp(cur);
    if (theirs && opKey(theirs) === opKey(p.op)) await this.receiveOps([theirs], null);
    this.o.onRejected?.(p.op, String(why).slice(0, 16));
  }

  /** Whether a zone-scope op is this zone's to keep: in it, or near enough to be seen from it. */
  private nearZone(op: Op): boolean {
    const at = opPoint(op);
    return !!at && distToZone(at.x, at.y, this.zone) <= BORDER_VIEW;
  }

  /**
   * Host: a neighbouring host passes on ops. World-scope ops are taken from
   * anywhere: the atlas is the whole world's. Zone-scope ops must be near our
   * zone, and a player's own ops never cross between hosts. Each neighbour has
   * a budget.
   */
  private onBorderOps(raw: unknown, from: string) {
    if (this.role !== 'host' || !Array.isArray(raw)) return;
    const ours = this.clean(raw).filter((op) => {
      const scope = LAYERS[op.l].scope;
      return scope === 'world' || (scope === 'zone' && this.nearZone(op));
    });
    let budget = this.borderBudgets.get(from);
    if (!budget) this.borderBudgets.set(from, (budget = new TokenBucket(SYNC_OPS_PER_SEC, SYNC_OPS_BURST)));
    this.stats.opsRefused += raw.length - ours.length;
    if (!ours.length) return;
    if (!budget.take(performance.now(), ours.length)) {
      this.stats.opsRefused += ours.length;
      return;
    }
    void this.receiveOps(ours, from);
  }

  /**
   * Host: a peer's digests. Queue the buckets it lacks to send, and the
   * buckets where it has ops we may lack to ask for. A peer syncs this zone's
   * chunks and the whole atlas; a client (`pub` is its key) also its own
   * player-scope ops, and nobody else's.
   */
  private startSync(peer: Peer, s: SyncState, d: unknown, pub: string | null) {
    if (s.started || !d || typeof d !== 'object') return;
    s.started = true;
    const theirs = d as Record<string, unknown>;
    const store = this.o.edits;
    const keys = new Set<string>(zoneChunkBuckets(this.zone));
    for (const id of store.bucketIds('z')) keys.add(id);
    for (const id of Object.keys(theirs).slice(0, MAX_SYNC_KEYS)) if (atlasZone(id)) keys.add(id);
    if (pub) keys.add(playerBucket(pub));
    for (const key of keys) {
      const ours = store.digest(key);
      const them = typeof theirs[key] === 'string' ? (theirs[key] as string) : '';
      if (ours === them) continue;
      if (ours) s.send.push(key);
      // A digest starts with the bucket's op count. The host takes no more than a bucket can hold.
      if (them) s.want.push({ key, count: Math.min(bucketCap(key), Math.max(1, parseInt(them, 10) || 1)) });
    }
    this.pumpSync(peer, s, performance.now());
  }

  /**
   * Host: exchange the player-scope ops of the players here with a seed. The
   * seed keeps every player's latest; whichever side holds the newer wins, so
   * an old purse can't be brought back by reconnecting.
   */
  private syncPlayers(link: SeedLink, authors: string[]) {
    if (!link.sync.started || !authors.length) return;
    const buckets = authors.map(playerBucket);
    for (const key of buckets) if (this.o.edits.digest(key)) link.sync.send.push(key);
    link.peer.sendR({ t: 'syncWant', keys: buckets });
    this.pumpSync(link.peer, link.sync, performance.now());
  }

  /** Host: move a peer's catch-up along. Called when it starts and on every tick while there's work. */
  private pumpSync(peer: Peer, s: SyncState, now: number) {
    while (s.send.length && peer.backlog < SYNC_BACKLOG_BYTES) this.sendOps(peer, this.o.edits.bucketOps(s.send.shift()!));
    for (const [key, a] of s.asked) if (now - a.t > SYNC_ANSWER_MS) s.asked.delete(key);
    const ask: string[] = [];
    while (s.want.length && s.asked.size < SYNC_CHUNKS_AT_ONCE && s.budget.take(now, s.want[0].count)) {
      const w = s.want.shift()!;
      s.asked.set(w.key, { left: w.count, t: now });
      ask.push(w.key);
    }
    if (ask.length) peer.sendR({ t: 'syncWant', keys: ask });
  }

  /**
   * Host: ops a syncing peer sent. Only ops in buckets the host asked that
   * peer for are taken, and no more per bucket than the peer said it had, so
   * catch-up can't be used to push ops at will. (What it can't do is tell an
   * old op from a new one: see PLAN.md.) The rest come back as `unasked`.
   */
  private takeSynced(s: SyncState, ops: unknown): { taken: Op[]; unasked: Op[] } {
    const taken: Op[] = [], unasked: Op[] = [];
    for (const op of this.clean(ops)) {
      const key = bucketOf(op);
      const a = s.asked.get(key);
      if (!a) {
        unasked.push(op);
        continue;
      }
      if (--a.left <= 0) s.asked.delete(key);
      taken.push(op);
    }
    return { taken, unasked };
  }

  /** Host: ops from a client's catch-up. Anything the host didn't ask for is refused. */
  private onClientOps(c: HostedClient, id: string, ops: unknown) {
    const { taken, unasked } = this.takeSynced(c.sync, ops);
    this.stats.opsRefused += unasked.length;
    void this.receiveOps(taken, id);
  }

  /**
   * Host: ops from a seed. Besides what the host asked for, a seed passes on
   * the world's atlas ops as they are made, and answers for the players here
   * with their own ops. Those are taken unasked, within a budget.
   */
  private onSeedOps(link: SeedLink, id: string, ops: unknown) {
    const { taken, unasked } = this.takeSynced(link.sync, ops);
    const extra = unasked.filter((op) => {
      const scope = LAYERS[op.l].scope;
      return scope === 'world' || (scope === 'player' && this.isHere(op.author));
    });
    this.stats.opsRefused += unasked.length - extra.length;
    if (extra.length && !link.relay.take(performance.now(), extra.length)) {
      this.stats.opsRefused += extra.length;
      extra.length = 0;
    }
    void this.receiveOps(taken.concat(extra), id);
  }

  /** Host: a seed peer is dialling in. It's a replica of the world's edits, not a player. */
  private acceptSeed(id: string) {
    this.seedLinks.get(id)?.peer.close();
    const peer: Peer = new Peer(id, false, this.o.iceServers, this.sendSignal(id, 'seed'), {
      onOpen: () => {},
      onClose: () => {
        if (this.seedLinks.get(id)?.peer === peer) this.seedLinks.delete(id);
      },
      onReliable: (m) => {
        if (m.t === 'sync') {
          this.startSync(peer, link.sync, m.d, null);
          const here = [this.o.identity.pub];
          for (const c of this.clients.values()) if (c.info && c.pub) here.push(c.pub);
          this.syncPlayers(link, here);
        } else if (m.t === 'edits') {
          this.onSeedOps(link, id, m.ops);
        }
      },
      onUnreliable: () => {},
    }, new LinkGuard(HOST_LINK_LIMITS));
    const link: SeedLink = { peer, sync: newSync(), relay: new TokenBucket(SYNC_OPS_PER_SEC, SYNC_OPS_BURST) };
    this.seedLinks.set(id, link);
  }

  private closeSeeds() {
    const links = [...this.seedLinks.values()];
    this.seedLinks.clear();
    for (const s of links) s.peer.close();
  }

  /** Client: right after connecting, tell the host what we hold: this zone's chunks, the atlas, and our own player-scope ops. */
  private sendSync(peer: Peer) {
    peer.sendR({ t: 'sync', d: syncDigests(this.o.edits, this.zone, this.o.identity.pub, SYNC_ATLAS_ZONES) });
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
          void this.seedLinks.get(m.from)?.peer.handleSignal(m.data);
          break;
        }
        if (this.role === 'host') {
          if (m.data.kind === 'offer') this.acceptClient(m.from);
          void this.clients.get(m.from)?.peer.handleSignal(m.data);
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
    this.clearClientView();
    this.clearHostView();
    this.nextN = 1;
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
        const c = this.clients.get(id);
        if (c?.peer !== peer) return;
        this.clients.delete(id);
        this.remotes.delete(id);
        if (c.info) this.forget(c.n);
      },
      onReliable: (m) => this.hostOnReliable(id, m),
      onUnreliable: (m) => this.hostOnUnreliable(id, m),
    }, new LinkGuard(CLIENT_LIMITS));
    this.clients.set(id, {
      peer, n: -1, x: 0, y: 0, lastSeq: -1, lastT: 0, reports: 0, corrections: 0, rttMs: null,
      editBudget: new TokenBucket(EDITS_PER_SEC, EDITS_PER_SEC), view: VIEW_RADIUS, inView: new Set(), met: new Set(), sync: newSync(),
    });
  }

  private hostOnReliable(id: string, m: Reliable) {
    const c = this.clients.get(id);
    if (!c) return;
    if (m.t === 'edit') return void this.hostOnEdit(id, m.op);
    if (m.t === 'edits') return void (c.info && this.onClientOps(c, id, m.ops));
    if (m.t === 'sync') return void (c.info && this.startSync(c.peer, c.sync, m.d, c.pub ?? null));
    if (m.t === 'hello' && !c.info) {
      c.info = { ...sanitize(m.info), id };
      c.n = this.nextN++;
      if (typeof m.pub === 'string' && m.pub.length > 0 && m.pub.length <= 64) {
        c.pub = m.pub;
        // The seed may hold this player's own ops (its purse), newer than what the player brings.
        for (const link of this.seedLinks.values()) this.syncPlayers(link, [m.pub]);
      }
      // A client belongs to this zone only within its margin: hold a claimed position to that.
      const at = clampToZone(Number(m.x) || 0, Number(m.y) || 0, this.zone, ZONE_MARGIN);
      c.x = at.x;
      c.y = at.y;
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
      // Now hosted here; no longer relayed by a neighbour.
      const was = this.foreign.get(id);
      if (was) {
        this.foreign.delete(id);
        this.forget(was.n);
      }
      // The client always knows its host, however far apart they stand.
      c.met.add(0);
      c.peer.sendR({ t: 'meet', players: [{ ...this.o.info, n: 0 }] });
    }
  }

  private hostOnUnreliable(id: string, m: Unreliable) {
    const c = this.clients.get(id);
    if (c && m.t === 'pong') {
      const rtt = performance.now() - m.ts;
      if (rtt >= 0 && rtt < 10_000) c.rttMs = smooth(c.rttMs, rtt);
      return;
    }
    if (!c?.info || m.t !== 'pos' || !(m.seq > c.lastSeq)) return;
    c.view = clampView(m.view || VIEW_RADIUS);
    const now = performance.now();
    // Lenient anti-teleport: clamp to max plausible travel since last update.
    const maxD = PLAYER_SPEED * ((now - c.lastT) / 1000 + 0.25) * 1.5;
    let dx = m.x - c.x, dy = m.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d > maxD) (dx *= maxD / d), (dy *= maxD / d), c.corrections++;
    const nx = c.x + dx, ny = c.y + dy;
    // Never through walls, and never out of this zone's reach: beyond its margin a player belongs to another zone.
    if (!isWalkable(this.o.tiles(Math.floor(nx), Math.floor(ny))) || distToZone(nx, ny, this.zone) > ZONE_MARGIN + ZONE_SLACK) {
      c.corrections++;
      return;
    }
    c.reports++;
    c.x = nx;
    c.y = ny;
    c.lastSeq = m.seq;
    c.lastT = now;
  }

  /** A player's number is gone for good (it left, or was given a new one): drop it from everyone's view. */
  private forget(n: number) {
    this.hostView.delete(n);
    for (const c of this.clients.values()) {
      c.inView.delete(n);
      c.met.delete(n);
    }
  }

  /** A neighbouring host reported one of its players near our zone. */
  private onForeign(info: PlayerInfo, x: number, y: number) {
    if (this.role !== 'host' || info.id === this.o.peerId || this.clients.has(info.id)) return;
    const now = performance.now();
    const f = this.foreign.get(info.id);
    if (f && f.info.name === info.name && f.info.hue === info.hue) {
      f.x = x;
      f.y = y;
      f.t = now;
      return;
    }
    // New here, or its info changed: a new number, so clients are told who it is.
    if (f) this.forget(f.n);
    this.foreign.set(info.id, { info, n: this.nextN++, x, y, t: now });
  }

  /** Forget neighbouring zones' players that have gone quiet (out of range, or their link dropped). */
  private expireForeign(now: number) {
    for (const [id, f] of this.foreign) {
      if (f.t >= now - FOREIGN_TTL_MS) continue;
      this.foreign.delete(id);
      this.remotes.delete(id);
      this.forget(f.n);
    }
  }

  // ---------------- client role ----------------

  private becomeClient(hostId: string) {
    if (this.role === 'client' && this.hostId === hostId && this.hostPeer?.isOpen) return; // Already connected.
    if (this.role === 'host') {
      this.o.profile.setHosting(false);
      for (const c of this.clients.values()) c.peer.close();
      this.clients.clear();
      this.clearHostView();
      this.borders.close();
      this.closeSeeds();
    }
    if (this.hostPeer?.remoteId === hostId && !this.hostPeer.isOpen) return; // already dialing
    this.hostPeer?.close();
    this.role = 'connecting';
    this.hostId = hostId;
    this.remotes.clear();
    this.clearClientView();
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
        this.clearClientView();
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
        if (this.hostPeer !== peer) return;
        if (m.t === 'edits') {
          // Everything a host sends is taken, except another player's own ops: those are not ours to hold.
          const me = this.o.identity.pub;
          return void this.receiveOps(this.clean(m.ops).filter((op) => LAYERS[op.l].scope !== 'player' || op.author === me), null);
        }
        if (m.t === 'reject') return void this.onReject(m.sig, m.why, m.cur);
        if (m.t === 'syncWant') {
          // The host asks for buckets where we may hold ops it lacks: this zone's chunks, any zone's atlas,
          // and our own player-scope ops. Each is sent once per link.
          const mine = new Set([...zoneChunkBuckets(this.zone), playerBucket(this.o.identity.pub)]);
          const keys = Array.isArray(m.keys)
            ? m.keys.filter((k) => typeof k === 'string' && (mine.has(k) || atlasZone(k)) && !this.answered.has(k))
            : [];
          for (const k of keys) this.answered.add(k);
          return this.sendOps(peer, keys.flatMap((k) => this.o.edits.bucketOps(k)));
        }
        if (m.t !== 'meet' || !Array.isArray(m.players)) return;
        for (const p of m.players.slice(0, 4096)) {
          const n = Number(p?.n);
          if (!Number.isSafeInteger(n) || n < 0) continue;
          const info = sanitize(p);
          this.met.set(n, info);
          if (info.id === hostId) this.hostInfo = info;
          const r = this.remotes.get(info.id);
          if (r) r.info = info;
        }
      },
      onUnreliable: (m) => {
        if (this.hostPeer !== peer) return;
        if (m.t === 'ping') return peer.sendU({ t: 'pong', ts: m.ts });
        if (m.t === 'state') {
          if (!this.backups.includes(this.o.peerId)) return;
          const players = new Map<string, { x: number; y: number }>();
          for (const [pid, x, y] of m.p) players.set(pid, { x, y });
          this.backupState = { tick: m.tick, players, t: performance.now() };
          return;
        }
        if (m.t !== 'snap') return;
        const now = performance.now();
        this.snapTick = m.tick;
        this.snapT = now;
        this.zonePlayers = m.n;
        this.stats.snaps++;
        this.stats.snapPlayers += m.p.length;
        for (const [n, x, y] of m.p) {
          const info = this.met.get(n);
          if (!info || info.id === this.o.peerId) continue; // Not announced yet (it arrives on the reliable channel).
          let r = this.remotes.get(info.id);
          if (!r) this.remotes.set(info.id, (r = { info, samples: [] }));
          pushSample(r, now, x, y);
        }
        // A player the host has stopped sending has left our view.
        for (const [pid, r] of this.remotes) {
          if (r.samples[r.samples.length - 1].t < now - VIEW_TTL_MS) this.remotes.delete(pid);
        }
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
    // Ops that have outlived their layer's lifetime are dropped here and from storage. Nothing is sent: every replica does the same.
    if (++this.sinceExpire >= EXPIRE_EVERY_TICKS) {
      this.sinceExpire = 0;
      for (const op of this.o.edits.expire()) this.o.onRemoved?.(op);
    }
    const self = this.o.getSelf();
    if (this.role === 'host') {
      this.hostTick(self);
    } else if (this.role === 'client' && this.hostPeer) {
      this.hostPeer.sendU({ t: 'pos', seq: this.seq++, x: self.x, y: self.y, view: this.viewRadius });
      // The host has gone quiet: ask the directory to check on it.
      const now = performance.now();
      if (this.snapT && now - this.snapT > HOST_SILENCE_MS && now - this.lastDownReport > HOST_SILENCE_MS) {
        this.lastDownReport = now;
        this.signal.send({ t: 'hostDown', zone: this.zone });
      }
    }
  }

  private hostTick(self: { x: number; y: number }) {
    this.tick++;
    const now = performance.now();
    if (this.lastTickT) {
      const late = now - this.lastTickT > LATE_TICK_MS;
      if (late) this.stats.lateTicks++;
      this.late.push(late);
      if (this.late.length > LATE_WINDOW) this.late.shift();
    }
    this.lastTickT = now;
    const ping = this.tick % TICK_HZ === 0;

    // Everyone this host is the authority for: itself (number 0) and its clients.
    const local: LocalPlayer[] = [{ info: this.o.info, n: 0, x: self.x, y: self.y }];
    for (const c of this.clients.values()) {
      if (!c.info) continue;
      local.push({ info: c.info, n: c.n, x: c.x, y: c.y });
      if (ping) c.peer.sendU({ t: 'ping', ts: now });
      if (c.sync.send.length || c.sync.want.length || c.sync.asked.size) this.pumpSync(c.peer, c.sync, now);
    }
    for (const s of this.seedLinks.values()) {
      if (s.sync.send.length || s.sync.want.length || s.sync.asked.size) this.pumpSync(s.peer, s.sync, now);
    }
    this.borders.tick(local);
    this.expireForeign(now);

    // Plus the neighbouring zones' players near this zone: everyone who can be seen from here.
    const all: LocalPlayer[] = local.slice();
    for (const f of this.foreign.values()) all.push(f);

    // The host player's own view.
    const view = this.viewRadius;
    for (const p of all) {
      if (p.n === 0) continue;
      if (!inView(self, p, view, this.hostView.has(p.n))) {
        if (this.hostView.delete(p.n)) this.remotes.delete(p.info.id);
        continue;
      }
      this.hostView.add(p.n);
      let r = this.remotes.get(p.info.id);
      if (!r) this.remotes.set(p.info.id, (r = { info: p.info, samples: [] }));
      else r.info = p.info;
      pushSample(r, now, p.x, p.y);
    }

    // Each client gets the players within its own view, and is told who they are the first time.
    for (const c of this.clients.values()) {
      if (!c.info) continue;
      const seen: PlayerPos[] = [];
      let meet: PlayerEntry[] | null = null;
      for (const p of all) {
        if (p.n === c.n) continue;
        if (!inView(c, p, c.view, c.inView.has(p.n))) {
          c.inView.delete(p.n);
          continue;
        }
        c.inView.add(p.n);
        if (!c.met.has(p.n)) {
          c.met.add(p.n);
          (meet ??= []).push({ ...p.info, n: p.n });
        }
        seen.push([p.n, p.x, p.y]);
      }
      if (meet) c.peer.sendR({ t: 'meet', players: meet });
      c.peer.sendU({ t: 'snap', tick: this.tick, n: local.length, p: seen });
    }

    if (this.tick % STATE_EVERY_TICKS === 0 && this.backups.length) {
      const state: Unreliable = { t: 'state', tick: this.tick, p: local.map((l) => [l.info.id, l.x, l.y]) };
      for (const id of this.backups) this.clients.get(id)?.peer.sendU(state);
    }
    const spent = performance.now() - now;
    this.stats.ticks++;
    this.stats.tickMs += spent;
    if (spent > this.stats.tickMaxMs) this.stats.tickMaxMs = spent;
  }

  // ---------------- debug ----------------

  get signalUp(): boolean {
    return this.signal.connected;
  }

  /** Traffic counters for every link in this tab (or bot process). */
  get net(): typeof netStats {
    return netStats;
  }

  /** The host this client reports to, or null when hosting or not yet assigned. */
  hostDebug(): HostDebug | null {
    if (this.role === 'host' || !this.hostId) return null;
    const now = performance.now();
    const rank = this.backups.indexOf(this.o.peerId);
    const st = this.backupState;
    return {
      id: this.hostId,
      name: this.hostInfo?.name ?? null,
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

  /** Seed peers linked to this host (open links only). */
  get seedCount(): number {
    return this.role === 'host' ? [...this.seedLinks.values()].filter((s) => s.peer.isOpen).length : 0;
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
      rttMs: c.rttMs,
      sees: c.inView.size,
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

function pushSample(r: Remote, t: number, x: number, y: number) {
  r.samples.push({ t, x, y });
  while (r.samples.length > 2 && r.samples[0].t < t - BUFFER_MS) r.samples.shift();
}

/** A view radius held within the bounds a host allows. */
const clampView = (r: number) => Math.min(MAX_VIEW_RADIUS, Math.max(MIN_VIEW_RADIUS, Number.isFinite(r) ? r : VIEW_RADIUS));

/**
 * Whether a viewer sees a player: within the viewer's radius, or a little
 * beyond it if the player was in view already (so one at the edge doesn't flicker).
 */
function inView(viewer: { x: number; y: number }, p: { x: number; y: number }, radius: number, was: boolean): boolean {
  const r = was ? radius + VIEW_HYSTERESIS : radius;
  const dx = p.x - viewer.x, dy = p.y - viewer.y;
  return dx * dx + dy * dy <= r * r;
}

/** Exponentially smoothed round-trip time. */
const smooth = (prev: number | null, sample: number) => (prev === null ? sample : prev * 0.8 + sample * 0.2);
