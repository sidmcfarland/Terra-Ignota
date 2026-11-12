import { BufferAttribute, BufferGeometry, IcosahedronGeometry, OctahedronGeometry } from 'three';
import { PALETTE } from './look.ts';

/**
 * What grows on the land: the tree models, and the builder for a chunk's
 * ground cover (grass tufts, flowers, rocks, bushes, reeds).
 *
 * Trees are instanced. Ground cover is merged into one mesh per chunk, so a
 * chunk's whole undergrowth is a single draw call. Both use the foliage
 * material in look.ts and share one vertex layout: position, a flat face
 * normal, and `aColor` = colour plus the vertex's height above its root
 * (`lift`, in units of LIFT_UNIT tiles). The lift lets the shader grow things
 * out of the map at the edge of the known world, and will let the wind move
 * tips more than roots.
 */

export type RGB = readonly [number, number, number];
type V3 = readonly [number, number, number];

/** `aColor.a` stores height above the root divided by this (tiles). */
export const LIFT_UNIT = 2.5;

const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const byte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

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

// ---------------------------------------------------------------- tree models

/** Collects flat-shaded triangles for a model that is built once and instanced. */
class Model {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];

  /** One facet, wound either way: it is flipped to face away from `inside`. */
  tri(a: V3, b: V3, c: V3, color: RGB, inside: V3) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const out = nx * (a[0] + b[0] + c[0] - 3 * inside[0]) + ny * (a[1] + b[1] + c[1] - 3 * inside[1]) + nz * (a[2] + b[2] + c[2] - 3 * inside[2]);
    if (out < 0) {
      [b, c] = [c, b];
      nx = -nx; ny = -ny; nz = -nz;
    }
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(byte(color[0]), byte(color[1]), byte(color[2]), byte((Math.max(0, p[1]) / LIFT_UNIT) * 255));
    }
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('aColor', new BufferAttribute(new Uint8Array(this.col), 4, true));
    g.computeBoundingSphere();
    return g;
  }
}

/** A three-sided tapered trunk, darker toward the root. */
function trunk(m: Model, r0: number, r1: number, h: number, lean: V3, color: RGB) {
  const ring = (r: number, y: number, k: number): V3[] =>
    [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      return [Math.cos(a) * r + lean[0] * k, y, Math.sin(a) * r + lean[2] * k] as const;
    });
  const lo = ring(r0, -0.06, 0), hi = ring(r1, h, 1);
  const inside: V3 = [lean[0] * 0.5, h / 2, lean[2] * 0.5];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, shade = 0.82 + 0.1 * i;
    const c: RGB = [color[0] * shade, color[1] * shade, color[2] * shade];
    m.tri(lo[i], lo[j], hi[i], c, inside);
    m.tri(lo[j], hi[j], hi[i], c, inside);
  }
}

/**
 * A faceted crown: a polyhedron with its corners pushed in and out by hand, the
 * faces nobody can see from above left out, and a ramp from a shaded underside
 * to sunlit top.
 */
function crown(m: Model, src: BufferGeometry, center: V3, radius: V3, wobble: number, low: RGB, high: RGB) {
  const p = src.getAttribute('position');
  // The same corner appears in several faces; it has to move the same way in each.
  const moved = new Map<string, V3>();
  const corner = (i: number): V3 => {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let v = moved.get(key);
    if (!v) {
      const k = 1 + (rnd() - 0.5) * 2 * wobble;
      // Crowns are fuller below the middle and flatter on top.
      const y = p.getY(i), ky = y > 0 ? 0.9 : 1.05;
      v = [center[0] + p.getX(i) * radius[0] * k, center[1] + y * radius[1] * k * ky, center[2] + p.getZ(i) * radius[2] * k];
      moved.set(key, v);
    }
    return v;
  };
  for (let i = 0; i < p.count; i += 3) {
    const a = corner(i), b = corner(i + 1), c = corner(i + 2);
    const cy = (a[1] + b[1] + c[1]) / 3;
    const t = (cy - (center[1] - radius[1])) / (2 * radius[1]);
    // The camera never looks up, so the underside is never drawn.
    if (t < 0.24) continue;
    const k = 0.94 + 0.12 * rnd();
    const color = mix(low, high, Math.min(1, Math.max(0, (t - 0.2) / 0.75)));
    m.tri(a, b, c, [color[0] * k, color[1] * k, color[2] * k], center);
  }
}

/** A broadleaf: short trunk, a full crown and a smaller lobe to one side, so no two turned copies match. */
function makeBroadleaf(): BufferGeometry {
  seedRnd(0x0a4b);
  const m = new Model();
  const low = rgb(PALETTE.canopyLow), high = rgb(PALETTE.canopyHigh);
  trunk(m, 0.085, 0.05, 0.7, [0.05, 0, 0.02], rgb(PALETTE.trunk));
  const ico = new IcosahedronGeometry(1, 0), oct = new OctahedronGeometry(1, 0);
  crown(m, ico, [0.03, 1.02, 0], [0.58, 0.47, 0.55], 0.13, low, high);
  crown(m, oct, [0.43, 0.74, 0.2], [0.33, 0.26, 0.32], 0.1, mix(low, high, 0.1), mix(low, high, 0.8));
  ico.dispose();
  oct.dispose();
  return m.geometry();
}

/** A conifer: three drooping tiers of five facets each, darker and bluer than the broadleaf. */
function makeConifer(): BufferGeometry {
  seedRnd(0x51c3);
  const m = new Model();
  const low = rgb(PALETTE.pineLow), high = rgb(PALETTE.pineHigh);
  trunk(m, 0.07, 0.045, 0.5, [0.02, 0, 0.01], rgb(PALETTE.pineTrunk));
  const tiers: Array<[y: number, r: number, apex: number]> = [[0.34, 0.46, 1.0], [0.76, 0.35, 1.36], [1.16, 0.23, 1.82]];
  tiers.forEach(([y, r, apex], n) => {
    const top: V3 = [0.03 * n, apex, 0.02 * n];
    const turn = n * 0.7 + 0.2;
    const ring: V3[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + turn, k = 0.86 + 0.28 * rnd();
      ring.push([Math.cos(a) * r * k, y - 0.07 * rnd(), Math.sin(a) * r * k]);
    }
    const c0 = mix(low, high, n * 0.3), c1 = mix(low, high, 0.35 + n * 0.3);
    for (let i = 0; i < 5; i++) {
      const k = 0.93 + 0.14 * rnd();
      const c = mix(c0, c1, rnd());
      m.tri(ring[i], ring[(i + 1) % 5], top, [c[0] * k, c[1] * k, c[2] * k], [0, y, 0]);
    }
  });
  return m.geometry();
}

export const TREES = {
  broadleaf: makeBroadleaf(),
  conifer: makeConifer(),
} as const;
export const TREE_TRIANGLES = {
  broadleaf: TREES.broadleaf.getAttribute('position').count / 3,
  conifer: TREES.conifer.getAttribute('position').count / 3,
} as const;

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
  end(): BufferGeometry | null {
    if (!cv) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(cPos.slice(0, cv * 3), 3));
    g.setAttribute('normal', new BufferAttribute(cNor.slice(0, cv * 3), 3, true));
    g.setAttribute('aColor', new BufferAttribute(cCol.slice(0, cv * 4), 4, true));
    g.setAttribute('aShade', new BufferAttribute(cShade.slice(0, cv * 3), 3, true));
    g.computeBoundingSphere();
    return g;
  },
};
