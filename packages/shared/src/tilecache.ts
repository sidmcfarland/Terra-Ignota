import { CHUNK } from './constants.ts';
import type { OpStore } from './edits.ts';
import { generateChunk, type Tile } from './worldgen.ts';

/**
 * Memoizes generated chunks for fast per-tile lookups (collision, validation,
 * rendering). With an edit store, lookups return the edited tile where there is
 * one, so everything that reads tiles sees player edits.
 */
export class TileCache {
  private chunks = new Map<string, Uint8Array>();
  /** Generated chunks with edits applied, for chunks that have edits. */
  private patched = new Map<string, Uint8Array>();
  private listeners = new Set<(cx: number, cy: number) => void>();
  readonly seed: number;
  readonly edits: OpStore | null;
  private readonly max: number;

  constructor(seed: number, max = 1024, edits: OpStore | null = null) {
    this.seed = seed;
    this.max = max;
    this.edits = edits;
    // Only painted tiles change what a tile is. Other layers lie on top of the land and leave it as it was.
    edits?.onChange((op) => {
      if (op.l !== 'tile') return;
      const cx = Math.floor(op.x / CHUNK), cy = Math.floor(op.y / CHUNK);
      this.patched.delete(`${cx},${cy}`);
      for (const fn of this.listeners) fn(cx, cy);
    });
  }

  /** Whether players have painted any tile of a chunk. */
  edited(cx: number, cy: number): boolean {
    return !!this.edits?.hasTiles(cx, cy);
  }

  /** The generated chunk, before edits. */
  base(cx: number, cy: number): Uint8Array {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (!c) {
      if (this.chunks.size >= this.max) this.chunks.delete(this.chunks.keys().next().value!);
      c = generateChunk(this.seed, cx, cy);
      this.chunks.set(key, c);
    }
    return c;
  }

  /** The chunk as players see it: generated, with any edits applied. */
  chunk(cx: number, cy: number): Uint8Array {
    const key = `${cx},${cy}`;
    if (!this.edits?.hasTiles(cx, cy)) return this.base(cx, cy);
    let c = this.patched.get(key);
    if (!c) {
      c = this.base(cx, cy).slice();
      for (const op of this.edits.tilesIn(cx, cy)) {
        if (op.v !== null) c[(op.y - cy * CHUNK) * CHUNK + (op.x - cx * CHUNK)] = op.v as Tile;
      }
      if (this.patched.size >= this.max) this.patched.delete(this.patched.keys().next().value!);
      this.patched.set(key, c);
    }
    return c;
  }

  get = (x: number, y: number): Tile => {
    const painted = this.edits?.tile(x, y);
    if (painted !== null && painted !== undefined) return painted;
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    return this.base(cx, cy)[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] as Tile;
  };

  /** Called with a chunk's coordinates when an edit changes it (e.g. to rebuild its mesh). */
  onChunkChange(fn: (cx: number, cy: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
