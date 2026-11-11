import { describe, expect, it } from 'vitest';
import {
  CHUNK, Tile, TileCache, TileEdits, chunkKeyOf, generateIdentityKeys, identityFromKeys, isWellFormed,
  signOp, step, tileAt, verifyOp, worldSeed, type TileOp,
} from './index.ts';

const WORLD = 'test';
const newId = async () => identityFromKeys(await generateIdentityKeys());

describe('signed tile ops', () => {
  it('verifies a genuine op and rejects tampering, other worlds and other authors', async () => {
    const id = await newId();
    const op = await signOp(WORLD, id, { x: 3, y: -4, tile: Tile.Path, clock: 1 });
    expect(isWellFormed(op)).toBe(true);
    expect(await verifyOp(WORLD, op)).toBe(true);
    expect(await verifyOp(WORLD, { ...op, tile: Tile.Wall })).toBe(false);
    expect(await verifyOp(WORLD, { ...op, x: 4 })).toBe(false);
    expect(await verifyOp('elsewhere', op)).toBe(false);
    expect(await verifyOp(WORLD, { ...op, author: (await newId()).pub })).toBe(false);
    expect(await verifyOp(WORLD, { ...op, author: 'not-a-key' })).toBe(false);
  });

  it('rejects malformed ops', () => {
    const ok = { x: 1, y: 2, tile: Tile.Path, clock: 1, author: 'a', sig: 's' };
    expect(isWellFormed(ok)).toBe(true);
    expect(isWellFormed({ ...ok, tile: Tile.Snow })).toBe(false); // Not paintable.
    expect(isWellFormed({ ...ok, tile: null })).toBe(true);
    expect(isWellFormed({ ...ok, x: 1.5 })).toBe(false);
    expect(isWellFormed({ ...ok, clock: 0 })).toBe(false);
    expect(isWellFormed(null)).toBe(false);
  });
});

describe('tile edit CRDT', () => {
  const op = (x: number, y: number, tile: TileOp['tile'], clock: number, author: string): TileOp =>
    ({ x, y, tile, clock, author, sig: `${author}${clock}` });

  it('converges whatever order ops arrive in', () => {
    const ops = [
      op(1, 1, Tile.Path, 1, 'a'), op(1, 1, Tile.Wall, 2, 'b'), op(1, 1, null, 2, 'a'),
      op(-40, 7, Tile.Path, 5, 'c'), op(1, 1, Tile.Path, 1, 'z'),
    ];
    const orders = [ops, [...ops].reverse(), [ops[2], ops[4], ops[0], ops[3], ops[1]]];
    const results = orders.map((list) => {
      const e = new TileEdits();
      for (const o of list) e.merge(o);
      return [e.get(1, 1), e.get(-40, 7), e.size, e.digest(chunkKeyOf(1, 1))];
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0][0]).toEqual(op(1, 1, Tile.Wall, 2, 'b')); // Clock 2, and 'b' > 'a'.
  });

  it('reports whether a merge changed anything, and tracks the clock', () => {
    const e = new TileEdits();
    expect(e.merge(op(0, 0, Tile.Path, 3, 'a'))).toBe(true);
    expect(e.merge(op(0, 0, Tile.Path, 3, 'a'))).toBe(false); // Duplicate.
    expect(e.merge(op(0, 0, Tile.Wall, 1, 'z'))).toBe(false); // Older.
    expect(e.nextClock()).toBe(4);
  });

  it('digests differ when chunk contents differ', () => {
    const a = new TileEdits(), b = new TileEdits();
    a.merge(op(2, 2, Tile.Path, 1, 'a'));
    b.merge(op(2, 2, Tile.Path, 1, 'a'));
    expect(a.digest('0,0')).toBe(b.digest('0,0'));
    b.merge(op(3, 2, Tile.Wall, 2, 'a'));
    expect(a.digest('0,0')).not.toBe(b.digest('0,0'));
    expect(a.digest('9,9')).toBe('');
  });
});

describe('edited terrain', () => {
  it('overrides generated tiles in lookups and chunks, and reverts with null', () => {
    const seed = worldSeed(WORLD);
    const e = new TileEdits();
    const tiles = new TileCache(seed, 64, e);
    const changed: string[] = [];
    tiles.onChunkChange((cx, cy) => changed.push(`${cx},${cy}`));
    const x = CHUNK + 5, y = -3;

    e.merge({ x, y, tile: Tile.Wall, clock: 1, author: 'a', sig: 's1' });
    expect(tiles.get(x, y)).toBe(Tile.Wall);
    expect(tiles.chunk(1, -1)[(y + CHUNK) * CHUNK + 5]).toBe(Tile.Wall);
    expect(tiles.base(1, -1)[(y + CHUNK) * CHUNK + 5]).toBe(tileAt(seed, x, y));
    expect(changed).toEqual(['1,-1']);

    e.merge({ x, y, tile: null, clock: 2, author: 'a', sig: 's2' });
    expect(tiles.get(x, y)).toBe(tileAt(seed, x, y));
    expect(tiles.chunk(1, -1)[(y + CHUNK) * CHUNK + 5]).toBe(tileAt(seed, x, y));
  });

  it('blocks movement into a painted wall', () => {
    const e = new TileEdits();
    const grass = new TileCache(0, 64, e);
    const open = (x: number, y: number) => (e.get(x, y)?.tile ?? Tile.Grass) as Tile;
    expect(step(open, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }, 0.3).x).toBeGreaterThan(1.5);
    e.merge({ x: 1, y: 0, tile: Tile.Wall, clock: 1, author: 'a', sig: 's' });
    expect(step(open, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }, 0.3).x).toBeLessThan(1);
    expect(grass.get(1, 0)).toBe(Tile.Wall);
  });
});
