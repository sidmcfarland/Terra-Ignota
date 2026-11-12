import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHUNK, PLAYER_SPEED, TILE_COUNT, Tile, WADE_FACTOR, ZONE_MARGIN, ZONE_TILES, elevationAt, findSpawn, generateChunk,
  isWading, isWalkable, nextZone, step, terrainHash, tileAt, worldSeed, zoneName, zoneOf, zonesNear,
} from './index.ts';

/** terrainHash(worldSeed('golden')). Also in tests/e2e/multiplayer.spec.ts, which checks browsers get it too. */
const GOLDEN_HASH = 4034505386;

describe('worldgen', () => {
  const seed = worldSeed('test');

  it('is deterministic', () => {
    expect(generateChunk(seed, 3, -2)).toEqual(generateChunk(seed, 3, -2));
    expect(worldSeed('a')).not.toBe(worldSeed('b'));
  });

  it('chunks agree with tileAt, tile for tile', () => {
    for (const [cx, cy] of [[-1, 2], [0, 0], [7, -9], [-40, 33]]) {
      const c = generateChunk(seed, cx, cy);
      let differ = 0;
      for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
        if (c[y * CHUNK + x] !== tileAt(seed, cx * CHUNK + x, cy * CHUNK + y)) differ++;
      }
      expect(differ).toBe(0);
    }
  });

  it('gives the same answer whatever was asked before', () => {
    // The generator caches its slow maps. Asking in another order, or after the cache was dropped
    // (another seed drops it), must not change a single bit.
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 300; i++) points.push([((i * 7919) % 5000) - 2500 + (i % 3) / 2, ((i * 104729) % 5000) - 2500]);
    const first = points.map(([x, y]) => elevationAt(seed, x, y));
    const chunk = generateChunk(seed, 3, -2);
    elevationAt(worldSeed('another'), 0, 0);
    expect(generateChunk(seed, 3, -2)).toEqual(chunk);
    const again = [...points].reverse().map(([x, y]) => elevationAt(seed, x, y)).reverse();
    expect(again).toEqual(first);
  });

  it('hashes to the recorded value', () => {
    // The world every device must compute. If this changes, the generator changed: every existing
    // world changes with it, PROTOCOL_VERSION must be bumped, and the same number goes in tests/e2e.
    expect(terrainHash(worldSeed('golden'))).toBe(GOLDEN_HASH);
  });

  it('uses only arithmetic that is exact on every engine', () => {
    const exact = ['floor', 'abs', 'sqrt', 'imul', 'min', 'max', 'round'];
    for (const file of ['noise.ts', 'terrain.ts', 'worldgen.ts', 'rng.ts', 'movement.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      for (const m of src.matchAll(/Math\.(\w+)/g)) expect(exact, 'Math.' + m[1] + ' in ' + file).toContain(m[1]);
    }
  });

  it('shows plains, ranges, cliffs, an ocean, separate lakes and several climates near the start', () => {
    const s = findSpawn(seed);
    const seen = new Set<number>();
    for (let y = -3000; y < 3000; y += 32) {
      for (let x = -3000; x < 3000; x += 32) seen.add(tileAt(seed, Math.floor(s.x) + x, Math.floor(s.y) + y));
    }
    for (const t of [
      Tile.DeepWater, Tile.Water, Tile.Sand, Tile.Grass, Tile.Forest, Tile.Meadow, Tile.Rock, Tile.Snow,
      Tile.Lake, Tile.LakeShallows, Tile.Cliff, Tile.Desert, Tile.Tundra, Tile.Marsh, Tile.Conifer,
    ]) expect(seen, 'tile ' + t).toContain(t);
    // Nothing generates these: rivers and streams come with step 2; paths and walls are player-made.
    for (const t of [Tile.Stream, Tile.River, Tile.Path, Tile.Wall]) expect(seen).not.toContain(t);
  }, 60_000);

  it('keeps lakes apart from the sea', () => {
    // Lake water never touches sea water: the continent map decides which is which.
    const sea = (t: number) => t === Tile.DeepWater || t === Tile.Water;
    const lake = (t: number) => t === Tile.Lake || t === Tile.LakeShallows;
    let lakes = 0, touching = 0;
    for (const [cx0, cy0] of [[-8, -8], [40, -60]]) {
      const C = 16, W = C * CHUNK;
      const grid = new Uint8Array(W * W);
      for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
        const c = generateChunk(seed, cx0 + cx, cy0 + cy);
        for (let y = 0; y < CHUNK; y++) grid.set(c.subarray(y * CHUNK, (y + 1) * CHUNK), (cy * CHUNK + y) * W + cx * CHUNK);
      }
      for (let y = 0; y < W - 1; y++) for (let x = 0; x < W - 1; x++) {
        const t = grid[y * W + x], e = grid[y * W + x + 1], so = grid[(y + 1) * W + x];
        if (lake(t)) lakes++;
        if ((lake(t) && (sea(e) || sea(so))) || (sea(t) && (lake(e) || lake(so)))) touching++;
      }
    }
    expect(lakes).toBeGreaterThan(0);
    expect(touching).toBe(0);
  }, 60_000);

  it('produces varied terrain', () => {
    const seen = new Set<number>();
    for (let x = -2000; x < 2000; x += 37) for (let y = -2000; y < 2000; y += 41) seen.add(tileAt(seed, x, y));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('spawns on open, dry, walkable land', () => {
    for (const world of ['test', 'terra', 'vista', 'a', 'b', 'c']) {
      const sd = worldSeed(world), s = findSpawn(sd);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const t = tileAt(sd, Math.floor(s.x) + dx, Math.floor(s.y) + dy);
        expect(isWalkable(t) && !isWading(t), world + ' ' + dx + ',' + dy).toBe(true);
      }
    }
  });
});

