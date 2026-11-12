import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { CHUNK, SEA_LEVEL, Tile, TILE_COUNT, elevationAt, hash2, heightOf, perlin, rand2, type TileCache } from '@terra/shared';
import { LIFT_UNIT, TREES, cover, rnd, seedRnd, type RGB } from './flora.ts';
import { BAKE_EAST, BAKE_WEST, foliageMaterial, groundMaterial, waterMaterial } from './look.ts';

/** Chunk building stops for the frame once it has used this much time (it always builds at least one). */
const BUILD_BUDGET_MS = 4;

/** World height (in tiles) of the water surface. */
export const WATER_Y = 0;

/**
 * Maps raw elevation to world height. It is the shared rule's own curve (`heightOf`), so a tile the
 * rules call a cliff is drawn exactly as steep as the rule measured it.
 */
export function heightFromElevation(e: number): number {
  return heightOf(e - SEA_LEVEL);
}

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
  // Natural terrain (M4c), styled in visual-foundation milestone 7. See docs/ART_DIRECTION.md.
  // Lake beds are peat and silt, darker and greener than the sandy sea bed.
  [Tile.Lake]: [[40, 62, 66], [48, 72, 72]],
  [Tile.LakeShallows]: [[122, 134, 100], [146, 148, 110]],
  // Rivers arrive with M4c step 2: a pebbly stream bed and a dark river bed, ready for them.
  [Tile.Stream]: [[150, 150, 128], [170, 164, 136]],
  [Tile.River]: [[58, 78, 84], [66, 88, 90]],
  // Cliff: warm buff stone. Its bedding is drawn by the ground shader.
  [Tile.Cliff]: [[168, 150, 126], [190, 172, 146]],
  // Desert: apricot and ochre, deeper than the pale beach.
  [Tile.Desert]: [[212, 170, 112], [232, 196, 136]],
  // Tundra: lichen green drifting into russet heath.
  [Tile.Tundra]: [[130, 144, 116], [162, 142, 110]],
  // Marsh: wet olive and moss, browner and darker than grass.
  [Tile.Marsh]: [[86, 100, 66], [118, 128, 80]],
  // Conifer forest floor: needle litter, browner and darker than under broadleaves.
  [Tile.Conifer]: [[74, 92, 66], [98, 102, 72]],
};
if (Object.keys(GROUND).length !== TILE_COUNT) throw new Error('missing tile colors');
/** The same table laid flat for the chunk builder: per tile, the deep tone then the step to the sun-bleached one. */
const GROUND_FLAT = new Float32Array(TILE_COUNT * 6);
for (let t = 0; t < TILE_COUNT; t++) for (let k = 0; k < 3; k++) {
  GROUND_FLAT[t * 6 + k] = GROUND[t][0][k];
  GROUND_FLAT[t * 6 + 3 + k] = GROUND[t][1][k] - GROUND[t][0][k];
}

/** What shows on faces too steep to hold their cover: bare earth under greenery, darker stone under rock and snow. */
const SCARP_EARTH: RGB = [158, 134, 102];
const SCARP_STONE: RGB = [118, 108, 98];

/** Tile corners are nudged this far (in tiles) off the grid, so the land reads as hand-cut, not gridded. */
const JITTER = 0.16;
/** A chunk with at least this many trees of one kind draws them as four quarters, each culled on its own. */
const SPLIT_TREES = 100;
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
// Broadleaves follow the seasons; pines keep their needles.
const leafMat = foliageMaterial(LIFT_UNIT, false, true);
const pineMat = foliageMaterial(LIFT_UNIT);
// Blades are single triangles seen from both sides.
const coverMat = foliageMaterial(LIFT_UNIT, true);

/**
 * What grows where. Everything is decided from (seed, x, y), so every player sees the same tuft on the
 * same tile; none of it touches walkability. Colours are sRGB 0-255.
 */
/** Chance that an open grass or meadow tile holds a lone tree. Such trees also shade the land (see `gather`). */
const LONE_GRASS = 0.013, LONE_MEADOW = 0.005;
const LONE_SALT = 0x1f3d;
const lone = (seed: number, t: number, x: number, y: number) =>
  (t === Tile.Grass && rand2(seed ^ LONE_SALT, x, y) < LONE_GRASS) || (t === Tile.Meadow && rand2(seed ^ LONE_SALT, x, y) < LONE_MEADOW);

/** Directions a blade can face, looked up instead of computed: a chunk holds thousands of blades. */
const TURNS = 64;
const TURN_COS = new Float32Array(TURNS), TURN_SIN = new Float32Array(TURNS);
for (let i = 0; i < TURNS; i++) {
  TURN_COS[i] = Math.cos((i / TURNS) * Math.PI * 2);
  TURN_SIN[i] = Math.sin((i / TURNS) * Math.PI * 2);
}

