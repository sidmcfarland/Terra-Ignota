/**
 * World edits: signed ops, kept in layers.
 *
 * Everything that outlives a session is an op in some layer: a painted tile, a
 * charted map square, a harvest, a player's purse. A layer says what its ops
 * are keyed by, how two ops for the same key are merged, how far they spread
 * and whether they expire (see LAYERS). Merging depends only on the ops
 * themselves and the date, never on the order they arrive in, so replicas
 * converge without consensus. Terrain itself is never sent: an edit only lies
 * on top of the generated world.
 *
 * The design is docs/M5_DESIGN.md, section 1.
 */
import { wallClock } from './clock.ts';
import { CHUNK, ZONE_CHUNKS, ZONE_TILES } from './constants.ts';
import { hashString } from './rng.ts';
import { Tile } from './worldgen.ts';
import type { ZoneId } from './zones.ts';

export type Layer =
  | 'tile' | 'sign' | 'take' | 'chart' | 'found' | 'name' | 'way' | 'give' | 'cache' | 'tend' | 'who' | 'purse';

/** What an op can hold: a number, text, or a record of those. */
export type Value = number | string | { [key: string]: Value };

export interface Op {
  /** Which layer. */
  l: Layer;
  /** A tile, or a map square (chunk coordinates), as the layer says. Both 0 in a layer keyed by author alone. */
  x: number;
  y: number;
  /** The layer's value, or null to remove what was there. */
  v: Value | null;
  /** Lamport clock: in a last-wins layer, higher wins. */
  clock: number;
  /** The author's clock when the op was signed, in unix seconds: decides first-wins layers and expiry. */
  at: number;
  /** Author's Ed25519 public key, base64url. Breaks ties. */
  author: string;
  /** Ed25519 signature over opPayload(), base64url. */
  sig: string;
}

export type UnsignedOp = Omit<Op, 'sig'>;

export interface LayerDef {
  /** What x and y address: a tile, a 32×32 map square (chunk coordinates), or nothing (one entry per author). */
  key: 'tile' | 'square' | 'author';
  /** Each author keeps an entry of their own at the key. (Always so when the key is the author.) */
  perAuthor?: boolean;
  /**
   * Which of two ops for one key stands. `last`: the higher Lamport clock, then
   * author, then signature. `first`: the earlier `at`, then the lower author,
   * then signature.
   */
  merge: 'last' | 'first';
  /**
   * How far ops spread. `zone`: to peers in the op's zone, to neighbouring
   * hosts near it, and to the seed. `world`: everywhere (the atlas layers).
   * `player`: the author's device, its current host and the seed, nobody else.
   */
  scope: 'zone' | 'world' | 'player';
  /**
   * Seconds an op lasts after its `at`. Once past, every replica drops it and
   * leaves it out of digests. In such a layer the later `at` wins before the
   * clock is looked at (see opWins). Absent: ops last for good.
   */
  ttl?: number;
  /** Whether a value (null aside) is one this layer takes. Absent: the layer isn't open yet, and no op for it is accepted. */
  value?: (v: Value) => boolean;
}

/** Tiles players can paint (besides null, back to generated). */
export const PAINTABLE: readonly Tile[] = [Tile.Path, Tile.Wall];

const MATERIALS = ['w', 's', 'p', 'c', 'x'] as const;
/** A count of each material: wood, stone, pigment, copper, crystal. */
function isCounts(v: Value | undefined): boolean {
  if (v === undefined || typeof v !== 'object' || Object.keys(v).length !== MATERIALS.length) return false;
  return MATERIALS.every((m) => Number.isSafeInteger(v[m]) && (v[m] as number) >= 0);
}

/**
 * Every layer of the M5 design (docs/M5_DESIGN.md, section 1). The key, merge
 * rule, scope and lifetime of each are settled there. A layer's value rule
 * arrives with the slice that builds its mechanic; until then the layer is
 * closed. Open now: `tile` (painting), and `take`, `chart` and `purse` with the
 * design's values, so that expiry, first-wins, world scope and player scope are
 * all carried by real ops. The host checks that belong to them (a chart only
 * for the square you stand in, a purse that moves by the right amount, a take
 * only on something harvestable) come with slices 2 and 5.
 */
