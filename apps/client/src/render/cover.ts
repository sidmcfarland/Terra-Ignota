/**
 * The builder for a chunk's ground cover (grass tufts, flowers, rocks, bushes, reeds), merged into one
 * mesh per chunk so a chunk's whole undergrowth is a single draw call.
 *
 * Plain numbers and typed arrays only, with no three.js and no DOM: this runs in the worker that builds
 * chunk meshes (see chunk-data.ts). flora.ts has the vertex layout it shares with the trees.
 */

export type RGB = readonly [number, number, number];

/** `aColor.a` stores height above the root divided by this (tiles). */
export const LIFT_UNIT = 2.5;

/** One mesh's vertices as they go to the GPU, and the sphere that bounds them (x, y, z, radius). */
export interface MeshData {
  position: Float32Array;
  /** Signed bytes, 127 to a unit. */
  normal: Int8Array;
  /** Bytes: rgb, then a fourth that depends on the mesh (the ground's bedding, a plant's lift). */
  color: Uint8Array | Uint8ClampedArray;
  /** Bytes: ambient occlusion, then the two baked horizons; the ground adds a fourth (dry or under water). */
  shade: Uint8Array;
  sphere: Float32Array;
}

/** The sphere around a list of points, as three.js would compute it: centred on their box. */
export function sphereOf(p: Float32Array): Float32Array {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx, dy = p[i + 1] - cy, dz = p[i + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) r2 = d2;
  }
  return Float32Array.of(cx, cy, cz, Math.sqrt(r2));
}

// A small deterministic stream of numbers in [0, 1) (mulberry32). Seed it per tile.
let rs = 1;
export function seedRnd(n: number) {
  rs = n >>> 0;
}
export function rnd(): number {
  rs = (rs + 0x6d2b79f5) >>> 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- ground cover

/** Most vertices one chunk's ground cover may use. Past this the builder stops adding, so a chunk has a hard ceiling. */
const CAP = 45000;
const cPos = new Float32Array(CAP * 3);
const cNor = new Int8Array(CAP * 3);
// Clamped, so colours and lifts can be written as plain numbers.
const cCol = new Uint8ClampedArray(CAP * 4);
const cShade = new Uint8Array(CAP * 3);
let cv = 0;
let s0 = 255, s1 = 0, s2 = 0;
// A lump's eight corners.
const bx = new Float32Array(8), by = new Float32Array(8), bz = new Float32Array(8);
const UP = [5, 5, 6, 6, 7];

function vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, lift: number) {
  const o = cv * 3, q = cv * 4;
  cPos[o] = x; cPos[o + 1] = y; cPos[o + 2] = z;
  cNor[o] = nx; cNor[o + 1] = ny; cNor[o + 2] = nz;
  cCol[q] = r; cCol[q + 1] = g; cCol[q + 2] = b; cCol[q + 3] = lift * (255 / LIFT_UNIT);
  cShade[o] = s0; cShade[o + 1] = s1; cShade[o + 2] = s2;
  cv++;
}

