import { describe, expect, it } from 'vitest';
import {
  CHUNK, Tile, ZONE_MARGIN, ZONE_TILES, findSpawn, generateChunk, isWalkable, nextZone, step, tileAt, worldSeed,
  zoneOf,
} from './index.ts';

describe('worldgen', () => {
  const seed = worldSeed('test');

  it('is deterministic', () => {
    expect(generateChunk(seed, 3, -2)).toEqual(generateChunk(seed, 3, -2));
    expect(worldSeed('a')).not.toBe(worldSeed('b'));
  });

  it('chunks agree with tileAt', () => {
    const c = generateChunk(seed, -1, 2);
    expect(c[5 * CHUNK + 7]).toBe(tileAt(seed, -CHUNK + 7, 2 * CHUNK + 5));
  });

  it('produces varied terrain', () => {
    const seen = new Set<number>();
    for (let x = -2000; x < 2000; x += 37) for (let y = -2000; y < 2000; y += 41) seen.add(tileAt(seed, x, y));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('spawns on walkable land', () => {
    const s = findSpawn(seed);
    expect(isWalkable(tileAt(seed, Math.floor(s.x), Math.floor(s.y)))).toBe(true);
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
});

describe('movement', () => {
  it('moves on open ground and is blocked by walls', () => {
    const open = () => Tile.Grass;
    expect(step(open, { x: 0, y: 0 }, { x: 1, y: 0 }, 1).x).toBeCloseTo(6);
    const wall = (x: number) => (x >= 2 ? Tile.DeepWater : Tile.Grass);
    const p = step(wall, { x: 1.5, y: 0.5 }, { x: 1, y: 0 }, 1);
    expect(p.x).toBe(1.5);
  });

  it('normalizes diagonal speed', () => {
    const p = step(() => Tile.Grass, { x: 0, y: 0 }, { x: 1, y: 1 }, 1);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(6, 0);
  });
});