export const LAYERS: Record<Layer, LayerDef> = {
  tile: { key: 'tile', merge: 'last', scope: 'zone', value: (v) => PAINTABLE.includes(v as Tile) },
  sign: { key: 'tile', merge: 'last', scope: 'zone' },
  // Two hours is the design's regrow time for wood and stone. Slice 5 sets it per source.
  take: { key: 'tile', merge: 'last', scope: 'zone', ttl: 2 * 3600, value: (v) => v === 1 },
  chart: { key: 'square', merge: 'first', scope: 'world', value: (v) => v === 1 },
  found: { key: 'tile', merge: 'first', scope: 'world' },
  name: { key: 'tile', merge: 'last', scope: 'world' },
  way: { key: 'tile', merge: 'last', scope: 'world' },
  give: { key: 'tile', perAuthor: true, merge: 'last', scope: 'world' },
  cache: { key: 'tile', merge: 'last', scope: 'world' },
  tend: { key: 'square', perAuthor: true, merge: 'last', scope: 'world' },
  who: { key: 'author', merge: 'last', scope: 'world' },
  purse: {
    key: 'author', merge: 'last', scope: 'player',
    value: (v) => typeof v === 'object' && Object.keys(v).length === 2 && isCounts(v.got) && isCounts(v.used),
  },
};

/** How far (in tiles) from a player's position the host accepts their edits. */
export const EDIT_REACH = 4;
/** Edits a host accepts from one client per second. */
export const EDITS_PER_SEC = 10;
/** An op dated further ahead of a peer's clock than this (seconds) is refused by that peer. */
export const AT_AHEAD_S = 5 * 60;
/** A live op must be dated within this (seconds) of its host's clock. */
export const AT_LIVE_S = 2 * 60;
/** The longest a value may be, encoded. With its key and signature an op then stays under about 500 characters. */
export const MAX_VALUE_CHARS = 256;

/**
 * A value as the one string every peer writes it as: JSON, with a record's
 * keys in order. It is what the signature covers and what digests hash.
 */
export function encodeValue(v: Value | null): string {
  if (v === null) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${encodeValue(v[k])}`).join(',')}}`;
}

/** A number, text, or a small record of those, a few levels deep at most. */
function isValue(v: unknown, depth = 0): v is Value {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return true;
  if (!v || typeof v !== 'object' || Array.isArray(v) || depth >= 3) return false;
  const values = Object.values(v);
  return values.length <= 16 && values.every((w) => isValue(w, depth + 1));
}

/** The exact text an op's signature covers. Includes the world so an op can't be replayed elsewhere. */
export function opPayload(world: string, op: UnsignedOp): string {
  return `ti-op:1|${world}|${op.l}|${op.x}|${op.y}|${encodeValue(op.v)}|${op.clock}|${op.at}|${op.author}`;
}

/**
 * Whether `a` stands over `b`, two ops for one key. A total order, so merging
 * is the same whatever order ops arrive in.
 * - First wins: the earlier `at`, then the lower author, then the lower signature.
 * - Last wins: the higher clock, then author, then signature.
 * - Last wins in a layer that expires: the later `at` first, then as above.
 *   The op that stands is then always the one that will expire last, so
 *   dropping an expired op can never bring back one it had beaten.
 */
export function opWins(a: Op, b: Op): boolean {
  const def = LAYERS[a.l];
  if (def.merge === 'first') {
    if (a.at !== b.at) return a.at < b.at;
    if (a.author !== b.author) return a.author < b.author;
    return a.sig < b.sig;
  }
  if (def.ttl !== undefined && a.at !== b.at) return a.at > b.at;
  if (a.clock !== b.clock) return a.clock > b.clock;
  if (a.author !== b.author) return a.author > b.author;
  return a.sig > b.sig;
}

/** Whether an op has outlived its layer's lifetime at `now` (unix seconds). */
export function isExpired(op: Op, now: number): boolean {
  const ttl = LAYERS[op.l].ttl;
  return ttl !== undefined && now >= op.at + ttl;
}

/** Whether an op is dated too far ahead of `now` (unix seconds) to accept yet. */
export const isTooNew = (op: Op, now: number): boolean => op.at > now + AT_AHEAD_S;

/**
 * Structural check of an untrusted op: an open layer, a value that layer takes,
 * and every field in shape. (The signature and the date are checked separately.)
 */
