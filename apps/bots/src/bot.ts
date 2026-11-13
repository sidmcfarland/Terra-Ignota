import { randomBytes } from 'node:crypto';
import { availableParallelism } from 'node:os';
import {
  EDIT_REACH, OpStore, Tile, TileCache, ZONE_MARGIN, ZONE_TILES, clientCap, findSpawn, generateIdentityKeys,
  identityFromKeys, isWading, isWalkable, nextZone, parseZone, signOp, step, tileAt, worldSeed, zoneOf,
  type HostMetrics, type Identity, type TileLookup, type ZoneId,
} from '@terra/shared';
import { Session, type HostProfile } from '../../client/src/net/session.ts';
import type { Options } from './options.ts';

/** The world the swarm plays in: its terrain and the zones the bots are spread over. */
export interface World {
  id: string;
  seed: number;
  /** Generated terrain, shared by every bot in this process. Each bot layers its own edits on top. */
  base: TileCache;
  zones: ZoneId[];
}

/** Durations (ms) the bots spent without a live link, by what caused the gap. */
export interface Tally {
  /** From starting to first being connected. */
  join: number[];
  /** Crossing into another zone: from leaving the old host to being connected in the new zone. */
  handoff: number[];
  /** The zone's host went away or changed while the bot stayed put. */
  failover: number[];
}

/** Small seeded generator, so a run with the same options walks the same paths. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * n zones that are mostly land, growing outwards from the world spawn's zone
 * through shared edges, so every zone borders another one and bots can walk
 * between them. A pure function of the world id, so every worker process picks
 * the same ones.
 */
export function pickZones(seed: number, n: number): ZoneId[] {
  const spawn = findSpawn(seed);
  const start = zoneOf(spawn.x, spawn.y);
  const out: ZoneId[] = [];
  const seen = new Set<ZoneId>([start]);
  const queue: ZoneId[] = [start];
  for (let i = 0; i < queue.length && out.length < n && i < 4000; i++) {
    const [zx, zy] = parseZone(queue[i]);
    // The spawn's zone always counts; others need to be at least half land.
    if (i > 0 && landFraction(seed, zx, zy) < 0.5) continue;
    out.push(queue[i]);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const z = `${zx + dx},${zy + dy}`;
      if (!seen.has(z)) (seen.add(z), queue.push(z));
    }
  }
  return out;
}

function landFraction(seed: number, zx: number, zy: number): number {
  const N = 6;
  let land = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const t = tileAt(seed, Math.floor((zx + (i + 0.5) / N) * ZONE_TILES), Math.floor((zy + (j + 0.5) / N) * ZONE_TILES));
      if (isWalkable(t) && !isWading(t)) land++;
    }
  }
  return land / (N * N);
}

export function makeWorld(id: string, zones: number): World {
  const seed = worldSeed(id);
  return { id, seed, base: new TileCache(seed, 4096), zones: pickZones(seed, zones) };
}

/** Election metrics for a headless peer: always in the foreground, on mains, and a desktop. */
class BotProfile implements HostProfile {
  onChange: () => void = () => {};
  private readonly optIn: boolean;
  private readonly cap: number;
  private readonly started = performance.now();
  private hostedMs = 0;
  private hostingSince: number | null = null;

  constructor(optIn: boolean, cap: number) {
    this.optIn = optIn;
    this.cap = cap;
  }

  setHosting(on: boolean) {
    const now = performance.now();
    if (this.hostingSince !== null) this.hostedMs += now - this.hostingSince;
    this.hostingSince = on ? now : null;
  }

  metrics(rttMs: number, lateTicks: number): HostMetrics {
    const now = performance.now();
    return {
      optIn: this.optIn,
      visible: true,
      mobile: false,
      battery: false,
      rttMs: Math.round(rttMs),
      uptimeMs: Math.round(now - this.started),
      hostedMs: Math.round(this.hostedMs + (this.hostingSince === null ? 0 : now - this.hostingSince)),
      uncleanExits: 0,
      lateTicks: Math.round(lateTicks * 1000) / 1000,
      cap: this.cap || clientCap(availableParallelism(), lateTicks),
    };
  }
}

type Gap = keyof Tally;

/**
 * One headless player: a real zone Session (the client's own code) driven by a
 * simple walker. Homebodies wander inside their zone; roamers walk back and
 * forth across its borders, changing zones as a player would.
 */
