import { BufferAttribute, BufferGeometry, IcosahedronGeometry, OctahedronGeometry } from 'three';
import { LIFT_UNIT, rnd, seedRnd, type RGB } from './cover.ts';
import { PALETTE } from './look.ts';

/**
 * What grows on the land: the tree models. The builder for a chunk's ground
 * cover (grass tufts, flowers, rocks, bushes, reeds) is in cover.ts.
 *
 * Trees are instanced. Ground cover is merged into one mesh per chunk, so a
 * chunk's whole undergrowth is a single draw call. Both use the foliage
 * material in look.ts and share one vertex layout: position, a flat face
 * normal, and `aColor` = colour plus the vertex's height above its root
 * (`lift`, in units of LIFT_UNIT tiles). The lift lets the shader grow things
 * out of the map at the edge of the known world, and will let the wind move
 * tips more than roots.
 */

type V3 = readonly [number, number, number];

const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const byte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

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