export function isWellFormed(op: unknown): op is Op {
  const o = op as Op;
  if (!o || typeof o !== 'object' || typeof o.l !== 'string' || !Object.hasOwn(LAYERS, o.l)) return false;
  const def = LAYERS[o.l];
  if (!def.value) return false;
  if (!Number.isSafeInteger(o.x) || !Number.isSafeInteger(o.y)) return false;
  if (def.key === 'author' && (o.x !== 0 || o.y !== 0)) return false;
  if (o.v === null) {
    // Only a lasting last-wins layer has anything to remove.
    if (def.merge !== 'last' || def.ttl !== undefined) return false;
  } else if (!isValue(o.v) || encodeValue(o.v).length > MAX_VALUE_CHARS || !def.value(o.v)) {
    return false;
  }
  return Number.isSafeInteger(o.clock) && o.clock > 0 && Number.isSafeInteger(o.at) && o.at > 0 &&
    typeof o.author === 'string' && o.author.length > 0 && o.author.length <= 64 &&
    typeof o.sig === 'string' && o.sig.length > 0 && o.sig.length <= 128;
}

/** An untrusted op with just an op's own fields, or null if it isn't well formed. */
export function asOp(op: unknown): Op | null {
  if (!isWellFormed(op)) return null;
  const { l, x, y, v, clock, at, author, sig } = op;
  return { l, x, y, v, clock, at, author, sig };
}

/**
 * Where ops are kept and what catch-up compares: `c:cx,cy` holds a chunk's
 * zone-scope ops, `z:zx,zy` a zone's world-scope ops (its atlas), `p:author`
 * one player's player-scope ops.
 */
export type BucketId = string;

const chunkAxis = (v: number) => Math.floor(v / CHUNK);

export const chunkBucket = (cx: number, cy: number): BucketId => `c:${cx},${cy}`;
export const playerBucket = (author: string): BucketId => `p:${author}`;

/** The bucket an op belongs to. */
export function bucketOf(op: { l: Layer; x: number; y: number; author: string }): BucketId {
  const def = LAYERS[op.l];
  if (def.scope === 'player') return playerBucket(op.author);
  if (def.scope === 'zone') return def.key === 'tile' ? chunkBucket(chunkAxis(op.x), chunkAxis(op.y)) : chunkBucket(op.x, op.y);
  // World scope. Ops keyed by author alone (display names) are kept with zone 0,0's.
  if (def.key === 'author') return 'z:0,0';
  const per = def.key === 'square' ? ZONE_CHUNKS : ZONE_TILES;
  return `z:${Math.floor(op.x / per)},${Math.floor(op.y / per)}`;
}

/** The op's key within its layer and bucket. */
function slotOf(op: { l: Layer; x: number; y: number; author: string }): string {
  const def = LAYERS[op.l];
  if (def.key === 'author') return op.author;
  return def.perAuthor ? `${op.x},${op.y}|${op.author}` : `${op.x},${op.y}`;
}

/** An op's key within a world: two ops with the same key are merged, and one stands. */
export const opKey = (op: Op): string => `${op.l}|${slotOf(op)}`;

/** The buckets of the chunks that make up a zone ("zx,zy"). */
export function zoneChunkBuckets(zone: ZoneId): BucketId[] {
  const [zx, zy] = zone.split(',').map(Number);
  const ids: BucketId[] = [];
  for (let cy = 0; cy < ZONE_CHUNKS; cy++) {
    for (let cx = 0; cx < ZONE_CHUNKS; cx++) ids.push(chunkBucket(zx * ZONE_CHUNKS + cx, zy * ZONE_CHUNKS + cy));
  }
  return ids;
}

