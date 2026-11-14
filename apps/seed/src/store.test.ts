import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LAYERS, Tile, type Layer, type Op, type Value } from '../../../packages/shared/src/index.ts';
import { DiskStore } from './store.ts';

const T0 = 1_800_000_000;
const op = (x: number, tile: Tile | null, clock: number): Op =>
  ({ l: 'tile', x, y: 0, v: tile, clock, at: T0, author: 'a', sig: `s${clock}` });
const other = (l: Layer, x: number, y: number, v: Value, clock: number, at: number, author = 'a'): Op =>
  ({ l, x, y, v, clock, at, author, sig: `${l}${clock}${author}` });
const PURSE = { got: { w: 1, s: 0, p: 0, c: 0, x: 0 }, used: { w: 0, s: 0, p: 0, c: 0, x: 0 } };

describe('seed disk store', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'terra-seed-test-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const put = (s: DiskStore, world: string, o: Op) => {
    if (s.world(world).merge(o)) s.append(world, o);
  };

  it('keeps edits across restarts', () => {
    const dir = tmp();
    const a = new DiskStore(dir, () => T0);
    for (const o of [op(1, Tile.Path, 1), op(2, Tile.Wall, 2), op(1, null, 3)]) put(a, 'w', o);
    const b = new DiskStore(dir, () => T0); // A restart: fresh process, same directory.
    expect(b.world('w').get('tile', 1, 0)).toEqual(op(1, null, 3));
    expect(b.world('w').tile(2, 0)).toBe(Tile.Wall);
    expect(b.stats()).toEqual({ w: 2 });
  });

  it('keeps every layer across restarts: zone, world and player scope', () => {
    const dir = tmp();
    const a = new DiskStore(dir, () => T0);
    const ops = [
      op(1, Tile.Path, 1), other('take', 4, 4, 1, 2, T0), other('chart', 9, -9, 1, 3, T0 - 5, 'b'),
      other('purse', 0, 0, PURSE, 4, T0, 'a'), other('purse', 0, 0, PURSE, 5, T0, 'b'),
    ];
    for (const o of ops) put(a, 'w', o);
    put(a, 'w', other('chart', 9, -9, 1, 9, T0, 'c')); // Later: the first charter keeps the square.
    expect(a.has('w')).toBe(true);
    expect(a.has('nowhere')).toBe(false);

    const b = new DiskStore(dir, () => T0);
    expect(b.has('w')).toBe(true);
    expect(b.layers('w')).toEqual({ tile: 1, take: 1, chart: 1, purse: 2 });
    expect(b.world('w').get('chart', 9, -9)?.author).toBe('b');
    expect(b.world('w').get('purse', 0, 0, 'b')?.clock).toBe(5);
    expect(b.world('w').digest('z:1,-2')).toBe(a.world('w').digest('z:1,-2'));
  });

  it('skips a torn line and malformed entries', () => {
    const dir = tmp();
    const old = { x: 7, y: 0, tile: Tile.Path, clock: 1, author: 'a', sig: 's' }; // An edit from before ops had layers.
    writeFileSync(join(dir, 'w.jsonl'), `${JSON.stringify(op(5, Tile.Path, 1))}\n{"x":1,"y":\n${JSON.stringify({ nope: 1 })}\n${JSON.stringify(old)}\n`);
    expect(new DiskStore(dir, () => T0).world('w').size).toBe(1);
  });

  it('rewrites a file dominated by superseded lines', () => {
    const dir = tmp();
    const s = new DiskStore(dir, () => T0);
    for (let c = 1; c <= 300; c++) put(s, 'w', op(0, c % 2 ? Tile.Path : Tile.Wall, c)); // The same tile, over and over.
    new DiskStore(dir, () => T0).world('w'); // Loading compacts it.
    const lines = readFileSync(join(dir, 'w.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).clock).toBe(300);
  });

  it('drops expired ops, and rewrites a file they dominate, while running and on restart', () => {
    const dir = tmp();
    const time = { now: T0 };
    const s = new DiskStore(dir, () => time.now);
    put(s, 'w', op(1, Tile.Path, 1));
    for (let i = 0; i < 150; i++) put(s, 'w', other('take', i, 5, 1, i + 2, T0 + i)); // Harvests, a second apart.
    const count = () => readFileSync(join(dir, 'w.jsonl'), 'utf8').trim().split('\n').length;
    expect(count()).toBe(151);

    // Two hours on, the first 100 have regrown. The file is not yet mostly dead lines, so it stays.
    time.now = T0 + LAYERS.take.ttl! + 99;
    s.sweep();
    expect(s.layers('w')).toEqual({ tile: 1, take: 50 });
    expect(count()).toBe(151);

    // Once the rest have gone, the file is rewritten with what stands.
    time.now += 1000;
    s.sweep();
    expect(s.layers('w')).toEqual({ tile: 1 });
    expect(count()).toBe(1);

    // A restart finds expired ops in a file and leaves them out.
    const dir2 = tmp();
    const early = new DiskStore(dir2, () => T0);
    for (let i = 0; i < 5; i++) put(early, 'w', other('take', i, 5, 1, i + 1, T0));
    expect(new DiskStore(dir2, () => T0 + 60).layers('w')).toEqual({ take: 5 });
    expect(new DiskStore(dir2, () => T0 + LAYERS.take.ttl!).layers('w')).toEqual({});
  });

  it('refuses world ids that are not safe file names', () => {
    expect(() => new DiskStore(tmp()).world('../etc')).toThrow();
    expect(new DiskStore(tmp()).has('../etc')).toBe(false);
  });
});
