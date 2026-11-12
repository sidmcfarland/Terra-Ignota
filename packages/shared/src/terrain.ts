import { fbm, perlin } from './noise.ts';

/**
 * The shape of the land (M4c step 1): a handful of large, slow maps, and curves over them.
 *
 *   continent   ocean against land. The sea is where this map says so, not where the ground is low,
 *               so water inland is a lake by definition.
 *   erosion     flat against rugged: plains, hill country and mountain ranges are different places.
 *   ridges      mountain chains with spurs (ridged, warped noise).
 *   valleys     broad cuts through the high ground: the passes.
 *   terraces    escarpments and mesas: a steep step in a curve is a cliff.
 *   basins      hollows in low country that hold lakes.
 *   temperature, rainfall    the climate, for biomes and the snow line.
 *
 * Every device must compute exactly the same world, because hosts check movement against it. So this
 * file uses only arithmetic that is exact on every engine (+ - * /, Math.sqrt, floor, abs, min, max).
 * Never Math.sin, pow, exp or similar here.
 */

/** Elevation of the waterline. Sea and lakes share it in step 1. */
export const SEA_LEVEL = -0.12;
/** Water deeper than this (elevation below the waterline) is deep: it blocks. Shallower water is waded. */
export const DEEP_WATER = 0.16;

export interface Ground {
  /** Elevation above the waterline; negative under water. Add SEA_LEVEL for the raw elevation. */
  u: number;
  /** How far inland on the continent map. Negative is ocean. */
  inland: number;
  /** Climate at sea level, each about -1..1: cold to hot, dry to wet. */
  temp: number;
  rain: number;
  /** 0..1: how waterlogged low ground is here (the fringe of a lake basin). */
  bog: number;
}

export const newGround = (): Ground => ({ u: 0, inland: 0, temp: 0, rain: 0, bog: 0 });

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A curve through points given as x0, y0, x1, y1, ... with x rising; flat beyond its ends. */
function curve(points: readonly number[], x: number): number {
  if (x <= points[0]) return points[1];
  for (let i = 2; i < points.length; i += 2) {
    if (x < points[i]) {
      const x0 = points[i - 2], y0 = points[i - 1];
      return y0 + (points[i + 1] - y0) * ((x - x0) / (points[i] - x0));
    }
  }
  return points[points.length - 1];
}

// ---- The slow maps. They change little over a few tiles, so they are computed on a lattice every
// LATTICE tiles and interpolated; the shaping (ridges, steps, thresholds) happens per sample, after
// interpolating, so creases and cliff lines stay sharp.

const LATTICE = 4;
const BLOCK = 32;
const LN = BLOCK / LATTICE + 1;
const CONT = 0, EROSION = 1, RIDGE1 = 2, RIDGE2 = 3, RIDGE3 = 4, VALLEY = 5, TEMP = 6, RAIN = 7, TERRACE = 8, BASIN = 9;
const FIELDS = 10;

function slowMaps(seed: number, x: number, y: number, out: Float64Array, o: number) {
  // Continents, warped so coasts have bays and headlands.
  const cx = x + 240 * fbm(seed + 101, x / 900, y / 900, 2);
  const cy = y + 240 * fbm(seed + 211, x / 900, y / 900, 2);
  out[o + CONT] = fbm(seed + 307, cx / 2200, cy / 2200, 5);
  out[o + EROSION] = fbm(seed + 401, x / 1300, y / 1300, 3);
  // Ridge lines, warped so chains bend. Three sizes: the chain, its spurs, and rolling ground.
  const rx = x + 45 * perlin(seed + 503, x / 300, y / 300);
  const ry = y + 45 * perlin(seed + 601, x / 300, y / 300);
  out[o + RIDGE1] = perlin(seed + 701, rx / 260, ry / 260);
  out[o + RIDGE2] = perlin(seed + 809, rx / 115, ry / 115);
  out[o + RIDGE3] = perlin(seed + 907, x / 130, y / 130);
  out[o + VALLEY] = fbm(seed + 1009, x / 520, y / 520, 2);
  out[o + TEMP] = fbm(seed + 1103, x / 2600, y / 2600, 3);
  out[o + RAIN] = fbm(seed + 1201, x / 1700, y / 1700, 3);
  out[o + TERRACE] = fbm(seed + 1301, x / 300, y / 300, 2);
  out[o + BASIN] = fbm(seed + 1409, x / 190, y / 190, 2);
}

// A cache of lattice blocks (BLOCK×BLOCK tiles each), filled in as points are asked for. It only saves
// work: a lattice point's values depend on nothing but (seed, x, y).
const MAX_BLOCKS = 512;
const BLOCK_FLOATS = LN * LN * FIELDS;
const KEY_HALF = 33554432, KEY_SPAN = 67108864;
let blocks = new Map<number, Float64Array>();
let blocksSeed = NaN, lastKey = NaN;
let lastBlock: Float64Array = new Float64Array(0);

