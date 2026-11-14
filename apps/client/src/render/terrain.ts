import { BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Mesh, Sphere, Vector3 } from 'three';
import { CHUNK, type Region, type TileCache } from '@terra/shared';
import { ChunkBuilder, HeightField, N, type ChunkData } from './chunk-data.ts';
import { LIFT_UNIT, type MeshData } from './cover.ts';
import { TREES } from './flora.ts';
import { BAKE_EAST, BAKE_WEST, foliageMaterial, groundMaterial, waterMaterial } from './look.ts';

export { WATER_Y, heightFromElevation } from './chunk-data.ts';

/**
 * Chunks are asked for this far (tiles) beyond what the view shows, so one is ready before it is seen:
 * a worker's answer comes a frame or more after the question.
 */
const LEAD = 8;
/** Chunk builds the worker has been asked for and not answered yet. Two, so it has the next one waiting when it finishes one. */
const IN_FLIGHT = 2;
/** Finished chunks turned into meshes in one frame: each is uploaded to the GPU the first time it is drawn. */
const INSTALLS_PER_FRAME = 3;
/** Without a worker, chunk building stops for the frame once it has used this much time (it always builds at least one). */
const BUILD_BUDGET_MS = 4;

const groundMat = groundMaterial();
const waterMat = waterMaterial();
// Broadleaves follow the seasons; pines keep their needles.
const leafMat = foliageMaterial(LIFT_UNIT, false, true);
const pineMat = foliageMaterial(LIFT_UNIT);
// Blades are single triangles seen from both sides.
const coverMat = foliageMaterial(LIFT_UNIT, true);

/** Hands over drainage regions as they are computed (RegionLoader), so the chunk worker need not compute them again. */
export interface RegionSource {
  onRegion(fn: (r: Region) => void): void;
}

/** What the chunk worker is asked (see terrain-worker.ts). */
export interface ChunkAsk {
  kind: 'chunk';
  seed: number;
  cx: number;
  cy: number;
  /** How many edits the chunk had seen when it was asked for. */
  version: number;
  /** The chunk's tiles with edits applied, or null if it has none. */
  tiles: Uint8Array | null;
  east: readonly [number, number];
  west: readonly [number, number];
}
/** What it answers: the chunk's data, which question it answers, and how long the build took (ms). */
export type ChunkAnswer = ChunkData & { version: number; ms: number };

interface Chunk {
  cx: number;
  cy: number;
  /** How many edits to the chunk this mesh shows. */
  version: number;
  group: Group;
  ground: BufferGeometry;
  water: BufferGeometry | null;
  cover: BufferGeometry | null;
  /** The mesh that draws `cover`, so it can be left out when the view is too far out to show it. */
  coverMesh: Mesh | null;
  trees: InstancedMesh[];
  /** Baked shade at the chunk's tile corners (N by N, three bytes each), for shading what stands on it. */
  shade: Uint8Array;
}

const keyOf = (cx: number, cy: number) => `${cx},${cy}`;

/** A mesh's geometry from its data: the ground's, or the ground cover's. */
function geometry(d: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(d.position, 3));
  g.setAttribute('normal', new BufferAttribute(d.normal, 3, true));
  g.setAttribute('aColor', new BufferAttribute(d.color, 4, true));
  g.setAttribute('aShade', new BufferAttribute(d.shade, 4, true));
  g.boundingSphere = sphere(d.sphere);
  return g;
}
const sphere = (s: Float32Array) => new Sphere(new Vector3(s[0], s[1], s[2]), s[3]);

/**
 * Streams heightmap chunk meshes around the camera. World x → three x, world y → three z.
 *
 * A chunk's mesh is worked out in a worker (chunk-data.ts, run by terrain-worker.ts) and arrives as
 * typed arrays; here they only become geometries, so a frame never waits for a build. Where a worker
 * cannot be started the same builder runs here, a few milliseconds a frame.
 */
