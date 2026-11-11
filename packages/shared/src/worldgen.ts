import { CHUNK, ZONE_TILES } from './constants.ts';
import { fbm } from './noise.ts';
import { hashString, rand2 } from './rng.ts';

export const Tile = {
  DeepWater: 0,
  Water: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Meadow: 5,
  Rock: 6,
  Snow: 7,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const TILE_COUNT = 8;

export function worldSeed(worldId: string): number {
  return hashString(`terra-ignota:${worldId}`);
}

/** Raw elevation, roughly [-1, 1]. Continuous, so it can be sampled between tiles. */
export function elevationAt(seed: number, x: number, y: number): number {
  return fbm(seed, x / 96, y / 96, 5) + 0.15 * fbm(seed + 7, x / 24, y / 24, 2);
}

/** Elevation at which shallow water meets sand. */
export const SEA_LEVEL = -0.12;

/** Terrain at a world tile. Pure function of (seed, x, y). */
export function tileAt(seed: number, x: number, y: number): Tile {
  const elev = elevationAt(seed, x, y);
  const moist = fbm(seed + 31337, x / 128, y / 128, 4);

  if (elev < -0.28) return Tile.DeepWater;
  if (elev < -0.12) return Tile.Water;
  if (elev < -0.06) return Tile.Sand;
  if (elev > 0.55) return Tile.Snow;
  if (elev > 0.4) return Tile.Rock;
  if (moist > 0.12) return rand2(seed, x, y) < 0.85 ? Tile.Forest : Tile.Grass;
  if (moist < -0.25) return Tile.Meadow;
  return Tile.Grass;
}

/** Tiles of one chunk, row-major, CHUNK*CHUNK. */
export function generateChunk(seed: number, cx: number, cy: number): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK);
  const ox = cx * CHUNK, oy = cy * CHUNK;
  for (let y = 0; y < CHUNK; y++) {
    for (let x = 0; x < CHUNK; x++) out[y * CHUNK + x] = tileAt(seed, ox + x, oy + y);
  }
  return out;
}

export function isWalkable(t: Tile): boolean {
  return t !== Tile.DeepWater && t !== Tile.Snow;
}

export function isWading(t: Tile): boolean {
  return t === Tile.Water;
}

/** Find walkable land near the center of zone 0,0 to spawn on. */
export function findSpawn(seed: number): { x: number; y: number } {
  const c = ZONE_TILES / 2;
  for (let r = 0; r < 4000; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = c + Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const y = c + Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      const t = tileAt(seed, x, y);
      if (t === Tile.Grass || t === Tile.Meadow) return { x: x + 0.5, y: y + 0.5 };
    }
  }
  return { x: c + 0.5, y: c + 0.5 };
}