/** Builds one chunk's ground cover into shared scratch buffers. Not re-entrant: begin, add, end. */
export const cover = {
  begin() {
    cv = 0;
  },

  /** Baked shade (ambient occlusion and the two horizons, as bytes) for what is added next. */
  shade(ao: number, east: number, west: number) {
    s0 = ao; s1 = east; s2 = west;
  },

  /**
   * One blade: a thin triangle rooted at (x, y, z), `w` wide across (ax, az), with its tip `h` up and pushed
   * over by (tx, tz). It takes the ground's normal (as signed bytes) so it is lit like the land it grows from.
   */
  blade(
    x: number, y: number, z: number, ax: number, az: number, w: number, tx: number, tz: number, h: number,
    base: RGB, tip: RGB, nx: number, ny: number, nz: number, rootLift = 0,
  ) {
    if (cv + 3 > CAP) return;
    // Written straight into the buffers: a chunk can hold thousands of blades.
    const o = cv * 3, q = cv * 4;
    cPos[o] = x - ax * w; cPos[o + 1] = y; cPos[o + 2] = z - az * w;
    cPos[o + 3] = x + ax * w; cPos[o + 4] = y; cPos[o + 5] = z + az * w;
    cPos[o + 6] = x + tx; cPos[o + 7] = y + h; cPos[o + 8] = z + tz;
    for (let k = 0; k < 9; k += 3) {
      cNor[o + k] = nx; cNor[o + k + 1] = ny; cNor[o + k + 2] = nz;
      cShade[o + k] = s0; cShade[o + k + 1] = s1; cShade[o + k + 2] = s2;
    }
    // `rootLift` is for a blade that starts part-way up a plant (a seed head): how far its base is above the ground.
    const l0 = rootLift * (255 / LIFT_UNIT), l1 = (rootLift + h) * (255 / LIFT_UNIT);
    cCol[q] = cCol[q + 4] = base[0]; cCol[q + 1] = cCol[q + 5] = base[1]; cCol[q + 2] = cCol[q + 6] = base[2]; cCol[q + 3] = cCol[q + 7] = l0;
    cCol[q + 8] = tip[0]; cCol[q + 9] = tip[1]; cCol[q + 10] = tip[2]; cCol[q + 11] = l1;
    cv += 3;
  },

  /** A flower head: a small flat diamond held `h` above its root. */
  bloom(x: number, y: number, z: number, h: number, size: number, turn: number, color: RGB) {
    if (cv + 6 > CAP) return;
    const c = Math.cos(turn) * size, s = Math.sin(turn) * size, top = y + h;
    const v = (px: number, pz: number, k: number) => vert(px, top, pz, 0, 127, 0, color[0] * k, color[1] * k, color[2] * k, h);
    v(x + c, z + s, 1); v(x - s, z + c, 1); v(x - c, z - s, 0.9);
    v(x + c, z + s, 1); v(x - c, z - s, 0.9); v(x + s, z - c, 0.9);
  },

  /**
   * A faceted lump (rock, pebble, bush): five corners at the ground, three above, nine facets. Colour runs from
   * `low` on faces that look sideways to `high` on faces that look up. Rocks pass `sway = false` and stay put.
   */
  lump(x: number, y: number, z: number, r: number, h: number, low: RGB, high: RGB, sway: boolean) {
    if (cv + 27 > CAP) return;
    const turn = rnd() * Math.PI * 2;
    for (let i = 0; i < 5; i++) {
      const a = turn + (i / 5) * Math.PI * 2, k = r * (0.75 + 0.5 * rnd());
      bx[i] = x + Math.cos(a) * k; by[i] = y - 0.05; bz[i] = z + Math.sin(a) * k;
    }
    const ox = (rnd() - 0.5) * r * 0.5, oz = (rnd() - 0.5) * r * 0.5;
    for (let i = 0; i < 3; i++) {
      const a = turn + 0.4 + (i / 3) * Math.PI * 2, k = r * (0.3 + 0.3 * rnd());
      bx[5 + i] = x + ox + Math.cos(a) * k; by[5 + i] = y + h * (0.75 + 0.25 * rnd()); bz[5 + i] = z + oz + Math.sin(a) * k;
    }
    const cy = y + h * 0.3;
    const face = (a: number, b: number, c: number) => {
      let nx = (by[b] - by[a]) * (bz[c] - bz[a]) - (bz[b] - bz[a]) * (by[c] - by[a]);
      let ny = (bz[b] - bz[a]) * (bx[c] - bx[a]) - (bx[b] - bx[a]) * (bz[c] - bz[a]);
      let nz = (bx[b] - bx[a]) * (by[c] - by[a]) - (by[b] - by[a]) * (bx[c] - bx[a]);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const out = nx * (bx[a] + bx[b] + bx[c] - 3 * x) + ny * (by[a] + by[b] + by[c] - 3 * cy) + nz * (bz[a] + bz[b] + bz[c] - 3 * z);
      if (out < 0) {
        const t = b; b = c; c = t;
        nx = -nx; ny = -ny; nz = -nz;
      }
      const t = ny * 0.5 + 0.5, k = 0.93 + 0.14 * rnd();
      const cr = (low[0] + (high[0] - low[0]) * t) * k, cg = (low[1] + (high[1] - low[1]) * t) * k, cb = (low[2] + (high[2] - low[2]) * t) * k;
      const ix = Math.round(nx * 127), iy = Math.round(ny * 127), iz = Math.round(nz * 127);
      vert(bx[a], by[a], bz[a], ix, iy, iz, cr, cg, cb, sway ? Math.max(0, by[a] - y) : 0);
      vert(bx[b], by[b], bz[b], ix, iy, iz, cr, cg, cb, sway ? Math.max(0, by[b] - y) : 0);
      vert(bx[c], by[c], bz[c], ix, iy, iz, cr, cg, cb, sway ? Math.max(0, by[c] - y) : 0);
    };
    // Stitch the ring of five to the ring of three, then cap it.
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5;
      face(i, j, UP[i]);
      if (UP[j] !== UP[i]) face(j, UP[j], UP[i]);
    }
    face(5, 6, 7);
  },

  get triangles(): number {
    return cv / 3;
  },

  /** The finished mesh data, or null if nothing was added. */
  end(): MeshData | null {
    if (!cv) return null;
    const position = cPos.slice(0, cv * 3);
    return { position, normal: cNor.slice(0, cv * 3), color: cCol.slice(0, cv * 4), shade: cShade.slice(0, cv * 3), sphere: sphereOf(position) };
  },
};
