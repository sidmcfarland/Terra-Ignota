/**
 * World edits: signed, per-tile last-writer-wins ops, grouped by chunk.
 *
 * Every peer that has seen a chunk keeps its ops; merging is order-independent,
 * so replicas converge without consensus. Terrain itself is never sent: an edit
 * only overrides the generated tile at one spot.
 */
import { CHUNK } from './constants.ts';
import { hashString } from './rng.ts';
import { Tile } from './worldgen.ts';

export interface TileOp {
  x: number;
  y: number;
  /** The tile to show, or null to go back to the generated one. */
  tile: Tile | null;
  /** Lamport clock: higher wins. */
  clock: number;
  /** Author's Ed25519 public key, base64url. Breaks clock ties. */
  author: string;
  /** Ed25519 signature over opPayload(), base64url. */
  sig: string;
}

export type UnsignedOp = Omit<TileOp, 'sig'>;

/** Tiles players can paint (besides null, back to generated). */
export const PAINTABLE: readonly Tile[] = [Tile.Path, Tile.Wall];
/** How far (in tiles) from a player's position the host accepts their edits. */
export const EDIT_REACH = 4;
/** Edits a host accepts from one client per second. */
export const EDITS_PER_SEC = 10;

/** The exact bytes an op's signature covers. Includes the world so an op can't be replayed elsewhere. */
export function opPayload(world: string, op: UnsignedOp): string {
  return `ti-edit:1|${world}|${op.x}|${op.y}|${op.tile === null ? '-' : op.tile}|${op.clock}|${op.author}`;
}

/** Total order: higher clock, then higher author, then higher signature. */
export function opWins(a: TileOp, b: TileOp): boolean {
  if (a.clock !== b.clock) return a.clock > b.clock;
  if (a.author !== b.author) return a.author > b.author;
  return a.sig > b.sig;
}

/** Structural check of an untrusted op (the signature is checked separately). */
export function isWellFormed(op: unknown): op is TileOp {
  const o = op as TileOp;
  return !!o && typeof o === 'object' &&
    Number.isSafeInteger(o.x) && Number.isSafeInteger(o.y) &&
    (o.tile === null || PAINTABLE.includes(o.tile)) &&
    Number.isSafeInteger(o.clock) && o.clock > 0 &&
    typeof o.author === 'string' && o.author.length <= 64 &&
    typeof o.sig === 'string' && o.sig.length <= 128;
}

export type ChunkKey = string;
export const chunkKey = (cx: number, cy: number): ChunkKey => `${cx},${cy}`;
export const chunkKeyOf = (x: number, y: number): ChunkKey => chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
const tileIndex = (x: number, y: number) => {
  const lx = x - Math.floor(x / CHUNK) * CHUNK, ly = y - Math.floor(y / CHUNK) * CHUNK;
  return ly * CHUNK + lx;
};

/** One replica of the world's edits. */
export class TileEdits {
  private chunks = new Map<ChunkKey, Map<number, TileOp>>();
  private listeners = new Set<(cx: number, cy: number) => void>();
  /** Highest clock seen; a new local op uses one more. */
  clock = 0;
  size = 0;

  get(x: number, y: number): TileOp | undefined {
    return this.chunks.get(chunkKeyOf(x, y))?.get(tileIndex(x, y));
  }

  /** Apply an op. Returns true if it changed this replica (so it's worth passing on). */
  merge(op: TileOp): boolean {
    const key = chunkKeyOf(op.x, op.y);
    let chunk = this.chunks.get(key);
    const i = tileIndex(op.x, op.y);
    const cur = chunk?.get(i);
    this.clock = Math.max(this.clock, op.clock);
    if (cur && !opWins(op, cur)) return false;
    if (!chunk) this.chunks.set(key, (chunk = new Map()));
    if (!cur) this.size++;
    chunk.set(i, op);
    const cx = Math.floor(op.x / CHUNK), cy = Math.floor(op.y / CHUNK);
    for (const fn of this.listeners) fn(cx, cy);
    return true;
  }

  nextClock(): number {
    return ++this.clock;
  }

  hasChunk(key: ChunkKey): boolean {
    return this.chunks.has(key);
  }

  chunkOps(key: ChunkKey): TileOp[] {
    return [...(this.chunks.get(key)?.values() ?? [])];
  }

  /** Short summary of a chunk's ops; equal digests mean (almost certainly) equal contents. '' if none. */
  digest(key: ChunkKey): string {
    const chunk = this.chunks.get(key);
    if (!chunk) return '';
    let x = 0, max = 0;
    for (const op of chunk.values()) {
      x ^= hashString(`${op.x},${op.y},${op.tile},${op.clock},${op.author},${op.sig}`);
      max = Math.max(max, op.clock);
    }
    return `${chunk.size}:${max}:${(x >>> 0).toString(36)}`;
  }

  /** Called with a chunk's coordinates whenever an op changes it. */
  onChange(fn: (cx: number, cy: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