export class Bot {
  readonly index: number;
  readonly session: Session;
  readonly pos: { x: number; y: number };
  zone: ZoneId;
  crossings = 0;
  editsMade = 0;
  /** Ops merged into this bot's replica from the network. */
  merged = 0;
  /** For the per-second snapshot rate: the count at the last sample, and whether the bot was a client then. */
  lastSnaps = 0;
  wasClient = false;

  private readonly world: World;
  private readonly o: Options;
  private readonly rand: () => number;
  private readonly identity: Identity;
  private readonly edits = new OpStore();
  private readonly tiles: TileLookup;
  private readonly roamer: boolean;
  private readonly home: ZoneId;
  private readonly tally: Tally;
  private target: { x: number; y: number } | null = null;
  /** Distance covered since the last progress check, to notice being stuck. */
  private moved = 0;
  private checkT = 0;
  private downSince: number | null;
  private downCause: Gap = 'join';
  private painting = false;

  static async create(index: number, world: World, o: Options, tally: Tally): Promise<Bot> {
    return new Bot(index, world, o, tally, await identityFromKeys(await generateIdentityKeys()));
  }

  private constructor(index: number, world: World, o: Options, tally: Tally, identity: Identity) {
    this.index = index;
    this.world = world;
    this.o = o;
    this.tally = tally;
    this.identity = identity;
    this.rand = mulberry32(world.seed ^ Math.imul(index + 1, 0x9e3779b1));
    this.tiles = (x, y) => this.edits.tile(x, y) ?? world.base.get(x, y);
    // Bots are dealt to zones in turn, and roles go by a bot's rank within its zone, so
    // every zone gets its share of hosts and roamers. The first bot in each zone can host.
    this.home = world.zones[index % world.zones.length];
    const rank = Math.floor(index / world.zones.length);
    this.roamer = fraction(rank, o.roam, 0.5);
    this.pos = this.spawn();
    this.zone = zoneOf(this.pos.x, this.pos.y);
    this.downSince = performance.now();

    const peerId = `bot${index}-${randomBytes(6).toString('base64url')}`;
    this.session = new Session({
      signalUrl: o.signal,
      world: world.id,
      zone: this.zone,
      peerId,
      info: { id: peerId, name: `Bot ${index}`, hue: Math.floor(this.rand() * 360) },
      identity,
      edits: this.edits,
      onMerged: () => this.merged++,
      profile: new BotProfile(fraction(rank, o.hosts, 1 - o.hosts + 1e-9), o.cap),
      iceServers: o.stun ? [{ urls: o.stun }] : [],
      tiles: this.tiles,
      getSelf: () => this.pos,
      getView: () => o.view,
    });
  }

  /** Linked to a live zone: hosting it, or receiving its host's snapshots. */
  get connected(): boolean {
    const s = this.session;
    if (s.role === 'host') return true;
    if (s.role !== 'client') return false;
    const h = s.hostDebug();
    return !!h && h.open && h.snapAgeMs !== null && h.snapAgeMs < 1000;
  }

  /** Advance the bot by dt seconds. */
  step(dt: number, now: number) {
    this.walk(dt, now);
    const zone = nextZone(this.zone, this.pos.x, this.pos.y);
    if (zone !== this.zone) {
      this.zone = zone;
      this.crossings++;
      this.session.setZone(zone);
      this.downSince = now;
      this.downCause = 'handoff';
    }
    const up = this.connected;
    if (!up && this.downSince === null) {
      this.downSince = now;
      this.downCause = 'failover';
    } else if (up && this.downSince !== null) {
      this.tally[this.downCause].push(now - this.downSince);
      this.downSince = null;
    }
    if (up && this.o.edits > 0 && !this.painting && this.rand() < this.o.edits * dt) void this.paint();
  }

  close() {
    this.session.close();
  }

  private walk(dt: number, now: number) {
    const t = this.target;
    const dist = t ? Math.hypot(t.x - this.pos.x, t.y - this.pos.y) : 0;
    if (!t || dist < 1) {
      this.retarget(now);
      return;
    }
    // All movement goes through the shared step(), as the client's does.
    const next = step(this.tiles, this.pos, { x: (t.x - this.pos.x) / dist, y: (t.y - this.pos.y) / dist }, dt);
    this.moved += Math.hypot(next.x - this.pos.x, next.y - this.pos.y);
    this.pos.x = next.x;
    this.pos.y = next.y;
    if (now - this.checkT > 1000) {
      if (this.moved < 1.5) this.retarget(now); // Blocked by water, rock or a wall: head somewhere else.
      this.moved = 0;
      this.checkT = now;
    }
  }

