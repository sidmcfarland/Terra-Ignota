import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHUNK, Tile, generateChunk, worldSeed } from '@terra/shared';
import { ChunkBuilder, N, buffersOf, type ChunkData } from './chunk-data.ts';

const SEED = worldSeed('vista');
// The two directions shadows are baked along; any two will do here.
const EAST = [0.94, -0.34] as const, WEST = [-0.94, -0.34] as const;
// A river valley with forest on its sides: ground, water, cover and trees in one chunk.
const CX = 8, CY = -8;

/** Every array of a chunk's data, in a fixed order. */
function arrays(d: ChunkData): ArrayLike<number>[] {
  const out: ArrayLike<number>[] = [d.shade, d.bed, d.level];
  for (const m of [d.ground, d.cover]) if (m) out.push(m.position, m.normal, m.color, m.shade, m.sphere);
  if (d.water) out.push(d.water.position, d.water.depth, d.water.lake, d.water.flow, d.water.shade, d.water.index, d.water.sphere);
  for (const t of d.trees) out.push(t.matrices, t.shades, t.rect, [t.pine ? 1 : 0]);
  return out;
}

const same = (a: ChunkData, b: ChunkData) => {
  const x = arrays(a), y = arrays(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i].length !== y[i].length) return false;
    for (let k = 0; k < x[i].length; k++) if (!Object.is(x[i][k], y[i][k])) return false;
  }
  return true;
};

describe('the chunk builder', () => {
  const first = new ChunkBuilder(SEED, EAST, WEST).build(CX, CY);
  // A second builder that has built something else first. The tests share it: a build is not cheap.
  const other = new ChunkBuilder(SEED, EAST, WEST);
  other.build(CX + 1, CY);

  it('builds ground for every tile, and water, cover and trees where the land has them', () => {
    // Two facets a tile at least (a cliff tile has more), three corners each.
    expect(first.ground.position.length).toBeGreaterThanOrEqual(CHUNK * CHUNK * 2 * 3 * 3);
    expect(first.ground.normal.length).toBe(first.ground.position.length);
    expect(first.ground.color.length).toBe((first.ground.position.length / 3) * 4);
    expect(first.ground.shade.length).toBe((first.ground.position.length / 3) * 4);
    expect(first.ground.position.every(Number.isFinite)).toBe(true);
    expect(first.water).not.toBeNull();
    expect(first.water!.position.length).toBe(N * N * 3);
    expect(Math.max(...first.water!.index)).toBeLessThan(N * N);
    expect(first.cover).not.toBeNull();
    expect(first.cover!.position.length % 9).toBe(0);
    expect(first.trees.length).toBeGreaterThan(0);
    for (const t of first.trees) {
      expect(t.matrices.length).toBe((t.shades.length / 3) * 16);
      expect(t.matrices.every(Number.isFinite)).toBe(true);
    }
    expect(first.shade.length).toBe(N * N * 3);
    expect(first.bed.length).toBe(CHUNK * CHUNK);
    expect(first.level.length).toBe(CHUNK * CHUNK);
  });

  it('bounds each mesh with a sphere that holds all of it', () => {
    for (const m of [first.ground, first.cover!, first.water!]) {
      const [x, y, z, r] = m.sphere;
      let far = 0;
      for (let i = 0; i < m.position.length; i += 3) {
        far = Math.max(far, Math.hypot(m.position[i] - x, m.position[i + 1] - y, m.position[i + 2] - z));
      }
      expect(far).toBeLessThanOrEqual(r + 1e-3);
      expect(far).toBeGreaterThan(r - 1e-3);
    }
  });

  it('builds the same chunk whatever it built before', () => {
    // The builder reuses its scratch space and keeps what it generated: none of that may leak into a build.
    expect(same(other.build(CX, CY), first)).toBe(true);
    expect(same(other.build(CX, CY), first)).toBe(true);
  });

  it('takes an edited chunk as given, and an unedited copy changes nothing', () => {
    const tiles = generateChunk(SEED, CX, CY);
    expect(same(other.build(CX, CY, tiles.slice()), first)).toBe(true);
    const at = tiles.findIndex((t) => t === Tile.Grass || t === Tile.Forest || t === Tile.Conifer || t === Tile.Meadow);
    expect(at).toBeGreaterThanOrEqual(0);
    const edited = tiles.slice();
    edited[at] = Tile.Path;
    const paved = other.build(CX, CY, edited);
    expect(same(paved, first)).toBe(false);
    // Paving moves no ground: the same corners, at the same heights.
    expect(Array.from(paved.ground.position)).toEqual(Array.from(first.ground.position));
    expect(Array.from(paved.bed)).toEqual(Array.from(first.bed));
  });

  it('hands over every buffer, each once', () => {
    const buffers = buffersOf(first);
    expect(new Set(buffers).size).toBe(buffers.length);
    const count = 3 + 5 + (first.cover ? 5 : 0) + (first.water ? 7 : 0) + first.trees.length * 2;
    expect(buffers.length).toBe(count);
  });

  it('uses nothing a worker lacks: no three.js, no DOM', () => {
    for (const file of ['chunk-data.ts', 'cover.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const from of imports) expect(['@terra/shared', './cover.ts']).toContain(from);
      expect(src).not.toMatch(/\b(document|window|navigator|localStorage)\.|\brequestAnimationFrame\b/);
    }
  });
});
