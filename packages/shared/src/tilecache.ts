import { CHUNK } from './constants.ts';
import { generateChunk, type Tile } from './worldgen.ts';

/** Memoizes generated chunks for fast per-tile lookups (collision, validation). */
export class TileCache {
  private chunks = new Map<string, Uint8Array>();
  readonly seed: number;
  private readonly max: number;

  constructor(seed: number, max = 1024) {
    this.seed = seed;
    this.max = max;
  }

  chunk(cx: number, cy: number): Uint8Array {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (!c) {
      if (this.chunks.size >= this.max) this.chunks.delete(this.chunks.keys().next().value!);
      c = generateChunk(this.seed, cx, cy);
      this.chunks.set(key, c);
    }
    return c;
  }

  get = (x: number, y: number): Tile => {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    return this.chunk(cx, cy)[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] as Tile;
  };
}