function blockAt(seed: number, bx: number, by: number): Float64Array {
  if (seed !== blocksSeed) {
    blocks = new Map();
    blocksSeed = seed;
    lastKey = NaN;
  }
  // Beyond what a key can hold (about a billion tiles out), skip the cache.
  if (bx < -KEY_HALF || bx >= KEY_HALF || by < -KEY_HALF || by >= KEY_HALF) return new Float64Array(BLOCK_FLOATS).fill(NaN);
  const key = (bx + KEY_HALF) * KEY_SPAN + (by + KEY_HALF);
  if (key === lastKey) return lastBlock;
  let b = blocks.get(key);
  if (!b) {
    if (blocks.size >= MAX_BLOCKS) blocks.delete(blocks.keys().next().value!);
    b = new Float64Array(BLOCK_FLOATS).fill(NaN);
    blocks.set(key, b);
  }
  lastKey = key;
  lastBlock = b;
  return b;
}

/** Where a lattice point's values sit in its block, computing them on first use. */
function latticePoint(b: Float64Array, seed: number, ox: number, oy: number, i: number, j: number): number {
  const o = (j * LN + i) * FIELDS;
  if (b[o] !== b[o]) slowMaps(seed, ox + i * LATTICE, oy + j * LATTICE, b, o);
  return o;
}

const f = new Float64Array(FIELDS);

/** Interpolate the slow maps at (x, y) into `f`. */
function slowAt(seed: number, x: number, y: number) {
  const bx = Math.floor(x / BLOCK), by = Math.floor(y / BLOCK);
  const b = blockAt(seed, bx, by);
  const ox = bx * BLOCK, oy = by * BLOCK;
  const i = Math.floor((x - ox) / LATTICE), j = Math.floor((y - oy) / LATTICE);
  // Always in [0, 1): a point is only ever computed one way, whichever caller asks.
  const fx = (x - ox - i * LATTICE) / LATTICE, fy = (y - oy - j * LATTICE) / LATTICE;
  // On a lattice line the far points have no weight, so they are not computed.
  // (a + (a - a) * 0 is exactly a, so the result is the same either way.)
  const o00 = latticePoint(b, seed, ox, oy, i, j);
  const o10 = fx === 0 ? o00 : latticePoint(b, seed, ox, oy, i + 1, j);
  const o01 = fy === 0 ? o00 : latticePoint(b, seed, ox, oy, i, j + 1);
  const o11 = fy === 0 ? o10 : fx === 0 ? o01 : latticePoint(b, seed, ox, oy, i + 1, j + 1);
  for (let k = 0; k < FIELDS; k++) {
    const top = b[o00 + k] + (b[o10 + k] - b[o00 + k]) * fx;
    const bottom = b[o01 + k] + (b[o11 + k] - b[o01 + k]) * fx;
    f[k] = top + (bottom - top) * fy;
  }
}

// ---- The curves.

/** The continent map's value at the coast. Lower means more land. */
const COAST = -0.07;
/** How much fine noise roughens the coastline (coves, skerries). */
const COAST_DETAIL = 0.03;
/** Depth of the sea bed against distance out from the coast: a wadeable shelf, then the drop. */
const SEA_BED = [0, 0, 0.004, 0.05, 0.012, 0.17, 0.04, 0.3, 0.15, 0.5, 0.5, 0.8];
/** Height of the land against distance inland, before any relief: a beach, then a slow rise. */
const LAND_BASE = [0, 0, 0.003, 0.045, 0.02, 0.07, 0.1, 0.1, 0.3, 0.15, 0.7, 0.2];
/** The highest ground is squeezed, so summits stay within what the view can show (about 28 tiles tall). */
const PEAKS = [0.6, 0.6, 1, 0.84, 1.7, 0.96];
/** How narrow a terrace's step is, in the terrace map's units: about a tile and a half. */
const STEP = 0.008;
/** How tall a sea cliff stands on a rugged coast. */
const SEA_CLIFF = 0.24;
/** How far below the waterline the middle of a lake basin sits. */
const LAKE_DEPTH = 0.34;

/**
 * The ground at a point: its height and climate. A pure function of (seed, x, y).
 * `x` and `y` may be fractional.
 */
