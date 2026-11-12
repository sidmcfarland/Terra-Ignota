import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { CHUNK, SEA_LEVEL, Tile, TILE_COUNT, elevationAt, perlin, rand2, type TileCache } from '@terra/shared';
import { BAKE_EAST, BAKE_WEST, PALETTE, foliageMaterial, groundMaterial, waterMaterial } from './look.ts';

/** Chunk building stops for the frame once it has used this much time (it always builds at least one). */
const BUILD_BUDGET_MS = 4;

/** World height (in tiles) of the water surface. */
export const WATER_Y = 0;

/** Maps raw elevation to world height. Land rises faster with altitude; the seabed is shallower. */
export function heightFromElevation(e: number): number {
  const x = e - SEA_LEVEL;
  return x >= 0 ? 30 * Math.pow(x, 1.6) + 0.15 : x * 8;
}

type RGB = readonly [number, number, number];

/**
 * Ground colours, sRGB 0–255. Each tile has two: patches of land drift between
 * them (a cooler, deeper one and a warmer, sun-bleached one), so no biome is a flat fill.
 */
const GROUND: Record<number, readonly [RGB, RGB]> = {
  [Tile.DeepWater]: [[50, 82, 100], [58, 92, 106]],
  [Tile.Water]: [[150, 168, 142], [172, 178, 144]],
  [Tile.Sand]: [[214, 196, 150], [228, 210, 164]],
  [Tile.Grass]: [[112, 150, 86], [146, 168, 96]],
  [Tile.Forest]: [[84, 118, 74], [100, 128, 76]],
  [Tile.Meadow]: [[158, 176, 102], [190, 188, 112]],
  [Tile.Rock]: [[140, 130, 118], [160, 148, 130]],
  [Tile.Snow]: [[232, 232, 228], [244, 240, 230]],
  [Tile.Path]: [[184, 156, 116], [184, 156, 116]],
  [Tile.Wall]: [[104, 98, 90], [104, 98, 90]],
};
if (Object.keys(GROUND).length !== TILE_COUNT) throw new Error('missing tile colors');

/** What shows on faces too steep to hold their cover: bare earth under greenery, darker stone under rock and snow. */
const SCARP_EARTH: RGB = [158, 134, 102];
const SCARP_STONE: RGB = [118, 108, 98];

/** Tile corners are nudged this far (in tiles) off the grid, so the land reads as hand-cut, not gridded. */
const JITTER = 0.16;
/** Extra height forest adds when it shades the land behind it. */
const CANOPY = 1.0;

/** Margin of heights gathered around a chunk for baking shadows; also the longest shadow, in tiles. */
const M = 24;
const N = CHUNK + 1;
const WIN = N + 2 * M;
/** Distances (tiles) at which the land is sampled along each shadow direction. */
const STEPS = [1, 1.75, 2.5, 3.5, 5, 7, 10, 14, 18.5, 23];

const groundMat = groundMaterial();
const waterMat = waterMaterial();
const treeMat = foliageMaterial();
const treeGeo = makeTreeGeometry();

function makeTreeGeometry(): BufferGeometry {
  const geo = new ConeGeometry(0.38, 1.1, 6).translate(0, 0.55, 0).toNonIndexed();
  geo.computeVertexNormals();
  // A gradient ramp up the tree: deep green in the skirt, lighter at the tip.
  const pos = geo.getAttribute('position');
  const col = new Uint8Array(pos.count * 3);
  const lo = [(PALETTE.canopyLow >> 16) & 255, (PALETTE.canopyLow >> 8) & 255, PALETTE.canopyLow & 255];
  const hi = [(PALETTE.canopyHigh >> 16) & 255, (PALETTE.canopyHigh >> 8) & 255, PALETTE.canopyHigh & 255];
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, pos.getY(i) / 1.1);
    for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.round(lo[k] + (hi[k] - lo[k]) * t);
  }
  geo.setAttribute('aColor', new BufferAttribute(col, 3, true));
  return geo;
}