export class Terrain {
  readonly group = new Group();
  /** Milliseconds the most recent chunk build took (on the worker, when there is one), the slowest so far, and how many. */
  readonly buildMs = { last: 0, max: 0, count: 0 };
  /** Chunks the view shows that are not drawn yet, as of the last update. */
  missing = 0;
  private chunks = new Map<string, Chunk>();
  private readonly tiles: TileCache;
  private readonly heights: HeightField;
  private readonly regions: RegionSource | null;
  private showCover = true;
  /** How many edits each edited chunk has seen. A mesh built from fewer is out of date. */
  private versions = new Map<string, number>();
  /** Chunks asked of the worker and not answered: the version asked for. */
  private flying = new Map<string, number>();
  /** Answers not yet turned into meshes. */
  private arrived: ChunkAnswer[] = [];
  /** Chunks to build, most urgent first, as of the last update. */
  private wanted: Array<[number, number]> = [];
  private worker: Worker | null = null;
  private started = false;
  /** Builds chunks here when there is no worker. */
  private builder: ChunkBuilder | null = null;

  /** `useWorker: false` builds every chunk on the main thread (`#chunks=main`), for comparing the two. */
  constructor(tiles: TileCache, regions: RegionSource | null = null, useWorker = true) {
    this.tiles = tiles;
    this.regions = regions;
    this.started = !useWorker;
    this.heights = new HeightField(tiles.seed);
    tiles.onChunkChange((cx, cy) => {
      const key = keyOf(cx, cy);
      this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
      // An edit to a chunk on show is rebuilt at once, ahead of whatever is streaming in. Its old mesh
      // stays until the new one is ready, so the land never blinks.
      if (this.worker && this.chunks.has(key)) this.ask(cx, cy);
    });
  }

  /** Whether chunks are built off the main thread. */
  get offThread(): boolean {
    return this.worker !== null;
  }