  private retarget(now: number) {
    this.moved = 0;
    this.checkT = now;
    this.target = (this.roamer && this.acrossBorder()) || this.nearby();
  }

  /** A walkable spot within a short walk that keeps a homebody inside its zone. */
  private nearby(): { x: number; y: number } {
    const [zx, zy] = parseZone(this.roamer ? this.zone : this.home);
    const x0 = zx * ZONE_TILES + 6, y0 = zy * ZONE_TILES + 6, span = ZONE_TILES - 12;
    for (let i = 0; i < 30; i++) {
      const x = clamp(this.pos.x + (this.rand() - 0.5) * 100, x0, x0 + span);
      const y = clamp(this.pos.y + (this.rand() - 0.5) * 100, y0, y0 + span);
      if (this.land(x, y)) return { x, y };
    }
    return { x: this.pos.x + (this.rand() - 0.5) * 8, y: this.pos.y + (this.rand() - 0.5) * 8 };
  }

  /** A spot past the border in a neighbouring swarm zone, deep enough that walking there changes zone. */
  private acrossBorder(): { x: number; y: number } | null {
    const [zx, zy] = parseZone(this.zone);
    const options = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.world.zones.includes(`${zx + dx},${zy + dy}`));
    if (!options.length) return null;
    const [dx, dy] = options[Math.floor(this.rand() * options.length)];
    const x0 = zx * ZONE_TILES, y0 = zy * ZONE_TILES;
    for (let i = 0; i < 30; i++) {
      const depth = ZONE_MARGIN + 8 + this.rand() * 30;
      const side = (this.rand() - 0.5) * 60;
      const x = dx ? (dx > 0 ? x0 + ZONE_TILES + depth : x0 - depth) : clamp(this.pos.x + side, x0 + 8, x0 + ZONE_TILES - 8);
      const y = dy ? (dy > 0 ? y0 + ZONE_TILES + depth : y0 - depth) : clamp(this.pos.y + side, y0 + 8, y0 + ZONE_TILES - 8);
      if (this.land(x, y)) return { x, y };
    }
    return null;
  }

  /** Where the bot starts: anywhere on land in its home zone; a roamer starts near one of its borders. */
  private spawn(): { x: number; y: number } {
    const [zx, zy] = parseZone(this.home);
    const x0 = zx * ZONE_TILES, y0 = zy * ZONE_TILES;
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.world.zones.includes(`${zx + dx},${zy + dy}`));
    for (let i = 0; i < 400; i++) {
      let x = x0 + 8 + this.rand() * (ZONE_TILES - 16), y = y0 + 8 + this.rand() * (ZONE_TILES - 16);
      if (this.roamer && neighbours.length && i < 200) {
        const [dx, dy] = neighbours[Math.floor(this.rand() * neighbours.length)];
        const inset = 4 + this.rand() * 30;
        if (dx) x = dx > 0 ? x0 + ZONE_TILES - inset : x0 + inset;
        else y = dy > 0 ? y0 + ZONE_TILES - inset : y0 + inset;
      }
      if (this.land(x, y)) return { x, y };
    }
    return { x: x0 + ZONE_TILES / 2, y: y0 + ZONE_TILES / 2 };
  }

  private land(x: number, y: number): boolean {
    const t = this.tiles(Math.floor(x), Math.floor(y));
    return isWalkable(t) && !isWading(t);
  }

  /** Paint a tile within reach: a path, or back to the generated tile. Never a wall, which would pen bots in. */
  private async paint() {
    this.painting = true;
    try {
      const reach = EDIT_REACH - 1;
      const x = Math.floor(this.pos.x + (this.rand() - 0.5) * 2 * reach);
      const y = Math.floor(this.pos.y + (this.rand() - 0.5) * 2 * reach);
      const tile = this.rand() < 0.3 ? null : Tile.Path;
      const op = await signOp(this.world.id, this.identity, {
        l: 'tile', x, y, v: tile, clock: this.edits.nextClock(), at: this.edits.now(),
      });
      const prev = this.edits.current(op) ?? null;
      if (this.edits.merge(op)) this.session.publish(op, prev);
      this.editsMade++;
    } finally {
      this.painting = false;
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** True for a `share` of ranks, spread evenly. The offset shifts which ranks are picked. */
function fraction(rank: number, share: number, offset = 0): boolean {
  return Math.floor((rank + 1) * share + offset) > Math.floor(rank * share + offset);
}
