import { describe, expect, it } from 'vitest';
import {
  CHUNK, Channel, NODE, REGION_EDGE, REGION_HALO, REGION_NODES, REGION_TILES, Tile, computeRegion, elevationAt, generateChunk,
  getRegion, regionOf, tileAt, worldSeed, type Region,
} from './index.ts';

const E = REGION_EDGE;
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
const isLake = (r: Region, k: number) => r.lake[k] === r.lake[k];
const isSea = (r: Region, k: number) => r.flow[k] < 0 && r.kind[k] === Channel.None && r.level[k] < 0;
/** The node a node drains to, or -1 if it has none or it lies outside the arrays. */
function downstream(r: Region, k: number): number {
  const d = r.flow[k];
  if (d < 0) return -1;
  const i = (k % E) + DX[d], j = Math.floor(k / E) + DY[d];
  return i < 0 || j < 0 || i >= E || j >= E ? -1 : j * E + i;
}
/** Every field of a node, as something toEqual can compare (NaN equals NaN there). */
const node = (r: Region, k: number) => [r.level[k], r.lake[k], r.flow[k], r.kind[k], r.rain[k]];

describe('drainage regions', () => {
  const worlds = ['test', 'terra', 'vista'];

  it('compute the same nodes whatever window they are computed in', () => {
    // A wider window must not change one bit of what a region keeps: that is what makes the rules local.
    for (const [world, rx, ry] of [['test', 0, 0], ['vista', -1, 2]] as const) {
      const seed = worldSeed(world);
      const a = computeRegion(seed, rx, ry), b = computeRegion(seed, rx, ry, 7);
      for (const key of ['level', 'lake', 'flow', 'kind', 'rain'] as const) expect(b[key], key).toEqual(a[key]);
    }
  }, 60_000);

  it('agree with their neighbours where they overlap', () => {
    for (const world of ['test', 'terra']) {
      const seed = worldSeed(world);
      const a = getRegion(seed, 0, 0);
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
        const b = getRegion(seed, dx, dy);
        let compared = 0;
        for (let j = 0; j < E; j++) for (let i = 0; i < E; i++) {
          // The same node in b's arrays.
          const bi = a.x0 + i - b.x0, bj = a.y0 + j - b.y0;
          if (bi < 0 || bj < 0 || bi >= E || bj >= E) continue;
          expect(node(b, bj * E + bi), `${world} node ${a.x0 + i},${a.y0 + j}`).toEqual(node(a, j * E + i));
          compared++;
        }
        expect(compared).toBeGreaterThan(E);
      }
    }
  }, 60_000);

  it('never send water uphill, and never lose a channel on its way down', () => {
    for (const world of worlds) {
      const r = getRegion(worldSeed(world), 0, 0);
      let channels = 0, rivers = 0;
      for (let k = 0; k < E * E; k++) {
        const m = downstream(r, k);
        if (m < 0) continue;
        // Level across a filled hollow (a lake, or one too shallow to show as one); downhill everywhere else.
        expect(r.level[m], `${world} node ${k}`).toBeLessThanOrEqual(r.level[k]);
        if (!r.kind[k]) continue;
        channels++;
        if (r.kind[k] === Channel.River) rivers++;
        // What a channel flows into is the sea or at least as much of a channel.
        if (!isSea(r, m)) expect(r.kind[m], `${world} node ${k} -> ${m}`).toBeGreaterThanOrEqual(r.kind[k]);
      }
      expect(channels).toBeGreaterThan(50);
      expect(rivers).toBeGreaterThan(10);
    }
  }, 60_000);

  it('lead every channel down to the sea or a lake', () => {
    for (const world of worlds) {
      const seed = worldSeed(world);
      let sea = 0, lake = 0;
      const r0 = getRegion(seed, 0, 0);
      for (let k0 = 0; k0 < E * E; k0++) {
        const i0 = k0 % E, j0 = Math.floor(k0 / E);
        // Start from this region's own channel nodes; follow them into neighbouring regions if need be.
        if (!r0.kind[k0] || i0 < REGION_HALO || j0 < REGION_HALO || i0 >= E - REGION_HALO || j0 >= E - REGION_HALO) continue;
        let gx = r0.x0 + i0, gy = r0.y0 + j0, last = Infinity;
        for (let steps = 0; ; steps++) {
          expect(steps).toBeLessThan(2000);
          const r = getRegion(seed, regionOf(gx * NODE), regionOf(gy * NODE));
          const k = (gy - r.y0) * E + gx - r.x0;
          expect(r.level[k]).toBeLessThanOrEqual(last);
          last = r.level[k];
          const d = r.flow[k];
          if (d < 0) {
            // The end: the sea, or water with no way out, which is always a lake or pond.
            if (isSea(r, k)) sea++;
            else {
              expect(isLake(r, k), `${world} channel from ${r0.x0 + i0},${r0.y0 + j0} ends dry at ${gx},${gy}`).toBe(true);
              lake++;
            }
            break;
          }
          gx += DX[d];
          gy += DY[d];
        }
      }
      expect(sea).toBeGreaterThan(0);
      expect(sea + lake).toBeGreaterThan(50);
    }
  }, 120_000);
});

