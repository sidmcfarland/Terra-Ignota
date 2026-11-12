import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Tile, type TileOp } from '../../../packages/shared/src/index.ts';
import { DiskStore } from './store.ts';

const op = (x: number, tile: TileOp['tile'], clock: number): TileOp =>
  ({ x, y: 0, tile, clock, author: 'a', sig: `s${clock}` });

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

  it('keeps edits across restarts', () => {
    const dir = tmp();
    const a = new DiskStore(dir);
    for (const o of [op(1, Tile.Path, 1), op(2, Tile.Wall, 2), op(1, null, 3)]) {
      if (a.world('w').merge(o)) a.append('w', o);
    }
    const b = new DiskStore(dir); // A restart: fresh process, same directory.
    expect(b.world('w').get(1, 0)).toEqual(op(1, null, 3));
    expect(b.world('w').get(2, 0)?.tile).toBe(Tile.Wall);
    expect(b.stats()).toEqual({ w: 2 });
  });

  it('skips a torn line and malformed entries', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'w.jsonl'), `${JSON.stringify(op(5, Tile.Path, 1))}\n{"x":1,"y":\n${JSON.stringify({ nope: 1 })}\n`);
    expect(new DiskStore(dir).world('w').size).toBe(1);
  });

  it('rewrites a file dominated by superseded lines', () => {
    const dir = tmp();
    const s = new DiskStore(dir);
    for (let c = 1; c <= 300; c++) {
      const o = op(0, c % 2 ? Tile.Path : Tile.Wall, c); // The same tile, over and over.
      if (s.world('w').merge(o)) s.append('w', o);
    }
    new DiskStore(dir).world('w'); // Loading compacts it.
    const lines = readFileSync(join(dir, 'w.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).clock).toBe(300);
  });

  it('refuses world ids that are not safe file names', () => {
    expect(() => new DiskStore(tmp()).world('../etc')).toThrow();
  });
});