  /** Start the worker. Left until the first frame is drawn, so a page that never draws (`#render=0`) has none. */
  private start() {
    this.started = true;
    try {
      const w = new Worker(new URL('../terrain-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<ChunkAnswer>) => {
        const d = e.data, key = keyOf(d.cx, d.cy);
        if (this.flying.get(key) === d.version) this.flying.delete(key);
        this.buildMs.last = d.ms;
        this.buildMs.max = Math.max(this.buildMs.max, d.ms);
        this.buildMs.count++;
        this.arrived.push(d);
        // Keep the worker busy: do not wait for the next frame to ask for the next chunk.
        this.pump();
      };
      // A worker that fails is dropped, and chunks are built here from then on.
      w.onerror = () => {
        if (this.worker !== w) return;
        this.worker = null;
        this.flying.clear();
        w.terminate();
      };
      this.worker = w;
      // Rivers and lakes come from a simulation per region. The regions already computed are handed over,
      // and each new one as it arrives; the worker computes for itself any it was not given in time.
      this.regions?.onRegion((region) => this.worker?.postMessage({ kind: 'hold', region }));
    } catch {
      // No workers here.
    }
  }

  private version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  /** Ask the worker for a chunk as it stands now. */
  private ask(cx: number, cy: number) {
    const key = keyOf(cx, cy), version = this.version(key);
    this.flying.set(key, version);
    const ask: ChunkAsk = {
      kind: 'chunk', seed: this.tiles.seed, cx, cy, version,
      // Only an edited chunk's tiles are sent; the worker generates the rest itself, as this thread would.
      tiles: this.tiles.edited(cx, cy) ? this.tiles.chunk(cx, cy) : null,
      east: BAKE_EAST, west: BAKE_WEST,
    };
    this.worker!.postMessage(ask);
  }

  /** Whether a chunk is shown, on its way, or waiting to be turned into a mesh, at its current version. */
  private settled(key: string): boolean {
    const version = this.version(key);
    if (this.chunks.get(key)?.version === version || this.flying.get(key) === version) return true;
    for (const d of this.arrived) if (d.version === version && keyOf(d.cx, d.cy) === key) return true;
    return false;
  }

  /** Ask the worker for the most urgent chunks it is not already building. */
  private pump() {
    if (!this.worker || this.arrived.length > INSTALLS_PER_FRAME) return;
    for (const [cx, cy] of this.wanted) {
      if (this.flying.size >= IN_FLIGHT) break;
      if (!this.settled(keyOf(cx, cy))) this.ask(cx, cy);
    }
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

  /** Turn a built chunk into meshes and show it in place of whatever was there. */
  private install(d: ChunkData, version: number) {
    const key = keyOf(d.cx, d.cy);
    this.drop(key);
    this.heights.install(d.cx, d.cy, d.bed, d.level);

    const group = new Group();
    group.position.set(d.cx * CHUNK, 0, d.cy * CHUNK);
    const ground = geometry(d.ground);
    group.add(new Mesh(ground, groundMat));

    let water: BufferGeometry | null = null;
    if (d.water) {
      const w = d.water;
      water = new BufferGeometry();
      water.setAttribute('position', new BufferAttribute(w.position, 3));
      water.setAttribute('aDepth', new BufferAttribute(w.depth, 1));
      water.setAttribute('aLake', new BufferAttribute(w.lake, 1));
      water.setAttribute('aFlow', new BufferAttribute(w.flow, 2));
      water.setAttribute('aShade', new BufferAttribute(w.shade, 3, true));
      water.setIndex(new BufferAttribute(w.index, 1));
      water.boundingSphere = sphere(w.sphere);
      group.add(new Mesh(water, waterMat));
    }

    const cover = d.cover ? geometry(d.cover) : null, coverMesh = cover ? new Mesh(cover, coverMat) : null;
    if (coverMesh) {
      coverMesh.visible = this.showCover;
      group.add(coverMesh);
    }

    const trees: InstancedMesh[] = [];
    for (const t of d.trees) {
      const mesh = new InstancedMesh(t.pine ? TREES.conifer : TREES.broadleaf, t.pine ? pineMat : leafMat, t.shades.length / 3);
      mesh.instanceMatrix = new InstancedBufferAttribute(t.matrices, 16);
      mesh.instanceColor = new InstancedBufferAttribute(t.shades, 3);
      mesh.userData.rect = t.rect;
      group.add(mesh);
      trees.push(mesh);
    }

    this.group.add(group);
    this.chunks.set(key, { cx: d.cx, cy: d.cy, version, group, ground, water, cover, coverMesh, trees, shade: d.shade });
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

  /** The water's surface over a spot, or -Infinity where its tile has none: the mean of the tile's wet corners. */
  waterAt(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), hf = this.heights;
    let sum = 0, n = 0;
    for (let k = 0; k < 4; k++) {
      const w = hf.waterCorner(x0 + (k & 1), y0 + (k >> 1));
      if (w === w) { sum += w; n++; }
    }
    return n ? sum / n : -Infinity;
  }

  /** The top of whatever is at a spot: the ground, or the water standing over it. */
  surfaceAt(x: number, y: number): number {
    return Math.max(this.heightAt(x, y), this.waterAt(x, y));
  }

  /**
   * Baked shade of the ground at a spot: ambient occlusion, then how high the land rises toward the
   * morning and the evening sun (each 0-1). Reads as open ground where nothing is built yet.
   */
  shadeAt(x: number, y: number, out: Vector3): Vector3 {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.chunks.get(keyOf(cx, cy));
    if (!c) return out.set(1, 0, 0);
    const i = (Math.round(y - cy * CHUNK) * N + Math.round(x - cx * CHUNK)) * 3;
    return out.set(c.shade[i] / 255, c.shade[i + 1] / 255, c.shade[i + 2] / 255);
  }

  /** `cover` is how much of the ground cover the view is close enough to show, 0 to 1 (see uDetail in look.ts). */
  update(camX: number, camY: number, radius: number, cover = 1) {
    this.showCover = cover > 0.1;
    if (!this.started) this.start();
    const ccx = Math.floor(camX / CHUNK), ccy = Math.floor(camY / CHUNK);
    // How far a chunk lies outside the circle of the given radius (0 or less if it touches it).
    const beyond = (cx: number, cy: number) => {
      const dx = Math.max(cx * CHUNK - camX, 0, camX - (cx + 1) * CHUNK);
      const dy = Math.max(cy * CHUNK - camY, 0, camY - (cy + 1) * CHUNK);
      return Math.hypot(dx, dy) - radius;
    };

    // What the worker has finished since the last frame. An answer nobody wants any more is dropped:
    // the view has moved on, or a newer build of the chunk is already shown.
    for (let n = 0; n < INSTALLS_PER_FRAME && this.arrived.length; ) {
      const d = this.arrived.shift()!, shown = this.chunks.get(keyOf(d.cx, d.cy));
      if (beyond(d.cx, d.cy) > 2 * CHUNK || (shown && shown.version >= d.version)) continue;
      this.install(d, d.version);
      n++;
    }

    // What is still to build: chunks within reach that are not shown, and shown ones an edit has changed.
    const r = Math.ceil((radius + LEAD) / CHUNK) + 1;
    const wanted: Array<[number, number, number]> = [];
    this.missing = 0;
    for (let cy = ccy - r; cy <= ccy + r; cy++) for (let cx = ccx - r; cx <= ccx + r; cx++) {
      const out = beyond(cx, cy);
      if (out > LEAD) continue;
      const key = keyOf(cx, cy), c = this.chunks.get(key);
      if (c && c.version === this.version(key)) continue;
      if (!c && out <= 0) this.missing++;
      // Edited chunks first, then the nearest.
      wanted.push([cx, cy, c ? -1 : Math.hypot(cx - ccx, cy - ccy)]);
    }
    wanted.sort((a, b) => a[2] - b[2]);
    this.wanted = wanted.map(([cx, cy]) => [cx, cy]);

    if (this.worker) this.pump();
    else {
      this.builder ??= new ChunkBuilder(this.tiles.seed, BAKE_EAST, BAKE_WEST);
      const t0 = performance.now();
      for (const [cx, cy] of this.wanted) {
        const key = keyOf(cx, cy), version = this.version(key), t = performance.now();
        const shown = this.chunks.has(key);
        this.install(this.builder.build(cx, cy, this.tiles.edited(cx, cy) ? this.tiles.chunk(cx, cy) : null), version);
        const ms = performance.now() - t;
        this.buildMs.last = ms;
        this.buildMs.max = Math.max(this.buildMs.max, ms);
        this.buildMs.count++;
        if (!shown && beyond(cx, cy) <= 0) this.missing--;
        if (performance.now() - t0 > BUILD_BUDGET_MS) break;
      }
    }

    for (const [key, c] of this.chunks) {
      const out = beyond(c.cx, c.cy);
      if (out > 2 * CHUNK) {
        this.drop(key);
        continue;
      }
      // A chunk that does not touch what the view shows is not drawn: it was built ahead, or is on its way out.
      c.group.visible = out <= 0;
      // Ground cover is not drawn at all once it has sunk away.
      if (c.coverMesh) c.coverMesh.visible = this.showCover;
      // Trees standing wholly beyond the radius are not drawn: nothing out there is inked in.
      for (const mesh of c.trees) {
        const r = mesh.userData.rect as number[];
        const dx = Math.max(r[0] - camX, 0, camX - r[2]), dy = Math.max(r[1] - camY, 0, camY - r[3]);
        mesh.visible = dx * dx + dy * dy <= radius * radius;
      }
    }
  }
}
