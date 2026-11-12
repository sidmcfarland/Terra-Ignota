import { CHUNK, ZONE_TILES } from './constants.ts';
import { hash2, hashString, rand2 } from './rng.ts';
import { DEEP_WATER, SEA_LEVEL, groundAt, heightOf, newGround } from './terrain.ts';

/** Tile ids are stored in edits and compared between peers: append, never renumber. */
export const Tile = {
  /** Deep sea. Blocks. */
  DeepWater: 0,
  /** Shallow sea. Waded. */
  Water: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Meadow: 5,
  Rock: 6,
  Snow: 7,
  // Player-made only: worldgen never produces these, so adding them changed no world.
  Path: 8,
  Wall: 9,
  // Natural terrain (M4c).
  /** Deep lake water. Blocks, like deep sea. */
  Lake: 10,
  /** A stream: waded, like shallows. Placed by M4c step 2 (rivers); nothing generates it yet. */
  Stream: 11,
  /** A river: deep, blocks. Placed by M4c step 2; nothing generates it yet. */
  River: 12,
  /** A sheer face. Blocks. */
  Cliff: 13,
  Desert: 14,
  Tundra: 15,
  Marsh: 16,
  Conifer: 17,
  /** The shallow edge of a lake, and ponds. Waded, like shallow sea. */
  LakeShallows: 18,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const TILE_COUNT = 19;

export function worldSeed(worldId: string): number {
  return hashString(`terra-ignota:${worldId}`);
}

const g = newGround();

/** Raw elevation, roughly [-1, 1]; SEA_LEVEL is the waterline. Continuous, so it can be sampled between tiles. */
export function elevationAt(seed: number, x: number, y: number): number {
  groundAt(seed, x, y, g);
  return SEA_LEVEL + g.u;
}

/** A tile whose corners differ in height (heightOf, in tiles) by more than this is a cliff. */
export const CLIFF_RISE = 1.2;
/** Slopes this steep, short of a cliff, are bare rock. */
const ROCK_RISE = 0.7;
/** Water this close to the coast on the continent map is sea; further inland it is a lake. */
const SEA_REACH = 0.02;
/** Snow never lies below this elevation, however cold: cold lowlands are tundra, which can be walked. */
const SNOW_FLOOR = 0.35;
/** How much colder it gets per unit of elevation. */
const LAPSE = 0.8;

/**
 * The tile at (x, y) from the ground at its four corners, (x, y) to (x+1, y+1), and the climate at
 * its north-west corner.
 */
function classify(
  seed: number, x: number, y: number,
  u00: number, u10: number, u01: number, u11: number,
  inland: number, temp: number, rain: number, bog: number,
): Tile {
  const u = (u00 + u10 + u01 + u11) / 4;
  if (u < 0) {
    const deep = u < -DEEP_WATER;
    // The continent map decides which water is sea. Lake basins start further inland than SEA_REACH.
    return inland < SEA_REACH ? (deep ? Tile.DeepWater : Tile.Water) : deep ? Tile.Lake : Tile.LakeShallows;
  }
  const h00 = heightOf(u00), h10 = heightOf(u10), h01 = heightOf(u01), h11 = heightOf(u11);
  const rise = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
  if (rise > CLIFF_RISE) return Tile.Cliff;

  // A little per-tile noise, so biome borders are ragged, not ruled lines.
  const t = temp - LAPSE * u + (rand2(seed ^ 0x2f6b, x, y) - 0.5) * 0.06;
  const r = rain + (rand2(seed ^ 0x7c15, x, y) - 0.5) * 0.06;
  const mix = rand2(seed, x, y);

  // The snow line moves with the climate: lower where it is cold, absent where it is hot.
  if (t < -0.6 && u > SNOW_FLOOR) return Tile.Snow;
  if (inland < SEA_REACH && u < 0.05) return Tile.Sand;
  if (rise > ROCK_RISE || u > 0.6 || (t < -0.45 && u > 0.28)) return Tile.Rock;
  if (t < -0.5) return Tile.Tundra;
  if (bog > 0.5 && r > -0.1) return Tile.Marsh;
  if (t < -0.1) {
    if (r > -0.15) return mix < 0.88 ? Tile.Conifer : Tile.Grass;
    return t < -0.35 ? Tile.Tundra : Tile.Grass;
  }
  if (r < -0.5) return Tile.Desert;
  if (t < 0.34) {
    if (r > 0.1) return mix < 0.85 ? Tile.Forest : Tile.Grass;
    return r < -0.2 ? Tile.Meadow : Tile.Grass;
  }
  if (r < -0.05) return Tile.Desert;
  if (r > 0.2) return mix < 0.85 ? Tile.Forest : Tile.Grass;
  return mix < 0.7 ? Tile.Meadow : Tile.Grass;
}

/** Terrain at a world tile. Pure function of (seed, x, y). */
export function tileAt(seed: number, x: number, y: number): Tile {
  groundAt(seed, x + 1, y, g);
  const u10 = g.u;
  groundAt(seed, x, y + 1, g);
  const u01 = g.u;
  groundAt(seed, x + 1, y + 1, g);
  const u11 = g.u;
  groundAt(seed, x, y, g);
  return classify(seed, x, y, g.u, u10, u01, u11, g.inland, g.temp, g.rain, g.bog);
}

/**
 * The tile a point would be if the ground around it were level: no cliffs, no scree. One sample where
 * tileAt takes four, for maps drawn at many tiles per pixel. Not for rules: use tileAt.
 */
export function tileAtFlat(seed: number, x: number, y: number): Tile {
  groundAt(seed, x, y, g);
  return classify(seed, x, y, g.u, g.u, g.u, g.u, g.inland, g.temp, g.rain, g.bog);
}

const N = CHUNK + 1;
const cornerU = new Float64Array(N * N), cornerInland = new Float64Array(N * N);
const cornerTemp = new Float64Array(N * N), cornerRain = new Float64Array(N * N), cornerBog = new Float64Array(N * N);

/** Tiles of one chunk, row-major, CHUNK*CHUNK. The same tiles as tileAt, with each corner computed once. */
export function generateChunk(seed: number, cx: number, cy: number): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK);
  const ox = cx * CHUNK, oy = cy * CHUNK;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      groundAt(seed, ox + x, oy + y, g);
      cornerU[i] = g.u;
      cornerInland[i] = g.inland;
      cornerTemp[i] = g.temp;
      cornerRain[i] = g.rain;
      cornerBog[i] = g.bog;
    }
  }
  for (let y = 0; y < CHUNK; y++) {
    for (let x = 0; x < CHUNK; x++) {
      const i = y * N + x;
      out[y * CHUNK + x] = classify(
        seed, ox + x, oy + y, cornerU[i], cornerU[i + 1], cornerU[i + N], cornerU[i + N + 1],
        cornerInland[i], cornerTemp[i], cornerRain[i], cornerBog[i],
      );
    }
  }
  return out;
}