describe('rivers in the tiles', () => {
  const wet = (t: number) =>
    t === Tile.River || t === Tile.Stream || t === Tile.Lake || t === Tile.LakeShallows || t === Tile.Water || t === Tile.DeepWater;

  /** Chunks around the channel nodes of a region, a few of them, spread out. */
  function riverChunks(seed: number, count: number): Array<[number, number]> {
    const r = getRegion(seed, 0, 0), out: Array<[number, number]> = [];
    let seenChannels = 0;
    for (let k = 0; k < E * E && out.length < count; k++) {
      const i = k % E, j = Math.floor(k / E);
      if (i < 8 || j < 8 || i >= E - 9 || j >= E - 9 || !r.kind[k] || r.flow[k] < 0 || isLake(r, k)) continue;
      if (seenChannels++ % 29 === 0) out.push([((r.x0 + i) * NODE) / CHUNK, ((r.y0 + j) * NODE) / CHUNK]);
    }
    return out;
  }

  it('are the same in chunks as tile by tile', () => {
    const seed = worldSeed('test');
    let channel = 0;
    for (const [cx, cy] of riverChunks(seed, 4)) {
      const c = generateChunk(seed, cx, cy);
      for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
        const t = c[y * CHUNK + x];
        if (t === Tile.River || t === Tile.Stream) channel++;
        if (t !== tileAt(seed, cx * CHUNK + x, cy * CHUNK + y)) throw new Error(`chunk ${cx},${cy} differs at ${x},${y}`);
      }
    }
    expect(channel).toBeGreaterThan(20);
  });

  it('run unbroken, and downhill, until they reach standing water', () => {
    for (const world of ['test', 'vista']) {
      const seed = worldSeed(world);
      let checked = 0;
      for (const [cx, cy] of riverChunks(seed, 6)) {
        // The chunk and a ring of chunks around it.
        const W = 3 * CHUNK, x0 = (cx - 1) * CHUNK, y0 = (cy - 1) * CHUNK;
        const grid = new Uint8Array(W * W);
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
          const c = generateChunk(seed, cx - 1 + i, cy - 1 + j);
          for (let y = 0; y < CHUNK; y++) grid.set(c.subarray(y * CHUNK, (y + 1) * CHUNK), (j * CHUNK + y) * W + i * CHUNK);
        }
        const height = (x: number, y: number) => elevationAt(seed, x0 + x + 0.5, y0 + y + 0.5);
        for (let y = CHUNK; y < 2 * CHUNK; y++) for (let x = CHUNK; x < 2 * CHUNK; x++) {
          const t = grid[y * W + x];
          if (t !== Tile.River && t !== Tile.Stream) continue;
          // Every channel tile has a wet neighbour that is no higher: the way on.
          const here = height(x, y);
          let onward = false;
          for (let d = 0; d < 8 && !onward; d++) {
            const nx = x + DX[d], ny = y + DY[d], n = grid[ny * W + nx];
            if (n === Tile.Marsh || (wet(n) && (n !== Tile.River && n !== Tile.Stream || height(nx, ny) <= here))) onward = true;
          }
          if (!onward) throw new Error(`${world}: channel tile ${x0 + x},${y0 + y} has no way on`);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(50);
    }
  }, 60_000);

  it('put regions around the origin, 3,072 tiles across', () => {
    expect(REGION_TILES).toBe(REGION_NODES * NODE);
    expect(REGION_TILES).toBe(3072);
    expect(regionOf(0)).toBe(0);
    expect(regionOf(REGION_TILES / 2 - 1)).toBe(0);
    expect(regionOf(REGION_TILES / 2)).toBe(1);
    expect(regionOf(-REGION_TILES / 2 - 1)).toBe(-1);
  });
});