const GRASS_TIP: RGB = [178, 196, 112];
const MEADOW_TIP: RGB = [232, 212, 134];
const FERN_TIP: RGB = [116, 156, 88];
const ALPINE_TIP: RGB = [176, 166, 124];
const MARRAM_TIP: RGB = [230, 224, 174];
const REED: readonly [RGB, RGB] = [[86, 108, 68], [190, 180, 118]];
const CATTAIL: RGB = [96, 68, 48];
const BUSH: readonly [RGB, RGB] = [[70, 108, 64], [150, 174, 98]];
const STONE: readonly [RGB, RGB] = [[112, 104, 96], [188, 178, 160]];
const SNOW_STONE: readonly [RGB, RGB] = [[108, 100, 92], [150, 144, 136]];
const MOSSY: readonly [RGB, RGB] = [[108, 104, 92], [158, 166, 120]];
const PEBBLE: readonly [RGB, RGB] = [[150, 140, 124], [206, 198, 180]];
const WET_STONE: readonly [RGB, RGB] = [[84, 88, 86], [150, 148, 138]];
// Desert: bleached grass, grey sage, dead shrubs and ochre stone.
const DRY_TIP: RGB = [226, 206, 150];
const SAGE: readonly [RGB, RGB] = [[124, 122, 92], [186, 180, 136]];
const TWIG: RGB = [96, 78, 62];
const SANDSTONE: readonly [RGB, RGB] = [[150, 112, 80], [212, 170, 120]];
// Tundra: russet heath, dwarf shrubs, lichened stone and cotton-grass.
const HEATH_TIP: RGB = [158, 120, 104];
const HEATH_BUSH: readonly [RGB, RGB] = [[84, 78, 64], [128, 108, 86]];
const LICHEN: readonly [RGB, RGB] = [[124, 126, 112], [188, 192, 170]];
const COTTON: RGB = [246, 244, 236];
// Marsh sedge, and the low bushes of the conifer forest floor.
const SEDGE_TIP: RGB = [176, 170, 104];
const BILBERRY: readonly [RGB, RGB] = [[58, 84, 62], [108, 132, 88]];
/** Frost that lies in the tundra's hollows all year, and the dark pools that stand in a marsh. */
const FROST: RGB = [226, 232, 238], POOL: RGB = [56, 72, 70];
/** Flowers stay paler than any explorer's colour. Oxeye white, buttercup, harebell, and sea thrift by the shore. */
const WHITE: RGB = [244, 238, 220], YELLOW: RGB = [236, 204, 96], LILAC: RGB = [172, 160, 214], THRIFT: RGB = [226, 170, 184];

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
  cover: BufferGeometry | null;
  trees: InstancedMesh[];
  /** Baked shade at the chunk's tile corners (N by N, three bytes each), for shading what stands on it. */
  shade: Uint8Array;
}

