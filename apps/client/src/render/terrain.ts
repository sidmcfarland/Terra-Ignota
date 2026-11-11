import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { CHUNK, SEA_LEVEL, Tile, TILE_COUNT, elevationAt, rand2, type TileCache } from '@terra/shared';

const MAX_BUILDS_PER_FRAME = 3;

/** World height (in tiles) of the water surface. */
export const WATER_Y = 0;

/** Maps raw elevation to world height. Land rises faster with altitude; the seabed is shallower. */
export function heightFromElevation(e: number): number {
  const x = e - SEA_LEVEL;
  return x >= 0 ? 30 * Math.pow(x, 1.6) + 0.15 : x * 8;
}

const BASE: Record<number, [number, number, number]> = {
  [Tile.DeepWater]: [24, 48, 74],
  [Tile.Water]: [60, 112, 120],
  [Tile.Sand]: [216, 198, 144],
  [Tile.Grass]: [92, 154, 70],
  [Tile.Forest]: [72, 124, 58],
  [Tile.Meadow]: [143, 179, 90],
  [Tile.Rock]: [128, 124, 112],
  [Tile.Snow]: [236, 240, 244],
};
if (Object.keys(BASE).length !== TILE_COUNT) throw new Error('missing tile colors');

const groundMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
const waterMat = new MeshLambertMaterial({ color: 0x2f6a8f, transparent: true, opacity: 0.78 });
const treeMat = new MeshLambertMaterial({ color: 0x2f5e2c, flatShading: true });
const treeGeo = new ConeGeometry(0.38, 1.1, 6).translate(0, 0.55, 0);
const waterGeo = new PlaneGeometry(CHUNK, CHUNK).rotateX(-Math.PI / 2).translate(CHUNK / 2, WATER_Y, CHUNK / 2);

interface Chunk {
  group: Group;
  ground: BufferGeometry;
  trees: InstancedMesh | null;
}

/** Streams heightmap chunk meshes around the camera. World x → three x, world y → three z. */
export class Terrain {
  readonly group = new Group();
  private chunks = new Map<string, Chunk>();
  private readonly tiles: TileCache;

  constructor(tiles: TileCache) {
    this.tiles = tiles;
  }

  /** Ground height at a continuous world position (bilinear over tile corners). */
  heightAt(x: number, y: number): number {
    const s = this.tiles.seed;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const h = (ix: number, iy: number) => heightFromElevation(elevationAt(s, ix, iy));
    const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * fx;
    const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  }

  update(camX: number, camY: number, radius: number) {
    const r = Math.ceil(radius / CHUNK) + 1;
    const ccx = Math.floor(camX / CHUNK), ccy = Math.floor(camY / CHUNK);

    const missing: Array<[number, number]> = [];
    for (let cy = ccy - r; cy <= ccy + r; cy++) for (let cx = ccx - r; cx <= ccx + r; cx++) {
      if (!this.chunks.has(`${cx},${cy}`)) missing.push([cx, cy]);
    }
    missing.sort((a, b) => Math.hypot(a[0] - ccx, a[1] - ccy) - Math.hypot(b[0] - ccx, b[1] - ccy));
    for (const [cx, cy] of missing.slice(0, MAX_BUILDS_PER_FRAME)) {
      const c = this.build(cx, cy);
      this.group.add(c.group);
      this.chunks.set(`${cx},${cy}`, c);
    }

    for (const [key, c] of this.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - ccx) > r + 2 || Math.abs(cy - ccy) > r + 2) {
        this.group.remove(c.group);
        c.ground.dispose();
        c.trees?.dispose();
        this.chunks.delete(key);
      }
    }
  }

  private build(cx: number, cy: number): Chunk {
    const seed = this.tiles.seed;
    const tiles = this.tiles.chunk(cx, cy);
    const ox = cx * CHUNK, oy = cy * CHUNK;

    // Corner heights, (CHUNK+1)^2. Neighbouring chunks sample the same corners, so seams match.
    const N = CHUNK + 1;
    const hc = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      hc[y * N + x] = heightFromElevation(elevationAt(seed, ox + x, oy + y));
    }

    // Non-indexed: each tile gets its own two triangles and colour, for a faceted, tiled look.
    const pos = new Float32Array(CHUNK * CHUNK * 6 * 3);
    const col = new Float32Array(CHUNK * CHUNK * 6 * 3);
    const c = new Color();
    const treeSpots: Array<[number, number, number, number]> = [];
    let p = 0;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const t = tiles[ty * CHUNK + tx] as Tile;
        const wx = ox + tx, wy = oy + ty;
        const shade = 0.92 + rand2(seed, wx, wy) * 0.12;
        const [r, g, b] = BASE[t];
        c.setRGB((r / 255) * shade, (g / 255) * shade, (b / 255) * shade).convertSRGBToLinear();

        const h00 = hc[ty * N + tx], h10 = hc[ty * N + tx + 1], h01 = hc[(ty + 1) * N + tx], h11 = hc[(ty + 1) * N + tx + 1];
        // Counter-clockwise seen from above (+y), so faces point up.
        const verts: Array<[number, number, number]> = [
          [tx, h00, ty], [tx, h01, ty + 1], [tx + 1, h10, ty],
          [tx + 1, h10, ty], [tx, h01, ty + 1], [tx + 1, h11, ty + 1],
        ];
        for (const v of verts) {
          pos[p] = v[0]; pos[p + 1] = v[1]; pos[p + 2] = v[2];
          col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b;
          p += 3;
        }

        if (t === Tile.Forest) {
          const jr = rand2(seed ^ 0x51ed, wx, wy);
          const jx = 0.3 + 0.4 * jr, jy = 0.3 + 0.4 * rand2(seed ^ 0x2b1d, wx, wy);
          const gh = h00 + (h10 - h00) * jx + (h01 - h00) * jy;
          treeSpots.push([tx + jx, gh, ty + jy, 0.75 + jr * 0.6]);
        }
      }
    }

    const ground = new BufferGeometry();
    ground.setAttribute('position', new BufferAttribute(pos, 3));
    ground.setAttribute('color', new BufferAttribute(col, 3));
    ground.computeVertexNormals();

    const group = new Group();
    group.position.set(ox, 0, oy);
    group.add(new Mesh(ground, groundMat));
    group.add(new Mesh(waterGeo, waterMat));

    let trees: InstancedMesh | null = null;
    if (treeSpots.length) {
      trees = new InstancedMesh(treeGeo, treeMat, treeSpots.length);
      const m = new Matrix4(), q = new Quaternion(), v = new Vector3(), s = new Vector3();
      treeSpots.forEach(([x, y, z, k], i) => {
        trees!.setMatrixAt(i, m.compose(v.set(x, y, z), q, s.set(k, k, k)));
      });
      group.add(trees);
    }
    return { group, ground, trees };
  }
}