/** Corner heights of the world, cached a chunk at a time. Shared by meshing, shadow baking and avatar grounding. */
class HeightField {
  private grids = new Map<number, Float32Array>();
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Heights at the CHUNK×CHUNK tile corners a chunk owns (its north-west ones), row-major. */
  grid(cx: number, cy: number): Float32Array {
    const key = (cx + 32768) * 65536 + (cy + 32768);
    let g = this.grids.get(key);
    if (!g) {
      if (this.grids.size >= 400) this.grids.delete(this.grids.keys().next().value!);
      g = new Float32Array(CHUNK * CHUNK);
      const ox = cx * CHUNK, oy = cy * CHUNK;
      for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
        g[y * CHUNK + x] = heightFromElevation(elevationAt(this.seed, ox + x, oy + y));
      }
      this.grids.set(key, g);
    }
    return g;
  }

  has(cx: number, cy: number): boolean {
    return this.grids.has((cx + 32768) * 65536 + (cy + 32768));
  }

  corner(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    return this.grid(cx, cy)[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }
}

interface Chunk {
  group: Group;
  ground: BufferGeometry;
  water: BufferGeometry | null;
  trees: InstancedMesh | null;
}

// Scratch space reused by every build.
const winGround = new Float32Array(WIN * WIN);
const winOcc = new Float32Array(WIN * WIN);
const cornerShade = new Uint8Array(N * N * 3);
const cornerColor = new Float32Array(N * N * 3);
const cornerX = new Float32Array(N * N);
const cornerZ = new Float32Array(N * N);
const basePad = new Uint8Array((CHUNK + 2) * (CHUNK + 2));