/**
 * Movement rules. They depend only on the tile, so the host checks exactly what the client predicts.
 * Deep water (sea, lake, river), snow, cliffs and walls block. M5 adds Bridges and Steps to cross them.
 */
export function isWalkable(t: Tile): boolean {
  return t !== Tile.DeepWater && t !== Tile.Snow && t !== Tile.Wall && t !== Tile.Lake && t !== Tile.River && t !== Tile.Cliff;
}

/** Shallow water (sea, lake edge, stream) is crossed slowly. */
export function isWading(t: Tile): boolean {
  return t === Tile.Water || t === Tile.LakeShallows || t === Tile.Stream;
}

/** Open, dry, walkable ground for `r` tiles around a tile: somewhere a new player can walk off in any direction. */
function isClearing(seed: number, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const t = tileAt(seed, x + dx, y + dy);
      if (!isWalkable(t) || isWading(t)) return false;
    }
  }
  return true;
}

/**
 * Find open grassland near the center of zone 0,0 to spawn on. Searches square rings outwards, finely
 * nearby and coarsely far out (the middle of an ocean can be thousands of tiles from land).
 */
export function findSpawn(seed: number): { x: number; y: number } {
  const c = ZONE_TILES / 2;
  const tryAt = (x: number, y: number) => {
    // Most of an ocean is ruled out by one cheap look at the continent map.
    groundAt(seed, x, y, g);
    if (g.inland < SEA_REACH) return false;
    const t = tileAt(seed, x, y);
    return (t === Tile.Grass || t === Tile.Meadow) && isClearing(seed, x, y, 6);
  };
  for (let ring = 0, r = 0; r <= 12000; ring++) {
    const gap = r < 512 ? 16 : 64;
    if (ring === 0) {
      if (tryAt(c, c)) return { x: c + 0.5, y: c + 0.5 };
    } else {
      // The four sides of the square at distance r, each from one corner up to (not including) the next.
      for (let s = -r; s < r; s += gap) {
        for (const [x, y] of [[c + s, c - r], [c + r, c + s], [c - s, c + r], [c - r, c - s]]) {
          if (tryAt(x, y)) return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    r += gap;
  }
  return { x: c + 0.5, y: c + 0.5 };
}

/** Chunks hashed by terrainHash: near the origin, far out, and on both sides of zero. */
const HASH_CHUNKS = [
  [0, 0], [-1, -1], [3, -2], [-7, 5], [14, 9], [-22, -31], [40, 13], [-120, 77],
  [400, -300], [1000, 1000], [-2500, 900], [12345, -6789],
];

/**
 * A hash of a fixed sample of the world: whole chunks, scattered tiles and exact elevations. Every
 * device must get the same number for the same seed; the tests compare Node against browsers.
 */
export function terrainHash(seed: number): number {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  };
  for (const [cx, cy] of HASH_CHUNKS) for (const t of generateChunk(seed, cx, cy)) mix(t);
  const spread = (i: number, k: number, range: number) => (hash2(0x51a3, i, k) % (2 * range + 1)) - range;
  for (let i = 0; i < 2048; i++) mix(tileAt(seed, spread(i, 0, 60000), spread(i, 1, 60000)));
  const view = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 512; i++) {
    // Whole and half tiles: the renderer samples heights at both.
    const half = (i & 1) / 2;
    view.setFloat64(0, elevationAt(seed, spread(i, 2, 100000) + half, spread(i, 3, 100000) + half), true);
    for (let k = 0; k < 8; k++) mix(view.getUint8(k));
  }
  return h >>> 0;
}