export function groundAt(seed: number, x: number, y: number, g: Ground): void {
  slowAt(seed, x, y);
  // Fine noise, four sizes (72, 36, 18 and 9 tiles), read two ways: as bumps, which roughen the coast,
  // terrace edges and the ground; and creased into ribs, for the flanks of mountains.
  let d = 0, ribs = 0, amp = 1, freq = 1 / 72;
  for (let i = 0; i < 4; i++) {
    const n = perlin(seed + 1511 + i * 1013, x * freq, y * freq);
    d += amp * n;
    ribs += amp * (0.56 - 2 * Math.abs(n));
    amp *= 0.5;
    freq *= 2;
  }
  d /= 1.875;
  ribs /= 1.875;
  const inland = f[CONT] + COAST_DETAIL * d - COAST;
  g.inland = inland;
  g.temp = clamp(f[TEMP] * 1.7, -1, 1);
  // The middle of a continent is drier than its coasts.
  const rain = clamp(f[RAIN] * 2 - 0.25 * smoothstep(0.12, 0.5, inland), -1, 1);
  g.rain = rain;
  g.bog = 0;

  if (inland < 0) {
    g.u = -curve(SEA_BED, -inland) * (1 + 0.25 * d);
    return;
  }

  // Below 0 on the plains; about 0.2 is hill country, past 0.3 the heart of a mountain range.
  const rug = -f[EROSION];
  // Relief fades out towards the coast, so the shore is a beach unless it is a cliff.
  const fade = smoothstep(0.003, 0.045, inland);
  // Valleys: 0.3 along a valley line, 1 away from it.
  const valley = 0.3 + 0.7 * smoothstep(0, 0.1, Math.abs(f[VALLEY]));

  // Rolling ground: barely there on the plains, real hills in hill country.
  let relief = (0.02 + 0.2 * smoothstep(0, 0.2, rug)) * clamp(0.5 + 1.2 * f[RIDGE3] + 0.5 * d, 0, 1.3) * valley;

  // Mountains: a chain along each line where the ridge map crosses zero, with spurs running off it.
  const m = smoothstep(0.17, 0.32, rug);
  if (m > 0) {
    const a1 = Math.abs(f[RIDGE1]), a2 = Math.abs(f[RIDGE2]);
    const massif = Math.max(0, 1 - 2.2 * a1);
    // Squared, so flanks steepen towards the top: gentle feet, sheer summits.
    const c = Math.max(0, 1 - 4.2 * a1), s = Math.max(0, 1 - 5 * a2);
    const crest = c * c, spur = s * s;
    // Spurs stand tall near the chain and die away from it; between chains the ground stays low.
    let ridge = 0.12 * massif + 0.6 * crest + 0.5 * massif * spur;
    // Ribs and gullies, stronger the higher the ground.
    ridge += 0.45 * (ridge + 0.15) * ribs;
    relief = relief * (1 - 0.8 * m) + m * valley * 0.66 * ridge;
  }

  // Terraces: escarpments in rugged country, mesas in dry country. Where the terrace map changes
  // slowly the step spreads into a ramp, which is the way up.
  // A terrace comes and goes along its length, so an escarpment is a run of cliff, not a closed ring.
  const terraced = Math.max(smoothstep(-0.02, 0.08, rug), 0.9 * smoothstep(0.2, 0.5, -rain)) * smoothstep(-0.08, 0.14, f[RIDGE3]);
  if (terraced > 0) {
    const p = f[TERRACE] + 0.08 * d;
    relief += 0.15 * terraced * (1 - 0.85 * m) * (smoothstep(0.05, 0.05 + STEP, p) + 0.8 * smoothstep(0.24, 0.24 + STEP, p));
  }

  let u = curve(LAND_BASE, inland) + fade * relief;
  // A rugged coast meets the sea in a cliff; the clifftop eases back down inland.
  u += SEA_CLIFF * smoothstep(0.08, 0.18, rug) * smoothstep(0.002, 0.004, inland) * (1 - 0.75 * smoothstep(0.02, 0.1, inland));
  u += d * (0.01 + 0.04 * smoothstep(0, 0.3, rug)) * fade;
  if (u < 0.005) u = 0.005;
  if (u > 0.6) u = curve(PEAKS, u);

  // Lake basins: hollows in low country, away from the coast, more of them where it rains.
  const low = (1 - smoothstep(0.1, 0.22, u)) * smoothstep(0.03, 0.07, inland);
  if (low > 0) {
    const brim = clamp(0.3 - 0.4 * rain, 0.1, 0.55);
    const basin = f[BASIN] + 0.04 * d;
    g.bog = low * smoothstep(brim - 0.12, brim - 0.03, basin);
    u -= low * smoothstep(brim, brim + 0.12, basin) * (u + LAKE_DEPTH);
  }
  g.u = u;
}

/**
 * Height in tiles for an elevation above the waterline, the way the renderer draws it (the waterline
 * is 0). Exact arithmetic, so shared rules can use it: a cliff is a tile whose corners differ by more
 * than CLIFF_RISE of this.
 */
export function heightOf(u: number): number {
  return u >= 0 ? 30 * u * Math.sqrt(u) + 0.15 : u * 8;
}