// Scratch space reused by every build.
const winRaw = new Float32Array(WIN * WIN);
const winGround = new Float32Array(WIN * WIN);
const winOcc = new Float32Array(WIN * WIN);
const cornerShade = new Uint8Array(N * N * 3);
const cornerColor = new Float32Array(N * N * 3);
const cornerX = new Float32Array(N * N);
const cornerZ = new Float32Array(N * N);
const cornerTone = new Float32Array(N * N);
const cornerDrift = new Float32Array(N * N);
const cornerSteep = new Float32Array(N * N);
/** 1 at corners that touch lake water, 0 elsewhere (the sea included). */
const cornerLake = new Float32Array(N * N);
/** The slow noises are sampled every LAT tiles and interpolated; the lattice lines up across chunks, so seams match. */
const LAT = 4, LN = CHUNK / LAT + 1;
const latTone = new Float32Array(LN * LN);
const latDrift = new Float32Array(LN * LN);
/** The tile being built: its two facets, each as normal bytes (3), colour (3) and normal.y. */
const facet = new Float32Array(14);
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
    c.cover?.dispose();
    for (const t of c.trees) t.dispose();
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

  /**
   * Baked shade of the ground at a spot: ambient occlusion, then how high the land rises toward the
   * morning and the evening sun (each 0-1). Reads as open ground where nothing is built yet.
   */
  shadeAt(x: number, y: number, out: Vector3): Vector3 {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.chunks.get(`${cx},${cy}`);
    if (!c) return out.set(1, 0, 0);
    const i = (Math.round(y - cy * CHUNK) * N + Math.round(x - cx * CHUNK)) * 3;
    return out.set(c.shade[i] / 255, c.shade[i + 1] / 255, c.shade[i + 2] / 255);
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

    // Trees standing wholly beyond the radius are not drawn: nothing out there is inked in.
    for (const c of this.chunks.values()) for (const mesh of c.trees) {
      const r = mesh.userData.rect as number[];
      const dx = Math.max(r[0] - camX, 0, camX - r[2]), dy = Math.max(r[1] - camY, 0, camY - r[3]);
      mesh.visible = dx * dx + dy * dy <= radius * radius;
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

  /** Fill the scratch windows with heights around a chunk: bare ground, and ground plus the trees standing on it. */
  private gather(cx: number, cy: number) {
    const seed = this.tiles.seed;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const g = this.heights.grid(cx + dx, cy + dy);
      const t = this.tiles.base(cx + dx, cy + dy);
      const x0 = Math.max(0, dx * CHUNK + M), x1 = Math.min(WIN, (dx + 1) * CHUNK + M);
      const y0 = Math.max(0, dy * CHUNK + M), y1 = Math.min(WIN, (dy + 1) * CHUNK + M);
      for (let j = y0; j < y1; j++) {
        const row = (j - M - dy * CHUNK) * CHUNK - M - dx * CHUNK;
        for (let i = x0; i < x1; i++) {
          // Shadows fall on the water's surface, not the seabed.
          const raw = g[row + i], h = raw > WATER_Y ? raw : WATER_Y;
          winRaw[j * WIN + i] = raw;
          winGround[j * WIN + i] = h;
          const tile = t[row + i];
          winOcc[j * WIN + i] =
            tile === Tile.Forest ? h + CANOPY
            : tile === Tile.Conifer ? h + CANOPY * 1.25
            : lone(seed, tile, cx * CHUNK + i - M, cy * CHUNK + j - M) ? h + CANOPY * 0.9
            : h;
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
    for (let y = 0; y < LN; y++) for (let x = 0; x < LN; x++) {
      const wx = ox + x * LAT, wy = oy + y * LAT;
      latTone[y * LN + x] = perlin(seed + 4099, wx / 13, wy / 13);
      latDrift[y * LN + x] = perlin(seed + 7717, wx / 21, wy / 21);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, wx = ox + x, wy = oy + y;
      const w = (y + M) * WIN + x + M;
      const h = winRaw[w];
      hc[i] = h;
      if (h < 0.12) anyWater = true;
      cornerX[i] = x + (rand2(seed ^ 0x6a17, wx, wy) - 0.5) * 2 * JITTER;
      cornerZ[i] = y + (rand2(seed ^ 0x3c59, wx, wy) - 0.5) * 2 * JITTER;

      // Colour: the four tiles around the corner, each somewhere between its two tones.
      const lx = Math.min(x >> 2, LN - 2), ly = Math.min(y >> 2, LN - 2), l = ly * LN + lx;
      const fx = (x - lx * LAT) / LAT, fy = (y - ly * LAT) / LAT;
      const t0 = latTone[l] + (latTone[l + 1] - latTone[l]) * fx, t1 = latTone[l + LN] + (latTone[l + LN + 1] - latTone[l + LN]) * fx;
      const tone = Math.max(0, Math.min(1, (t0 + (t1 - t0) * fy) * 0.75 + 0.5));
      cornerTone[i] = tone;
      // A second, slower drift decides which plants gather where: flower colonies, reed beds, stands of pine.
      const d0 = latDrift[l] + (latDrift[l + 1] - latDrift[l]) * fx, d1 = latDrift[l + LN] + (latDrift[l + LN + 1] - latDrift[l + LN]) * fx;
      cornerDrift[i] = d0 + (d1 - d0) * fy;
      let r = 0, g = 0, b = 0, forest = 0, desert = 0, tundra = 0, marsh = 0, lake = 0;
      for (let k = 0; k < 4; k++) {
        const t = basePad[(y + (k >> 1)) * P + x + (k & 1)], c = t * 6;
        r += GROUND_FLAT[c] + GROUND_FLAT[c + 3] * tone;
        g += GROUND_FLAT[c + 1] + GROUND_FLAT[c + 4] * tone;
        b += GROUND_FLAT[c + 2] + GROUND_FLAT[c + 5] * tone;
        if (t === Tile.Forest || t === Tile.Conifer) forest++;
        else if (t === Tile.Desert) desert++;
        else if (t === Tile.Tundra) tundra++;
        else if (t === Tile.Marsh) marsh++;
        else if (t === Tile.Lake || t === Tile.LakeShallows) lake++;
      }
      r /= 4; g /= 4; b /= 4;
      cornerLake[i] = lake ? 1 : 0;
      if (desert) {
        // Dunes: broad ripples lying across the prevailing wind, bent by the slow drift so no two run alike.
        const k = 1 + 0.06 * (desert / 4) * Math.sin((wx - wy) * 0.55 + 9 * cornerDrift[i]);
        r *= k; g *= k; b *= k;
      }
      if (tundra) {
        // Frost lies in patches all year.
        const f = (tundra / 4) * smoothstep(0.04, 0.4, cornerDrift[i]) * 0.6;
        r += (FROST[0] - r) * f; g += (FROST[1] - g) * f; b += (FROST[2] - b) * f;
      }
      if (marsh) {
        // Dark pools stand between the tussocks where the ground is lowest and wettest.
        const p = (marsh / 4) * smoothstep(0.36, 0.2, tone) * 0.7;
        r += (POOL[0] - r) * p; g += (POOL[1] - g) * p; b += (POOL[2] - b) * p;
      }
      // The strand: sand the water has just left is darker and cooler than dry sand.
      const wet = smoothstep(0.36, 0.17, h) * smoothstep(-0.4, -0.1, h);
      cornerColor[i * 3] = r * (1 - 0.15 * wet);
      cornerColor[i * 3 + 1] = g * (1 - 0.12 * wet);
      cornerColor[i * 3 + 2] = b * (1 - 0.08 * wet);

      // Ambient occlusion: hollows and valley floors sit a little darker than ridges. So does ground under trees.
      const h0 = winGround[w];
      const around =
        (winGround[w - 2] + winGround[w + 2] + winGround[w - 2 * WIN] + winGround[w + 2 * WIN] +
          winGround[w - 2 - 2 * WIN] + winGround[w + 2 - 2 * WIN] + winGround[w - 2 + 2 * WIN] + winGround[w + 2 + 2 * WIN]) / 8;
      const ao = (1 - Math.max(0, Math.min(0.4, (around - h0) * 0.3))) * (1 - 0.06 * forest);
      // How steeply the land falls away here (rise over run), for bare scarps.
      cornerSteep[i] = Math.hypot(winGround[w + 1] - winGround[w - 1], winGround[w + WIN] - winGround[w - WIN]) / 2;
      cornerShade[i * 3] = byte(ao);
      cornerShade[i * 3 + 1] = byte(horizon(winOcc, x + M, y + M, h0, BAKE_EAST));
      cornerShade[i * 3 + 2] = byte(horizon(winOcc, x + M, y + M, h0, BAKE_WEST));
    }

    // Non-indexed: every triangle is its own facet, with its own normal and colour.
    const count = CHUNK * CHUNK * 6;
    const pos = new Float32Array(count * 3);
    const nor = new Int8Array(count * 3);
    // rgb, then how strongly the rock's bedding shows on this facet (see the ground shader).
    const col = new Uint8Array(count * 4);
    const shade = new Uint8Array(count * 3);
    let v = 0;
    const tri = (a: number, b: number, c: number, t: Tile, edited: boolean, jitter: number, slot: number) => {
      const ax = cornerX[a], ay = hc[a], az = cornerZ[a];
      const ux = cornerX[b] - ax, uy = hc[b] - ay, uz = cornerZ[b] - az;
      const wx = cornerX[c] - ax, wy = hc[c] - ay, wz = cornerZ[c] - az;
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      let r: number, g: number, bl: number, strata = 0;
      if (edited) {
        // What players build stays crisp: exactly the tile, no blending into its neighbours.
        const c0 = GROUND[t][0];
        r = c0[0]; g = c0[1]; bl = c0[2];
      } else {
        r = (cornerColor[a * 3] + cornerColor[b * 3] + cornerColor[c * 3]) / 3;
        g = (cornerColor[a * 3 + 1] + cornerColor[b * 3 + 1] + cornerColor[c * 3 + 1]) / 3;
        bl = (cornerColor[a * 3 + 2] + cornerColor[b * 3 + 2] + cornerColor[c * 3 + 2]) / 3;
        // Steep faces above the waterline shed their cover. Dunes and beds under water keep theirs.
        if (t !== Tile.Water && t !== Tile.DeepWater && t !== Tile.Sand && t !== Tile.Desert && t !== Tile.Lake && t !== Tile.LakeShallows) {
          // Mostly the lie of the land around the facet, so scarps run in bands along a hillside
          // instead of speckling it; partly the facet's own tilt, so the band's edge stays broken.
          const own = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(0.2, ny);
          const slope = 0.7 * (cornerSteep[a] + cornerSteep[b] + cornerSteep[c]) / 3 + 0.3 * own;
          if (t === Tile.Cliff) {
            // A cliff is its own stone where it is sheer, and keeps a little of the land it cuts through:
            // a mesa in the desert is redder than an escarpment in grassland.
            const s = smoothstep(0.45, 0.9, slope), tone = (cornerTone[a] + cornerTone[b] + cornerTone[c]) / 3;
            const lo = GROUND[Tile.Cliff][0], hi = GROUND[Tile.Cliff][1], m = s * 0.7;
            r += (lo[0] + (hi[0] - lo[0]) * tone - r) * m;
            g += (lo[1] + (hi[1] - lo[1]) * tone - g) * m;
            bl += (lo[2] + (hi[2] - lo[2]) * tone - bl) * m;
            strata = s;
          } else {
            const s = smoothstep(0.62, 1.05, slope) * 0.75;
            const stone = t === Tile.Rock || t === Tile.Snow || t === Tile.Tundra;
            const sc = stone ? SCARP_STONE : SCARP_EARTH;
            r += (sc[0] - r) * s; g += (sc[1] - g) * s; bl += (sc[2] - bl) * s;
            // Bare mountain rock shows its bedding too, more faintly.
            if (stone) strata = s * 0.6;
          }
        }
      }
      const k = 0.955 + jitter * 0.09;
      r = Math.min(255, r * k); g = Math.min(255, g * k); bl = Math.min(255, bl * k);
      facet[slot + 6] = ny;
      nx = Math.round(nx * 127); ny = Math.round(ny * 127); nz = Math.round(nz * 127);
      facet[slot] = nx; facet[slot + 1] = ny; facet[slot + 2] = nz;
      facet[slot + 3] = r; facet[slot + 4] = g; facet[slot + 5] = bl;
      const bedding = Math.round(strata * 255);
      for (let n = 0; n < 3; n++) {
        const i = n === 0 ? a : n === 1 ? b : c, o = v * 3, o4 = v * 4;
        pos[o] = cornerX[i]; pos[o + 1] = hc[i]; pos[o + 2] = cornerZ[i];
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        col[o4] = r; col[o4 + 1] = g; col[o4 + 2] = bl; col[o4 + 3] = bedding;
        shade[o] = cornerShade[i * 3]; shade[o + 1] = cornerShade[i * 3 + 1]; shade[o + 2] = cornerShade[i * 3 + 2];
        v++;
      }
    };

    // ---- What grows on a tile. `fa` / `fb` are the corners of its two facets; `spot` picks a point on one.
    const fa = [0, 0, 0], fb = [0, 0, 0];
    let px = 0, py = 0, pz = 0, pk = 0;
    const spot = () => {
      pk = rnd() < 0.5 ? 0 : 7;
      const f = pk ? fb : fa;
      let u = rnd(), w = rnd();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      // Keep clear of the facet's edges, so nothing straddles a crease.
      u = 0.07 + u * 0.8; w = 0.07 + w * 0.8;
      const a = f[0], b = f[1], c = f[2];
      px = cornerX[a] + (cornerX[b] - cornerX[a]) * u + (cornerX[c] - cornerX[a]) * w;
      py = hc[a] + (hc[b] - hc[a]) * u + (hc[c] - hc[a]) * w;
      pz = cornerZ[a] + (cornerZ[b] - cornerZ[a]) * u + (cornerZ[c] - cornerZ[a]) * w;
    };
    const ground3: [number, number, number] = [0, 0, 0], tip3: [number, number, number] = [0, 0, 0];
    /** A tuft rooted in the facet's own colour, so it reads as the land's texture, not something set on it. */
    const tuft = (blades: number, lo: number, hi: number, width: number, splay: number, tip: RGB, tipMix: number) => {
      spot();
      // Steep faces shed their cover.
      if (facet[pk + 6] < 0.8) return;
      const r = facet[pk + 3], g = facet[pk + 4], b = facet[pk + 5];
      // A blade is widest at its root, so the root colour is most of what is seen: start it part-way to the tip.
      const rootMix = tipMix * 0.4;
      ground3[0] = r + (tip[0] - r) * rootMix; ground3[1] = g + (tip[1] - g) * rootMix; ground3[2] = b + (tip[2] - b) * rootMix;
      tip3[0] = r + (tip[0] - r) * tipMix; tip3[1] = g + (tip[1] - g) * tipMix; tip3[2] = b + (tip[2] - b) * tipMix;
      for (let n = 0; n < blades; n++) {
        const a = (rnd() * TURNS) | 0, ca = TURN_COS[a], sa = TURN_SIN[a];
        const h = lo + (hi - lo) * rnd(), out = 0.07 * rnd();
        cover.blade(px + ca * out, py, pz + sa * out, -sa, ca, width, ca * h * splay, sa * h * splay, h, ground3, tip3,
          facet[pk], facet[pk + 1], facet[pk + 2]);
      }
    };
    const blooms = (count: number, color: RGB) => {
      for (let n = 0; n < count; n++) {
        spot();
        if (facet[pk + 6] < 0.8) continue;
        cover.bloom(px, py, pz, 0.2 + 0.16 * rnd(), 0.07 + 0.04 * rnd(), rnd() * 3.1416, color);
      }
    };
    const lump = (r: number, h: number, c: readonly [RGB, RGB], sway: boolean) => {
      spot();
      cover.lump(px, py, pz, r, h, c[0], c[1], sway);
    };
    // Trees, per species: x, ground height, z, size, turn, and a number to vary their proportions.
    const leafSpots: number[] = [], pineSpots: number[] = [];
    const tree = (pine: boolean, size: number) => {
      spot();
      (pine ? pineSpots : leafSpots).push(px, py, pz, size, rnd() * 6.2832, rnd());
    };

    /** A bed of reeds at the spot last picked, some with seed heads. `depth` is how far under water their roots are. */
    const reeds = (n: number, depth: number) => {
      for (let k = 0; k < n; k++) {
        const a = (rnd() * TURNS) | 0, ca = TURN_COS[a], sa = TURN_SIN[a], out = 0.3 * rnd();
        const tall = depth + 0.4 + 0.45 * rnd(), x = px + ca * out, z = pz + sa * out;
        const lx = (rnd() - 0.5) * 0.24 * tall, lz = (rnd() - 0.5) * 0.24 * tall;
        cover.blade(x, py, z, -sa, ca, 0.034, lx, lz, tall, REED[0], REED[1], 0, 127, 0);
        if (k < 2 && rnd() < 0.7) {
          cover.blade(x + lx * 0.7, py + tall * 0.7, z + lz * 0.7, -sa, ca, 0.04, lx * 0.22, lz * 0.22, tall * 0.22,
            CATTAIL, CATTAIL, 0, 127, 0, tall * 0.7);
        }
      }
    };
    /** A shrub that died standing: a few bare twigs splayed from one root. */
    const deadShrub = () => {
      spot();
      if (facet[pk + 6] < 0.8) return;
      const n = 5 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = (rnd() * TURNS) | 0, ca = TURN_COS[a], sa = TURN_SIN[a], h = 0.18 + 0.2 * rnd();
        cover.blade(px, py, pz, -sa, ca, 0.022, ca * h * 1.1, sa * h * 1.1, h, TWIG, TWIG, facet[pk], facet[pk + 1], facet[pk + 2]);
      }
    };

    const adorn = (t: Tile, wx: number, wy: number, i00: number) => {
      seedRnd(hash2(seed ^ 0x51ed, wx, wy));
      const tone = cornerTone[i00], drift = cornerDrift[i00], h = hc[i00];
      cover.shade(cornerShade[i00 * 3], cornerShade[i00 * 3 + 1], cornerShade[i00 * 3 + 2]);
      // Broadleaf woods hold the odd stand of pine, more of them as the land climbs.
      const piney = (h - 9) / 4 + drift * 1.7 + (rnd() - 0.5) * 0.6 > 0;
      switch (t) {
        case Tile.Forest: {
          const r = rnd();
          // Old growth is bigger where the land is lush; pines stand a little slimmer.
          if (r < 0.64) tree(piney, (piney ? 0.8 : 0.84) + 0.4 * (1 - tone) + 0.3 * rnd());
          else if (r < 0.74) lump(0.22 + 0.14 * rnd(), 0.26 + 0.16 * rnd(), BUSH, true);
          else if (r < 0.9) tuft(5, 0.2, 0.34, 0.09, 0.9, FERN_TIP, 0.75);
          break;
        }
        case Tile.Grass: {
          if (lone(seed, t, wx, wy)) {
            tree(piney, 0.8 + 0.45 * rnd());
            break;
          }
          const r = rnd();
          // Long grass gathers in the lusher patches and thins out on the sun-bleached ones.
          const lush = 0.68 - 0.5 * tone;
          if (r < lush) tuft(4, 0.2, 0.4, 0.06, 0.5, GRASS_TIP, 0.8);
          else if (r < lush + 0.018) lump(0.2 + 0.14 * rnd(), 0.22 + 0.14 * rnd(), BUSH, true);
          else if (r < lush + 0.03) lump(0.12 + 0.2 * rnd(), 0.1 + 0.16 * rnd(), MOSSY, false);
          // Flowers spill out of the meadows, and thrift keeps to the shore.
          if (h < 1.0 && rnd() < 0.1) blooms(2 + Math.floor(rnd() * 2), THRIFT);
          else if (Math.abs(drift) > 0.3 && rnd() < 0.1) blooms(2, drift > 0 ? WHITE : YELLOW);
          break;
        }
        case Tile.Meadow: {
          if (lone(seed, t, wx, wy)) {
            tree(piney, 0.85 + 0.4 * rnd());
            break;
          }
          if (rnd() < 0.62) tuft(4, 0.26, 0.5, 0.055, 0.5, MEADOW_TIP, 0.8);
          // Each colony is mostly one flower, thick at its heart and thin at its edge.
          const thick = Math.min(1, Math.abs(drift - 0.02) * 2.6);
          if (rnd() < 0.1 + 0.5 * thick) blooms(2 + Math.floor(rnd() * 3), drift < -0.1 ? YELLOW : drift > 0.14 ? LILAC : WHITE);
          else if (rnd() < 0.012) lump(0.12 + 0.16 * rnd(), 0.1 + 0.12 * rnd(), STONE, false);
          break;
        }
        case Tile.Sand: {
          const r = rnd();
          // Marram grass on the dry upper beach; pebbles and the odd flower below it.
          if (h > 0.3 && r < 0.1 + 0.16 * (1 - tone)) tuft(5, 0.22, 0.42, 0.04, 0.7, MARRAM_TIP, 1);
          else if (r > 0.95) {
            const n = 1 + Math.floor(rnd() * 3);
            for (let k = 0; k < n; k++) lump(0.05 + 0.07 * rnd(), 0.04 + 0.05 * rnd(), PEBBLE, false);
          }
          if (h > 0.34 && rnd() < 0.04) blooms(2, THRIFT);
          break;
        }
        case Tile.Water:
        case Tile.LakeShallows: {
          const r = rnd();
          // Reed beds hug a lake's shore, in patches. The sea has none: salt water keeps them out.
          // A few stones break the surface of either.
          if (t === Tile.LakeShallows && h > -0.3 && drift > -0.05 && r < 0.78) {
            spot();
            reeds(6 + Math.floor(rnd() * 5), Math.max(0, WATER_Y - py));
          } else if (h > -0.9 && r > 0.988) {
            // Only the top of a stone shows: it sits just under the surface, not on the seabed.
            spot();
            const rr = 0.2 + 0.22 * rnd();
            cover.lump(px, Math.max(py, WATER_Y - 0.1), pz, rr, 0.16 + 0.2 * rnd(), WET_STONE[0], WET_STONE[1], false);
          }
          break;
        }
        case Tile.Rock: {
          const r = rnd();
          // Boulders and scree; a few stunted pines hold on below the snow line.
          if (r < 0.2) {
            const rr = 0.14 + 0.34 * rnd() * rnd();
            lump(rr, rr * (0.6 + 0.6 * rnd()), STONE, false);
          } else if (r < 0.27) tuft(3, 0.1, 0.2, 0.04, 0.5, ALPINE_TIP, 0.7);
          else if (r > 0.975 && h < 13) tree(true, 0.5 + 0.3 * rnd());
          break;
        }
        case Tile.Snow: {
          if (rnd() < 0.05) {
            const rr = 0.14 + 0.26 * rnd();
            lump(rr, rr * (0.7 + 0.5 * rnd()), SNOW_STONE, false);
          }
          break;
        }
        case Tile.Conifer: {
          const r = rnd();
          // Pines stand close and tall. Little grows in their shade: fern, bilberry, mossed stone.
          if (r < 0.6) tree(true, 0.9 + 0.35 * (1 - tone) + 0.35 * rnd());
          else if (r < 0.67) lump(0.14 + 0.2 * rnd(), 0.1 + 0.14 * rnd(), MOSSY, false);
          else if (r < 0.78) tuft(4, 0.16, 0.28, 0.08, 0.9, FERN_TIP, 0.6);
          else if (r < 0.84) lump(0.18 + 0.1 * rnd(), 0.14 + 0.1 * rnd(), BILBERRY, true);
          break;
        }
        case Tile.Desert: {
          const r = rnd();
          // Life is sparse and gathers where the sand is darker: bleached grass, grey sage, a dead shrub, ochre stone.
          const lush = 0.04 + 0.17 * (1 - tone);
          if (r < lush) tuft(4, 0.14, 0.3, 0.035, 0.8, DRY_TIP, 1);
          else if (r < lush + 0.035) lump(0.16 + 0.14 * rnd(), 0.14 + 0.1 * rnd(), SAGE, true);
          else if (r < lush + 0.05) deadShrub();
          else if (r > 0.975) {
            const n = 1 + Math.floor(rnd() * 3);
            for (let k = 0; k < n; k++) {
              const rr = 0.06 + 0.22 * rnd() * rnd();
              lump(rr, rr * (0.5 + 0.5 * rnd()), SANDSTONE, false);
            }
          }
          break;
        }
        case Tile.Tundra: {
          const r = rnd();
          // Nothing stands tall: low heath, dwarf shrubs, lichened stone, and cotton-grass in colonies where it is wet.
          if (r < 0.34) tuft(4, 0.08, 0.18, 0.06, 1.1, HEATH_TIP, 0.7);
          else if (r < 0.4) lump(0.12 + 0.22 * rnd(), 0.07 + 0.1 * rnd(), LICHEN, false);
          else if (r < 0.44) lump(0.14 + 0.1 * rnd(), 0.08 + 0.05 * rnd(), HEATH_BUSH, true);
          else if (r > 0.992) tree(true, 0.4 + 0.2 * rnd());
          if (drift < -0.12 && rnd() < 0.3) blooms(2 + Math.floor(rnd() * 3), COTTON);
          break;
        }
        case Tile.Marsh: {
          const r = rnd();
          // Sedge tussocks stand thick on the firmer ground; reeds take the pools; marsh marigold between.
          if (tone < 0.3) {
            if (r < 0.55) {
              spot();
              reeds(4 + Math.floor(rnd() * 4), 0);
            }
          } else if (r < 0.7) tuft(6, 0.3, 0.6, 0.05, 0.6, SEDGE_TIP, 0.85);
          else if (r < 0.76) {
            spot();
            reeds(3 + Math.floor(rnd() * 3), 0);
          }
          if (rnd() < 0.07) blooms(2, YELLOW);
          else if (rnd() < 0.04) blooms(2, COTTON);
          break;
        }
        case Tile.Cliff: {
          // Stone that has come away from the face.
          if (rnd() < 0.16) {
            const rr = 0.1 + 0.3 * rnd() * rnd();
            lump(rr, rr * (0.6 + 0.5 * rnd()), STONE, false);
          }
          break;
        }
      }
    };

    cover.begin();
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
          fa[0] = i00; fa[1] = i01; fa[2] = i11;
          fb[0] = i00; fb[1] = i11; fb[2] = i10;
        } else {
          fa[0] = i00; fa[1] = i01; fa[2] = i10;
          fb[0] = i10; fb[1] = i01; fb[2] = i11;
        }
        tri(fa[0], fa[1], fa[2], t, edited, j0, 0);
        tri(fb[0], fb[1], fb[2], t, edited, j1, 7);
        if (Math.min(hc[i00], hc[i10], hc[i01], hc[i11]) < 0.12) {
          waterIndex.push(fa[0], fa[1], fa[2], fb[0], fb[1], fb[2]);
        }
        // What players build is bare: paving a tile clears what grew there.
        if (!edited && t !== Tile.DeepWater && t !== Tile.Lake) adorn(t, wx, wy, i00);
      }
    }

    const ground = new BufferGeometry();
    ground.setAttribute('position', new BufferAttribute(pos, 3));
    ground.setAttribute('normal', new BufferAttribute(nor, 3, true));
    ground.setAttribute('aColor', new BufferAttribute(col, 4, true));
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
      water.setAttribute('aLake', new BufferAttribute(cornerLake.slice(), 1));
      water.setAttribute('aShade', new BufferAttribute(cornerShade.slice(), 3, true));
      water.setIndex(waterIndex);
      water.computeBoundingSphere();
      group.add(new Mesh(water, waterMat));
    }

    const coverGeo = cover.end();
    if (coverGeo) group.add(new Mesh(coverGeo, coverMat));

    const trees: InstancedMesh[] = [];
    const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), sc = new Vector3(), up = new Vector3(0, 1, 0);
    for (const [geo, all] of [[TREES.broadleaf, leafSpots], [TREES.conifer, pineSpots]] as const) {
     // A chunk thick with trees is drawn as four quarters, so the quarters that lie outside the known
     // world can be left out (see `update`). Most of a chunk at the edge of the view is out there.
     const quarters = all.length / 6 >= SPLIT_TREES ? 4 : 1, H = CHUNK / 2;
     for (let quarter = 0; quarter < quarters; quarter++) {
      const spots = quarters === 1 ? all : [];
      if (quarters > 1) for (let i = 0; i < all.length; i += 6) {
        if ((all[i] >= H ? 1 : 0) + (all[i + 2] >= H ? 2 : 0) === quarter) for (let k = 0; k < 6; k++) spots.push(all[i + k]);
      }
      const count = spots.length / 6;
      if (!count) continue;
      const mesh = new InstancedMesh(geo, geo === TREES.broadleaf ? leafMat : pineMat, count);
      // The part of the map this mesh stands on: x0, y0, x1, y1.
      mesh.userData.rect = quarters === 1
        ? [ox, oy, ox + CHUNK, oy + CHUNK]
        : [ox + (quarter & 1) * H, oy + (quarter >> 1) * H, ox + (quarter & 1) * H + H, oy + (quarter >> 1) * H + H];
      // Per tree: how shaded its spot is, measured from mid-canopy over bare ground (not its own forest).
      const shades = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const x = spots[i * 6], y = spots[i * 6 + 1], z = spots[i * 6 + 2], k = spots[i * 6 + 3], vary = spots[i * 6 + 5];
        // No two the same shape: each is turned, and stretched a little differently in width and height.
        sc.set(k * (0.9 + 0.22 * vary), k * (1.12 - 0.26 * vary), k * (0.9 + 0.22 * ((vary * 7.3) % 1)));
        mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, spots[i * 6 + 4]), sc));
        const h0 = Math.max(y, WATER_Y) + 0.6 * k;
        shades[i * 3] = 0.8 + 0.2 * ((vary * 3.7) % 1);
        shades[i * 3 + 1] = horizon(winGround, x + M, z + M, h0, BAKE_EAST);
        shades[i * 3 + 2] = horizon(winGround, x + M, z + M, h0, BAKE_WEST);
      }
      mesh.instanceColor = new InstancedBufferAttribute(shades, 3);
      group.add(mesh);
      trees.push(mesh);
     }
    }
    return { group, ground, water, cover: coverGeo, trees, shade: cornerShade.slice() };
  }
}