/** How high the land rises (as a fraction of 90°) looking from a window point along a direction. */
function horizon(occ: Float32Array, px: number, py: number, h0: number, dir: readonly [number, number]): number {
  let maxTan = 0;
  for (const d of STEPS) {
    const fx = px + dir[0] * d, fy = py + dir[1] * d;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const k = iy * WIN + ix;
    const a = occ[k] + (occ[k + 1] - occ[k]) * tx;
    const b = occ[k + WIN] + (occ[k + WIN + 1] - occ[k + WIN]) * tx;
    const t = (a + (b - a) * ty - h0) / d;
    if (t > maxTan) maxTan = t;
  }
  return Math.atan(maxTan) / (Math.PI / 2);
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Streams heightmap chunk meshes around the camera. World x → three x, world y → three z. */
export class Terrain {
  readonly group = new Group();
  /** Milliseconds the most recent chunk build took, and the slowest so far. */
  readonly buildMs = { last: 0, max: 0, count: 0 };
  private chunks = new Map<string, Chunk>();
  private readonly tiles: TileCache;
  private readonly heights: HeightField;
  /** Chunks whose generated tiles this renderer has already asked for (so they're in the tile cache). */
  private tilesReady = new Set<string>();

  constructor(tiles: TileCache) {
    this.tiles = tiles;
    this.heights = new HeightField(tiles.seed);
    // An edit changed a chunk: drop its mesh so the next update rebuilds it.
    tiles.onChunkChange((cx, cy) => this.drop(`${cx},${cy}`));
  }

  private drop(key: string) {
    const c = this.chunks.get(key);
    if (!c) return;
    this.group.remove(c.group);
    c.ground.dispose();
    c.water?.dispose();
    c.trees?.dispose();
    this.chunks.delete(key);
  }

  /** Ground height at a continuous world position (bilinear over tile corners). */
  heightAt(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const hf = this.heights;
    const h00 = hf.corner(x0, y0), h10 = hf.corner(x0 + 1, y0);
    const h01 = hf.corner(x0, y0 + 1), h11 = hf.corner(x0 + 1, y0 + 1);
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return a + (b - a) * fy;
  }

  update(camX: number, camY: number, radius: number) {
    const ccx = Math.floor(camX / CHUNK), ccy = Math.floor(camY / CHUNK);
    // Chunks that touch the circle of the given radius.
    const near = (cx: number, cy: number, pad: number) => {
      const dx = Math.max(cx * CHUNK - camX, 0, camX - (cx + 1) * CHUNK);
      const dy = Math.max(cy * CHUNK - camY, 0, camY - (cy + 1) * CHUNK);
      return Math.hypot(dx, dy) <= radius + pad;
    };
    const r = Math.ceil(radius / CHUNK) + 1;

    const missing: Array<[number, number]> = [];
    for (let cy = ccy - r; cy <= ccy + r; cy++) for (let cx = ccx - r; cx <= ccx + r; cx++) {
      if (near(cx, cy, 0) && !this.chunks.has(`${cx},${cy}`)) missing.push([cx, cy]);
    }
    missing.sort((a, b) => Math.hypot(a[0] - ccx, a[1] - ccy) - Math.hypot(b[0] - ccx, b[1] - ccy));
    const t0 = performance.now();
    const spent = () => performance.now() - t0 > BUILD_BUDGET_MS;
    for (const [cx, cy] of missing) {
      // A chunk's shadows and colours read the world a chunk out in every direction. Generating
      // that is the slow part, so it's done a chunk at a time, spread over frames.
      if (!this.prepare(cx, cy, spent) || spent()) break;
      const t = performance.now();
      const c = this.build(cx, cy);
      this.group.add(c.group);
      this.chunks.set(`${cx},${cy}`, c);
      const ms = performance.now() - t;
      this.buildMs.last = ms;
      this.buildMs.max = Math.max(this.buildMs.max, ms);
      this.buildMs.count++;
      if (spent()) break;
    }

    for (const key of [...this.chunks.keys()]) {
      const [cx, cy] = key.split(',').map(Number);
      if (!near(cx, cy, 2 * CHUNK)) this.drop(key);
    }
  }

  /** Generate the world data a chunk's mesh needs. Returns false if it ran out of time; call again next frame. */
  private prepare(cx: number, cy: number, spent: () => boolean): boolean {
    if (this.tilesReady.size > 900) this.tilesReady.clear();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const key = `${cx + dx},${cy + dy}`;
      const haveTiles = this.tilesReady.has(key), haveHeights = this.heights.has(cx + dx, cy + dy);
      if (haveTiles && haveHeights) continue;
      if (!haveHeights) this.heights.grid(cx + dx, cy + dy);
      if (!haveTiles) {
        this.tiles.base(cx + dx, cy + dy);
        this.tilesReady.add(key);
      }
      if (spent()) return false;
    }
    return true;
  }

  /** Generated (pre-edit) tile, for everything that must not depend on which edits a chunk has seen. */
  private baseTile(x: number, y: number): Tile {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    return this.tiles.base(cx, cy)[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] as Tile;
  }

  /** Fill the scratch windows with heights around a chunk: bare ground, and ground plus forest canopy. */
  private gather(cx: number, cy: number) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const g = this.heights.grid(cx + dx, cy + dy);
      const t = this.tiles.base(cx + dx, cy + dy);
      const x0 = Math.max(0, dx * CHUNK + M), x1 = Math.min(WIN, (dx + 1) * CHUNK + M);
      const y0 = Math.max(0, dy * CHUNK + M), y1 = Math.min(WIN, (dy + 1) * CHUNK + M);
      for (let j = y0; j < y1; j++) {
        const row = (j - M - dy * CHUNK) * CHUNK - M - dx * CHUNK;
        for (let i = x0; i < x1; i++) {
          // Shadows fall on the water's surface, not the seabed.
          const h = Math.max(g[row + i], WATER_Y);
          winGround[j * WIN + i] = h;
          winOcc[j * WIN + i] = t[row + i] === Tile.Forest ? h + CANOPY : h;
        }
      }
    }
  }

  private build(cx: number, cy: number): Chunk {
    const seed = this.tiles.seed;
    const tiles = this.tiles.chunk(cx, cy);
    const ox = cx * CHUNK, oy = cy * CHUNK;
    const P = CHUNK + 2;

    this.gather(cx, cy);

    // Generated tiles of the chunk plus a one-tile border, for blending colours across tile edges.
    const base = this.tiles.base(cx, cy);
    for (let y = -1; y <= CHUNK; y++) for (let x = -1; x <= CHUNK; x++) {
      const inside = x >= 0 && y >= 0 && x < CHUNK && y < CHUNK;
      basePad[(y + 1) * P + x + 1] = inside ? base[y * CHUNK + x] : this.baseTile(ox + x, oy + y);
    }

    // Per corner: position, blended colour, ambient occlusion and the two baked horizons.
    // Corners on a chunk edge come out identical in both chunks, so seams match.
    const hc = new Float32Array(N * N);
    let anyWater = false;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, wx = ox + x, wy = oy + y;
      const w = (y + M) * WIN + x + M;
      const h = this.heights.corner(wx, wy);
      hc[i] = h;
      if (h < 0.12) anyWater = true;
      cornerX[i] = x + (rand2(seed ^ 0x6a17, wx, wy) - 0.5) * 2 * JITTER;
      cornerZ[i] = y + (rand2(seed ^ 0x3c59, wx, wy) - 0.5) * 2 * JITTER;

      // Colour: the four tiles around the corner, each somewhere between its two tones.
      const tone = Math.max(0, Math.min(1, perlin(seed + 4099, wx / 13, wy / 13) * 0.75 + 0.5));
      let r = 0, g = 0, b = 0, forest = 0;
      for (let k = 0; k < 4; k++) {
        const t = basePad[(y + (k >> 1)) * P + x + (k & 1)];
        const [c0, c1] = GROUND[t];
        r += c0[0] + (c1[0] - c0[0]) * tone;
        g += c0[1] + (c1[1] - c0[1]) * tone;
        b += c0[2] + (c1[2] - c0[2]) * tone;
        if (t === Tile.Forest) forest++;
      }
      cornerColor[i * 3] = r / 4; cornerColor[i * 3 + 1] = g / 4; cornerColor[i * 3 + 2] = b / 4;

      // Ambient occlusion: hollows and valley floors sit a little darker than ridges. So does ground under trees.
      const h0 = winGround[w];
      const around =
        (winGround[w - 2] + winGround[w + 2] + winGround[w - 2 * WIN] + winGround[w + 2 * WIN] +
          winGround[w - 2 - 2 * WIN] + winGround[w + 2 - 2 * WIN] + winGround[w - 2 + 2 * WIN] + winGround[w + 2 + 2 * WIN]) / 8;
      const ao = (1 - Math.max(0, Math.min(0.4, (around - h0) * 0.3))) * (1 - 0.06 * forest);
      cornerShade[i * 3] = byte(ao);
      cornerShade[i * 3 + 1] = byte(horizon(winOcc, x + M, y + M, h0, BAKE_EAST));
      cornerShade[i * 3 + 2] = byte(horizon(winOcc, x + M, y + M, h0, BAKE_WEST));
    }

    // Non-indexed: every triangle is its own facet, with its own normal and colour.
    const count = CHUNK * CHUNK * 6;
    const pos = new Float32Array(count * 3);
    const nor = new Int8Array(count * 3);
    const col = new Uint8Array(count * 3);
    const shade = new Uint8Array(count * 3);
    const treeSpots: number[] = [];
    let v = 0;
    const tri = (a: number, b: number, c: number, t: Tile, edited: boolean, jitter: number) => {
      const ax = cornerX[a], ay = hc[a], az = cornerZ[a];
      const ux = cornerX[b] - ax, uy = hc[b] - ay, uz = cornerZ[b] - az;
      const wx = cornerX[c] - ax, wy = hc[c] - ay, wz = cornerZ[c] - az;
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      let r: number, g: number, bl: number;
      if (edited) {
        // What players build stays crisp: exactly the tile, no blending into its neighbours.
        const c0 = GROUND[t][0];
        r = c0[0]; g = c0[1]; bl = c0[2];
      } else {
        r = (cornerColor[a * 3] + cornerColor[b * 3] + cornerColor[c * 3]) / 3;
        g = (cornerColor[a * 3 + 1] + cornerColor[b * 3 + 1] + cornerColor[c * 3 + 1]) / 3;
        bl = (cornerColor[a * 3 + 2] + cornerColor[b * 3 + 2] + cornerColor[c * 3 + 2]) / 3;
        // Steep faces above the waterline shed their cover.
        if (t !== Tile.Water && t !== Tile.DeepWater && t !== Tile.Sand) {
          const s = smoothstep(0.9, 0.72, ny) * 0.75;
          const sc = t === Tile.Rock || t === Tile.Snow ? SCARP_STONE : SCARP_EARTH;
          r += (sc[0] - r) * s; g += (sc[1] - g) * s; bl += (sc[2] - bl) * s;
        }
      }
      const k = 0.955 + jitter * 0.09;
      r = Math.min(255, r * k); g = Math.min(255, g * k); bl = Math.min(255, bl * k);
      nx = Math.round(nx * 127); ny = Math.round(ny * 127); nz = Math.round(nz * 127);
      for (let n = 0; n < 3; n++) {
        const i = n === 0 ? a : n === 1 ? b : c, o = v * 3;
        pos[o] = cornerX[i]; pos[o + 1] = hc[i]; pos[o + 2] = cornerZ[i];
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        col[o] = r; col[o + 1] = g; col[o + 2] = bl;
        shade[o] = cornerShade[i * 3]; shade[o + 1] = cornerShade[i * 3 + 1]; shade[o + 2] = cornerShade[i * 3 + 2];
        v++;
      }
    };

    const waterIndex: number[] = [];
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const t = tiles[ty * CHUNK + tx] as Tile;
        const wx = ox + tx, wy = oy + ty;
        const edited = t !== base[ty * CHUNK + tx] || t === Tile.Path || t === Tile.Wall;
        const i00 = ty * N + tx, i10 = i00 + 1, i01 = i00 + N, i11 = i01 + 1;
        const j0 = rand2(seed, wx, wy), j1 = rand2(seed ^ 0x9e37, wx, wy);
        // Split each tile along the flatter diagonal, so ridges and gullies keep clean lines.
        // Counter-clockwise seen from above (+y), so faces point up.
        const alt = Math.abs(hc[i00] - hc[i11]) < Math.abs(hc[i10] - hc[i01]);
        if (alt) {
          tri(i00, i01, i11, t, edited, j0);
          tri(i00, i11, i10, t, edited, j1);
        } else {
          tri(i00, i01, i10, t, edited, j0);
          tri(i10, i01, i11, t, edited, j1);
        }
        if (Math.min(hc[i00], hc[i10], hc[i01], hc[i11]) < 0.12) {
          if (alt) waterIndex.push(i00, i01, i11, i00, i11, i10);
          else waterIndex.push(i00, i01, i10, i10, i01, i11);
        }

        if (t === Tile.Forest) {
          const jr = rand2(seed ^ 0x51ed, wx, wy);
          const jx = 0.3 + 0.4 * jr, jy = 0.3 + 0.4 * rand2(seed ^ 0x2b1d, wx, wy);
          const gh = hc[i00] + (hc[i10] - hc[i00]) * jx + (hc[i01] - hc[i00]) * jy;
          treeSpots.push(tx + jx, gh, ty + jy, 0.75 + jr * 0.6);
        }
      }
    }

    const ground = new BufferGeometry();
    ground.setAttribute('position', new BufferAttribute(pos, 3));
    ground.setAttribute('normal', new BufferAttribute(nor, 3, true));
    ground.setAttribute('aColor', new BufferAttribute(col, 3, true));
    ground.setAttribute('aShade', new BufferAttribute(shade, 3, true));
    ground.computeBoundingSphere();

    const group = new Group();
    group.position.set(ox, 0, oy);
    group.add(new Mesh(ground, groundMat));

    // Water: only where there is some, on the same corners and diagonals as the ground so the shoreline lines up.
    let water: BufferGeometry | null = null;
    if (anyWater && waterIndex.length) {
      const wpos = new Float32Array(N * N * 3), depth = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) {
        wpos[i * 3] = cornerX[i]; wpos[i * 3 + 1] = WATER_Y; wpos[i * 3 + 2] = cornerZ[i];
        depth[i] = WATER_Y - hc[i];
      }
      water = new BufferGeometry();
      water.setAttribute('position', new BufferAttribute(wpos, 3));
      water.setAttribute('aDepth', new BufferAttribute(depth, 1));
      water.setAttribute('aShade', new BufferAttribute(cornerShade.slice(), 3, true));
      water.setIndex(waterIndex);
      water.computeBoundingSphere();
      group.add(new Mesh(water, waterMat));
    }

    let trees: InstancedMesh | null = null;
    const treeCount = treeSpots.length / 4;
    if (treeCount) {
      trees = new InstancedMesh(treeGeo, treeMat, treeCount);
      // Per tree: how shaded its spot is, measured from mid-canopy over bare ground (not its own forest).
      const shades = new Float32Array(treeCount * 3);
      const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3();
      for (let i = 0; i < treeCount; i++) {
        const x = treeSpots[i * 4], y = treeSpots[i * 4 + 1], z = treeSpots[i * 4 + 2], k = treeSpots[i * 4 + 3];
        trees.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(k, k, k)));
        const h0 = Math.max(y, WATER_Y) + 0.6 * k;
        shades[i * 3] = 0.82 + 0.18 * rand2(seed ^ 0x77a1, ox + Math.floor(x), oy + Math.floor(z));
        shades[i * 3 + 1] = horizon(winGround, x + M, z + M, h0, BAKE_EAST);
        shades[i * 3 + 2] = horizon(winGround, x + M, z + M, h0, BAKE_WEST);
      }
      trees.instanceColor = new InstancedBufferAttribute(shades, 3);
      group.add(trees);
    }
    return { group, ground, water, trees };
  }
}