/** The zone of an atlas bucket (`z:zx,zy`), or null if the id isn't one. */
export function atlasZone(id: unknown): [number, number] | null {
  const m = typeof id === 'string' ? /^z:(-?\d{1,9}),(-?\d{1,9})$/.exec(id) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Where an op lies, in tiles (the middle of its tile or square), or null if it has no place. */
export function opPoint(op: Op): { x: number; y: number } | null {
  const def = LAYERS[op.l];
  if (def.key === 'author') return null;
  return def.key === 'tile' ? { x: op.x + 0.5, y: op.y + 0.5 } : { x: (op.x + 0.5) * CHUNK, y: (op.y + 0.5) * CHUNK };
}

/**
 * Whether a player standing at (px, py) can reach what an op changes: a tile
 * within EDIT_REACH (and a tile's slack), the map square they stand in or one
 * next to it, or, for an op with no place, always.
 */
export function inReach(op: Op, px: number, py: number): boolean {
  const def = LAYERS[op.l];
  if (def.key === 'author') return true;
  if (def.key === 'square') return Math.abs(op.x - chunkAxis(px)) <= 1 && Math.abs(op.y - chunkAxis(py)) <= 1;
  const dx = op.x + 0.5 - px, dy = op.y + 0.5 - py, r = EDIT_REACH + 1;
  return dx * dx + dy * dy <= r * r;
}

/** One replica of a world's edits. */
export class OpStore {
  /** bucket -> layer -> key within the layer -> the op that stands there. */
  private buckets = new Map<BucketId, Map<Layer, Map<string, Op>>>();
  /** The ops held that will expire. */
  private mortal = new Set<Op>();
  private counts = new Map<Layer, number>();
  private listeners = new Set<(op: Op) => void>();
  /** Highest clock seen; a new local op uses one more. */
  clock = 0;
  /** Ops held, in every layer. */
  size = 0;
  /** The date, in unix seconds, that expiry is measured against. */
  readonly now: () => number;

  constructor(now: () => number = wallClock()) {
    this.now = now;
  }

  private at(l: Layer, bucket: BucketId, slot: string): Op | undefined {
    return this.buckets.get(bucket)?.get(l)?.get(slot);
  }

  /** The op that stands at a key, unless it has expired. Layers with an entry per author need the author. */
  get(l: Layer, x: number, y: number, author = ''): Op | undefined {
    const k = { l, x, y, author };
    const op = this.at(l, bucketOf(k), slotOf(k));
    return op && !isExpired(op, this.now()) ? op : undefined;
  }

  /** The op that stands where `op` would go (which may be `op` itself). */
  current(op: Op): Op | undefined {
    const cur = this.at(op.l, bucketOf(op), slotOf(op));
    return cur && !isExpired(cur, this.now()) ? cur : undefined;
  }

  /** The tile a player painted at (x, y), or null where the generated tile shows. */
  tile(x: number, y: number): Tile | null {
    const op = this.buckets.get(chunkBucket(chunkAxis(x), chunkAxis(y)))?.get('tile')?.get(`${x},${y}`);
    return op ? (op.v as Tile | null) : null;
  }

  /** Whether merging an op would change this replica: it hasn't expired, and it stands over what is held. */
  wouldChange(op: Op): boolean {
    if (!Object.hasOwn(LAYERS, op.l) || isExpired(op, this.now())) return false;
    const cur = this.at(op.l, bucketOf(op), slotOf(op));
    return !cur || opWins(op, cur);
  }

  /** Apply an op. Returns true if it changed this replica (so it's worth keeping and passing on). */
  merge(op: Op): boolean {
    this.clock = Math.max(this.clock, op.clock);
    if (!this.wouldChange(op)) return false;
    const id = bucketOf(op), slot = slotOf(op);
    let bucket = this.buckets.get(id);
    if (!bucket) this.buckets.set(id, (bucket = new Map()));
    let layer = bucket.get(op.l);
    if (!layer) bucket.set(op.l, (layer = new Map()));
    const cur = layer.get(slot);
    if (cur) {
      this.mortal.delete(cur);
    } else {
      this.size++;
      this.counts.set(op.l, this.count(op.l) + 1);
    }
    layer.set(slot, op);
    if (LAYERS[op.l].ttl !== undefined) this.mortal.add(op);
    for (const fn of this.listeners) fn(op);
    return true;
  }

  /** Drop exactly this op, if it is the one held at its key. */
  private remove(op: Op): boolean {
    const id = bucketOf(op), slot = slotOf(op);
    const bucket = this.buckets.get(id), layer = bucket?.get(op.l);
    if (!bucket || !layer || layer.get(slot)?.sig !== op.sig) return false;
    this.mortal.delete(layer.get(slot)!);
    layer.delete(slot);
    if (!layer.size) bucket.delete(op.l);
    if (!bucket.size) this.buckets.delete(id);
    this.size--;
    this.counts.set(op.l, this.count(op.l) - 1);
    return true;
  }

  /**
   * Take back an op this replica made and its host refused, and put back the
   * op it had displaced, if there was one and it still stands. Returns false
   * if the op is no longer the one held (something has replaced it since).
   * This is the one change that is not a merge: it only ever undoes a device's
   * own op, on that device.
   */
  retract(op: Op, prev: Op | null): boolean {
    if (!this.remove(op)) return false;
    if (!prev || !this.merge(prev)) for (const fn of this.listeners) fn(op);
    return true;
  }

  /** Drop every op that has expired. Returns them, so they can be dropped from storage too. */
  expire(): Op[] {
    const now = this.now();
    const gone = [...this.mortal].filter((op) => isExpired(op, now));
    for (const op of gone) {
      this.remove(op);
      for (const fn of this.listeners) fn(op);
    }
    return gone;
  }

  nextClock(): number {
    return ++this.clock;
  }

  /** Ops held in one layer. */
  count(l: Layer): number {
    return this.counts.get(l) ?? 0;
  }

  /** The buckets that hold anything: all of them, or one kind ('c' chunks, 'z' atlas zones, 'p' players). */
  bucketIds(kind?: 'c' | 'z' | 'p'): BucketId[] {
    const ids = [...this.buckets.keys()];
    return kind ? ids.filter((id) => id.startsWith(kind)) : ids;
  }

  /** Whether players have painted any tile of a chunk (including back to its generated one). */
  hasTiles(cx: number, cy: number): boolean {
    return !!this.buckets.get(chunkBucket(cx, cy))?.get('tile');
  }

  /** The tile ops of a chunk. */
  tilesIn(cx: number, cy: number): Op[] {
    return [...(this.buckets.get(chunkBucket(cx, cy))?.get('tile')?.values() ?? [])];
  }

  /** A bucket's ops, leaving out any that have expired. */
  bucketOps(id: BucketId): Op[] {
    const bucket = this.buckets.get(id);
    if (!bucket) return [];
    const now = this.now(), ops: Op[] = [];
    for (const layer of bucket.values()) for (const op of layer.values()) if (!isExpired(op, now)) ops.push(op);
    return ops;
  }

  /** Every op held, leaving out any that have expired. */
  ops(): Op[] {
    return this.bucketIds().flatMap((id) => this.bucketOps(id));
  }

  /**
   * Short summary of a bucket's ops: how many, the highest clock, and a hash.
   * Equal digests mean (almost certainly) equal contents. '' if it holds none.
   * Expired ops are left out, so two replicas agree whether or not each has
   * swept them yet.
   */
  digest(id: BucketId): string {
    const ops = this.bucketOps(id);
    if (!ops.length) return '';
    let x = 0, max = 0;
    for (const op of ops) {
      x ^= hashString(`${opKey(op)}|${encodeValue(op.v)}|${op.clock}|${op.at}|${op.author}|${op.sig}`);
      max = Math.max(max, op.clock);
    }
    return `${ops.length}:${max}:${(x >>> 0).toString(36)}`;
  }

  /** Called with an op whenever it starts or stops being the one that stands at its key. */
  onChange(fn: (op: Op) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * What a replica tells a host it holds, as a digest per bucket: its zone's
 * chunks, the atlas (the `maxZones` zones nearest its own), and, for a player,
 * that player's own player-scope ops. Buckets it holds nothing for are left out.
 */
export function syncDigests(store: OpStore, zone: ZoneId, author: string | null, maxZones: number): Record<BucketId, string> {
  const [zx, zy] = zone.split(',').map(Number);
  const far = (id: BucketId) => {
    const z = atlasZone(id);
    return z ? Math.max(Math.abs(z[0] - zx), Math.abs(z[1] - zy)) : Infinity;
  };
  const atlas = store.bucketIds('z').sort((a, b) => far(a) - far(b)).slice(0, maxZones);
  const d: Record<BucketId, string> = {};
  for (const id of [...zoneChunkBuckets(zone), ...atlas, ...(author ? [playerBucket(author)] : [])]) {
    const dg = store.digest(id);
    if (dg) d[id] = dg;
  }
  return d;
}