describe('zones', () => {
  it('maps tiles to zones incl. negatives', () => {
    expect(zoneOf(0, 0)).toBe('0,0');
    expect(zoneOf(ZONE_TILES, -0.1)).toBe('1,-1');
  });

  it('stays in the current zone within the margin past a border', () => {
    expect(nextZone('0,0', ZONE_TILES + 1, 10)).toBe('0,0');
    expect(nextZone('0,0', ZONE_TILES + ZONE_MARGIN - 0.1, 10)).toBe('0,0');
    expect(nextZone('0,0', -ZONE_MARGIN, 10)).toBe('0,0');
  });

  it('switches once past the margin, and switching back needs the margin too', () => {
    expect(nextZone('0,0', ZONE_TILES + ZONE_MARGIN, 10)).toBe('1,0');
    expect(nextZone('1,0', ZONE_TILES - 1, 10)).toBe('1,0');
    expect(nextZone('1,0', ZONE_TILES - ZONE_MARGIN - 0.1, 10)).toBe('0,0');
    expect(nextZone('0,0', -ZONE_MARGIN - 0.1, 10)).toBe('-1,0');
  });

  it('applies the margin per axis near corners', () => {
    // Far past the east border but only just past the south one: only x switches.
    expect(nextZone('0,0', ZONE_TILES + ZONE_MARGIN + 5, ZONE_TILES + 3)).toBe('1,0');
    expect(nextZone('0,0', ZONE_TILES + ZONE_MARGIN + 5, ZONE_TILES + ZONE_MARGIN + 5)).toBe('1,1');
  });

  it('jumps straight to the right zone after a teleport', () => {
    expect(nextZone('0,0', 10 * ZONE_TILES + 5, -3 * ZONE_TILES)).toBe('10,-3');
  });

  it('names zones deterministically per world', () => {
    const s = worldSeed('test');
    expect(zoneName(s, '3,-2')).toBe(zoneName(s, '3,-2'));
    expect(zoneName(s, '3,-2')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    const names = new Set<string>();
    for (let x = -5; x < 5; x++) for (let y = -5; y < 5; y++) names.add(zoneName(s, `${x},${y}`));
    expect(names.size).toBeGreaterThan(80);
  });

  it('lists the zones whose border band contains a point', () => {
    const mid = ZONE_TILES / 2;
    expect(zonesNear(mid, mid)).toEqual(['0,0']);
    expect(zonesNear(ZONE_TILES - 3, mid).sort()).toEqual(['0,0', '1,0']);
    expect(zonesNear(ZONE_TILES + 3, ZONE_TILES + 3).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    // Consistent with nextZone: a player in any listed zone stays in it.
    for (const z of zonesNear(ZONE_TILES + 3, ZONE_TILES - 3)) expect(nextZone(z, ZONE_TILES + 3, ZONE_TILES - 3)).toBe(z);
  });
});

describe('movement', () => {
  it('moves on open ground and is blocked by walls', () => {
    const open = () => Tile.Grass;
    expect(step(open, { x: 0, y: 0 }, { x: 1, y: 0 }, 1).x).toBeCloseTo(6);
    const wall = (x: number) => (x >= 2 ? Tile.DeepWater : Tile.Grass);
    const p = step(wall, { x: 1.5, y: 0.5 }, { x: 1, y: 0 }, 1);
    expect(p.x).toBe(1.5);
  });

  it('blocks at cliffs, rivers and deep lakes; wades streams and lake shallows', () => {
    for (const t of [Tile.DeepWater, Tile.Lake, Tile.River, Tile.Cliff, Tile.Snow, Tile.Wall]) {
      expect(isWalkable(t)).toBe(false);
      const edge = (x: number) => (x >= 2 ? t : Tile.Grass);
      expect(step(edge, { x: 1.5, y: 0.5 }, { x: 1, y: 0 }, 1).x).toBe(1.5);
    }
    for (const t of [Tile.Water, Tile.LakeShallows, Tile.Stream]) {
      expect(isWalkable(t)).toBe(true);
      expect(isWading(t)).toBe(true);
      expect(step(() => t, { x: 0, y: 0 }, { x: 1, y: 0 }, 1).x).toBeCloseTo(PLAYER_SPEED * WADE_FACTOR);
    }
    for (const t of [Tile.Desert, Tile.Tundra, Tile.Marsh, Tile.Conifer]) {
      expect(isWalkable(t)).toBe(true);
      expect(isWading(t)).toBe(false);
    }
    // Tile ids run 0..TILE_COUNT-1 with no gaps: the colour tables and the wire rely on it.
    expect(Object.values(Tile).sort((a, b) => a - b)).toEqual(Array.from({ length: TILE_COUNT }, (_, i) => i));
  });

  it('normalizes diagonal speed', () => {
    const p = step(() => Tile.Grass, { x: 0, y: 0 }, { x: 1, y: 1 }, 1);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(6, 0);
  });
});
