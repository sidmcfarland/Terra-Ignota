import { describe, expect, it } from 'vitest';
import {
  AT_AHEAD_S, CHUNK, LAYERS, OpStore, SYNC_OPS_BURST, Tile, TileCache, ZONE_CHUNKS, asOp, atlasZone, bucketCap, bucketOf,
  encodeValue, generateIdentityKeys, identityFromKeys, inReach, isExpired, isTooNew, isWellFormed, opKey, opPayload, opWins,
  parseClockShift, signOp, step, syncDigests, tileAt, verifyOp, wallClock, worldSeed, zoneChunkBuckets,
  type Layer, type Op, type Value,
} from './index.ts';

const WORLD = 'test';
const newId = async () => identityFromKeys(await generateIdentityKeys());

/** A date to hang tests on, in unix seconds. */
const T0 = 1_800_000_000;
const TAKE_TTL = LAYERS.take.ttl!;

/** An unsigned-in-all-but-name op: the store never checks signatures, and each of these has its own. */
const op = (l: Layer, x: number, y: number, v: Value | null, clock: number, at: number, author = 'a'): Op =>
  ({ l, x, y, v, clock, at, author, sig: `${author}/${clock}/${at}/${encodeValue(v)}` });

/** A store whose clock the test moves. */
function storeAt(t: number) {
  const time = { now: t };
  return { time, store: new OpStore(() => time.now) };
}

/** Every order of a list. */
function orders<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  return list.flatMap((item, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** What a store holds, as something two stores can be compared by. */
const contents = (s: OpStore) => s.ops().map((o) => `${opKey(o)}=${o.sig}`).sort();

const PURSE = { got: { w: 3, s: 0, p: 1, c: 0, x: 0 }, used: { w: 2, s: 0, p: 0, c: 0, x: 0 } };

describe('signed ops', () => {
  it('verifies a genuine op and rejects tampering, other worlds and other authors', async () => {
    const id = await newId();
    const o = await signOp(WORLD, id, { l: 'tile', x: 3, y: -4, v: Tile.Path, clock: 1, at: T0 });
    expect(isWellFormed(o)).toBe(true);
    expect(await verifyOp(WORLD, o)).toBe(true);
    expect(await verifyOp(WORLD, { ...o, v: Tile.Wall })).toBe(false);
    expect(await verifyOp(WORLD, { ...o, v: null })).toBe(false);
    expect(await verifyOp(WORLD, { ...o, x: 4 })).toBe(false);
    expect(await verifyOp(WORLD, { ...o, clock: 2 })).toBe(false);
    expect(await verifyOp(WORLD, { ...o, at: T0 - 1 })).toBe(false); // The date is signed: it can't be moved back.
    expect(await verifyOp(WORLD, { ...o, l: 'take', v: 1 })).toBe(false);
    expect(await verifyOp('elsewhere', o)).toBe(false);
    expect(await verifyOp(WORLD, { ...o, author: (await newId()).pub })).toBe(false);
    expect(await verifyOp(WORLD, { ...o, author: 'not-a-key' })).toBe(false);
  });

  it('signs a record whatever order its keys were written in', async () => {
    const id = await newId();
    const o = await signOp(WORLD, id, { l: 'purse', x: 0, y: 0, v: PURSE, clock: 1, at: T0 });
    const shuffled = { used: { x: 0, c: 0, p: 0, s: 0, w: 2 }, got: { p: 1, x: 0, w: 3, c: 0, s: 0 } };
    expect(encodeValue(shuffled)).toBe(encodeValue(PURSE));
    expect(await verifyOp(WORLD, { ...o, v: shuffled })).toBe(true);
    expect(await verifyOp(WORLD, { ...o, v: { ...PURSE, got: { ...PURSE.got, w: 4 } } })).toBe(false);
  });

  it('signs exactly the text the design gives', () => {
    expect(opPayload('w1', { l: 'tile', x: 3, y: -4, v: Tile.Path, clock: 7, at: T0, author: 'KEY' }))
      .toBe(`ti-op:1|w1|tile|3|-4|${Tile.Path}|7|${T0}|KEY`);
    expect(opPayload('w1', { l: 'tile', x: 0, y: 0, v: null, clock: 1, at: T0, author: 'KEY' })).toBe(`ti-op:1|w1|tile|0|0|null|1|${T0}|KEY`);
    expect(encodeValue({ b: 'x|y', a: { d: 2, c: 1 } })).toBe('{"a":{"c":1,"d":2},"b":"x|y"}');
  });
});

describe('well-formed ops', () => {
  const ok = { l: 'tile', x: 1, y: 2, v: Tile.Path, clock: 1, at: T0, author: 'a', sig: 's' };

  it('checks every field', () => {
    expect(isWellFormed(ok)).toBe(true);
    expect(isWellFormed({ ...ok, v: Tile.Snow })).toBe(false); // Not paintable.
    expect(isWellFormed({ ...ok, v: null })).toBe(true);
    expect(isWellFormed({ ...ok, x: 1.5 })).toBe(false);
    expect(isWellFormed({ ...ok, clock: 0 })).toBe(false);
    expect(isWellFormed({ ...ok, at: undefined })).toBe(false);
    expect(isWellFormed({ ...ok, at: 0 })).toBe(false);
    expect(isWellFormed({ ...ok, author: '' })).toBe(false);
    expect(isWellFormed({ ...ok, author: 'a'.repeat(65) })).toBe(false);
    expect(isWellFormed({ ...ok, l: 'nope' })).toBe(false);
    expect(isWellFormed({ ...ok, l: 'constructor' })).toBe(false);
    expect(isWellFormed(null)).toBe(false);
  });

  it('takes each open layer only with that layer\'s values', () => {
    expect(isWellFormed({ ...ok, l: 'take', v: 1 })).toBe(true);
    expect(isWellFormed({ ...ok, l: 'take', v: 2 })).toBe(false);
    expect(isWellFormed({ ...ok, l: 'take', v: null })).toBe(false); // A harvest can't be undone: it expires.
    expect(isWellFormed({ ...ok, l: 'chart', v: 1 })).toBe(true);
    expect(isWellFormed({ ...ok, l: 'chart', v: null })).toBe(false); // First wins: there is nothing a later op could remove.
    expect(isWellFormed({ ...ok, l: 'purse', x: 0, y: 0, v: PURSE })).toBe(true);
    expect(isWellFormed({ ...ok, l: 'purse', x: 1, y: 0, v: PURSE })).toBe(false); // Keyed by author alone.
    expect(isWellFormed({ ...ok, l: 'purse', x: 0, y: 0, v: { ...PURSE, got: { ...PURSE.got, w: -1 } } })).toBe(false);
    expect(isWellFormed({ ...ok, l: 'purse', x: 0, y: 0, v: { ...PURSE, extra: 1 } })).toBe(false);
    expect(isWellFormed({ ...ok, l: 'purse', x: 0, y: 0, v: [1, 2] })).toBe(false);
  });

  it('refuses every layer whose mechanic is not built yet', () => {
    const closed = (Object.keys(LAYERS) as Layer[]).filter((l) => !LAYERS[l].value);
    expect(closed.sort()).toEqual(['cache', 'found', 'give', 'name', 'sign', 'tend', 'way', 'who']);
    for (const l of closed) expect(isWellFormed({ ...ok, l, x: 0, y: 0, v: 1 })).toBe(false);
  });

  it('keeps only an op\'s own fields', () => {
    expect(asOp({ ...ok, junk: 'x'.repeat(1000) })).toEqual(ok);
    expect(asOp({ ...ok, v: Tile.Snow })).toBe(null);
  });
});

describe('last wins', () => {
  // One tile fought over, another far away, and a second layer on the same tile.
  const ops = [
    op('tile', 1, 1, Tile.Path, 1, T0, 'a'), op('tile', 1, 1, Tile.Wall, 2, T0 - 50, 'b'), op('tile', 1, 1, null, 2, T0 + 9, 'a'),
    op('tile', -40, 7, Tile.Path, 5, T0, 'c'), op('tile', 1, 1, Tile.Path, 1, T0 + 99, 'z'),
  ];

  it('converges whatever order ops arrive in', () => {
    const results = orders(ops).map((list) => {
      const s = new OpStore(() => T0 + 200);
      for (const o of list) s.merge(o);
      return JSON.stringify([contents(s), s.size, s.clock, s.digest('c:0,0'), s.digest('c:-2,0')]);
    });
    expect(new Set(results).size).toBe(1);
    const s = new OpStore(() => T0 + 200);
    for (const o of ops) s.merge(o);
    // Clock 2 beats clock 1 whatever the dates say, and 'b' > 'a' breaks the tie.
    expect(s.get('tile', 1, 1)).toEqual(ops[1]);
    expect(s.tile(1, 1)).toBe(Tile.Wall);
    expect(s.size).toBe(2);
  });

  it('reports whether a merge changed anything, and tracks the clock', () => {
    const s = new OpStore(() => T0);
    expect(s.merge(op('tile', 0, 0, Tile.Path, 3, T0))).toBe(true);
    expect(s.merge(op('tile', 0, 0, Tile.Path, 3, T0))).toBe(false); // Duplicate.
    expect(s.merge(op('tile', 0, 0, Tile.Wall, 1, T0, 'z'))).toBe(false); // Older.
    expect(s.wouldChange(op('tile', 0, 0, Tile.Wall, 4, T0))).toBe(true);
    expect(s.nextClock()).toBe(4);
  });

  it('keeps an entry per author where the layer says so', () => {
    const s = new OpStore(() => T0);
    // Two players tend the same map square, one of them twice; each also has a display name and a purse.
    for (const o of orders([
      op('tend', 2, 3, { since: 1 }, 1, T0, 'a'), op('tend', 2, 3, { since: 5 }, 4, T0, 'a'), op('tend', 2, 3, { since: 2 }, 2, T0, 'b'),
      op('who', 0, 0, { name: 'Ann', hue: 10 }, 1, T0, 'a'), op('who', 0, 0, { name: 'Bo', hue: 20 }, 1, T0, 'b'),
    ])[37]) s.merge(o);
    expect(s.get('tend', 2, 3, 'a')?.clock).toBe(4);
    expect(s.get('tend', 2, 3, 'b')?.clock).toBe(2);
    expect(s.get('tend', 2, 3)).toBeUndefined(); // No author, no entry.
    expect((s.get('who', 0, 0, 'b')?.v as { name: string }).name).toBe('Bo');
    expect(s.count('tend')).toBe(2);
    expect(s.count('who')).toBe(2);
  });
});

describe('first wins', () => {
  // Four players sign for the same map square: 'c' was first by date, though its Lamport clock is the lowest
  // or the highest of them; 'a' and 'b' tie on the date.
  const ops = [
    op('chart', 4, -2, 1, 9, T0 + 30, 'd'), op('chart', 4, -2, 1, 1, T0 + 5, 'c'), op('chart', 4, -2, 1, 50, T0 + 12, 'b'),
    op('chart', 4, -2, 1, 2, T0 + 12, 'a'), op('chart', 5, -2, 1, 3, T0 + 40, 'd'),
  ];

  it('keeps the earliest date whatever order ops arrive in', () => {
    const results = orders(ops).map((list) => {
      const s = new OpStore(() => T0 + 100);
      for (const o of list) s.merge(o);
      return JSON.stringify([contents(s), s.digest('z:0,-1')]);
    });
    expect(new Set(results).size).toBe(1);
    const s = new OpStore(() => T0 + 100);
    for (const o of ops) s.merge(o);
    expect(s.get('chart', 4, -2)?.author).toBe('c');
    expect(s.get('chart', 5, -2)?.author).toBe('d');
  });

  it('breaks a tie on the date by author, then signature', () => {
    const [, , b, a] = ops;
    expect(opWins(a, b)).toBe(true);
    expect(opWins(b, a)).toBe(false);
    const twin = { ...a, sig: `${a.sig}~` };
    expect(opWins(a, twin)).toBe(true);
    expect(opWins(twin, a)).toBe(false);
    // A later op never displaces the first, however high its clock.
    const s = new OpStore(() => T0 + 100);
    s.merge(a);
    expect(s.merge(op('chart', 4, -2, 1, 999, T0 + 13, 'a'))).toBe(false);
  });
});

describe('expiry', () => {
  // Harvests of one tile. `late` has the lowest clock but the latest date: it lasts longest.
  // `high` has the highest clock but an early date. A painted tile on the same spot never expires.
  const early = op('take', 3, 3, 1, 5, T0, 'a');
  const high = op('take', 3, 3, 1, 90, T0 + 100, 'b');
  const late = op('take', 3, 3, 1, 2, T0 + 1000, 'c');
  const other = op('take', 9, 9, 1, 7, T0 + 500, 'a');
  const paint = op('tile', 3, 3, Tile.Path, 1, T0 - 99_999, 'a');
  const all = [early, high, late, other, paint];

  /** What a replica should hold at `now` once it has seen all of them: per key, the latest harvest if it still stands. */
  const expected = (now: number) => {
    const keep = [paint, late, other].filter((o) => !isExpired(o, now));
    return keep.map((o) => `${opKey(o)}=${o.sig}`).sort();
  };

  it('has a harvest stand until its time is up, and then it is gone', () => {
    const { time, store } = storeAt(T0 + 10);
    expect(store.merge(early)).toBe(true);
    expect(store.get('take', 3, 3)).toEqual(early);
    time.now = T0 + TAKE_TTL - 1;
    expect(store.get('take', 3, 3)).toEqual(early);
    time.now = T0 + TAKE_TTL;
    expect(store.get('take', 3, 3)).toBeUndefined(); // Gone to every reader at once, swept or not.
    expect(store.bucketOps('c:0,0')).toEqual([]);
    expect(store.digest('c:0,0')).toBe('');
    expect(store.size).toBe(1);
    expect(store.expire()).toEqual([early]);
    expect(store.size).toBe(0);
    expect(store.bucketIds()).toEqual([]);
    expect(store.merge(early)).toBe(false); // An expired op is refused on arrival.
  });

  it('gives the same replica whatever order ops arrive in, at any date', () => {
    for (const now of [T0 + 2000, T0 + TAKE_TTL, T0 + TAKE_TTL + 100, T0 + TAKE_TTL + 600, T0 + TAKE_TTL + 5000]) {
      for (const list of orders(all)) {
        const s = new OpStore(() => now);
        for (const o of list) s.merge(o);
        expect(contents(s)).toEqual(expected(now));
      }
    }
  });

  it('gives the same replica whenever each op arrives and whenever the replica is swept', () => {
    // Some ops arrive early, then time passes (some of what arrived expires), then the rest arrive.
    // Sweeping in between, or never, must not change what the replica ends up holding.
    const then = T0 + 2000;
    for (const now of [T0 + TAKE_TTL + 50, T0 + TAKE_TTL + 600, T0 + TAKE_TTL + 5000]) {
      for (const list of orders(all)) {
        for (let split = 0; split <= list.length; split++) {
          for (const sweep of [false, true]) {
            const { time, store } = storeAt(then);
            for (const o of list.slice(0, split)) store.merge(o);
            time.now = now;
            if (sweep) store.expire();
            for (const o of list.slice(split)) store.merge(o);
            expect(contents(store)).toEqual(expected(now));
            store.expire();
            expect(contents(store)).toEqual(expected(now));
            expect(store.size).toBe(expected(now).length);
          }
        }
      }
    }
  });

  it('lets the later date win before the clock in a layer that expires', () => {
    expect(opWins(late, high)).toBe(true); // Clock 2 over clock 90: it will outlast it.
    expect(opWins(high, late)).toBe(false);
    expect(opWins(high, early)).toBe(true);
    // Same date: the clock decides, as in any last-wins layer.
    expect(opWins(op('take', 3, 3, 1, 6, T0, 'a'), early)).toBe(true);
  });

  it('leaves expired ops out of digests, so a swept replica and an unswept one agree', () => {
    const a = storeAt(T0 + 10), b = storeAt(T0 + 10);
    for (const s of [a, b]) for (const o of [early, other, paint]) s.store.merge(o);
    a.time.now = b.time.now = T0 + TAKE_TTL + 1; // `early` has expired; `other` has not.
    a.store.expire();
    expect(a.store.digest('c:0,0')).toBe(b.store.digest('c:0,0'));
    expect(a.store.digest('c:0,0')).toMatch(/^2:/);
    expect(b.store.ops().length).toBe(2);
  });

  it('refuses an op dated too far ahead', () => {
    expect(isTooNew(op('tile', 0, 0, Tile.Path, 1, T0 + AT_AHEAD_S), T0)).toBe(false);
    expect(isTooNew(op('tile', 0, 0, Tile.Path, 1, T0 + AT_AHEAD_S + 1), T0)).toBe(true);
  });
});

describe('taking an op back', () => {
  it('puts back what the refused op displaced', () => {
    const s = new OpStore(() => T0);
    const seen: Op[] = [];
    s.onChange((o) => seen.push(o));
    const before = op('tile', 2, 2, Tile.Path, 1, T0, 'b'), mine = op('tile', 2, 2, Tile.Wall, 2, T0, 'a');
    s.merge(before);
    s.merge(mine);
    expect(s.retract(mine, before)).toBe(true);
    expect(s.get('tile', 2, 2)).toEqual(before);
    expect(s.size).toBe(1);
    expect(seen).toEqual([before, mine, before]);
    // With nothing displaced, the key is empty again.
    const fresh = op('tile', 5, 5, Tile.Path, 3, T0, 'a');
    s.merge(fresh);
    expect(s.retract(fresh, null)).toBe(true);
    expect(s.get('tile', 5, 5)).toBeUndefined();
    expect(s.hasTiles(0, 0)).toBe(true);
    expect(s.digest('c:0,0')).toMatch(/^1:/);
  });

  it('does nothing once something else stands there', () => {
    const s = new OpStore(() => T0);
    const mine = op('tile', 2, 2, Tile.Wall, 2, T0, 'a'), newer = op('tile', 2, 2, null, 3, T0, 'c');
    s.merge(mine);
    s.merge(newer);
    expect(s.retract(mine, null)).toBe(false);
    expect(s.get('tile', 2, 2)).toEqual(newer);
  });

  it('does not put back an op that has expired meanwhile', () => {
    const { time, store } = storeAt(T0);
    const before = op('take', 2, 2, 1, 1, T0, 'b'), mine = op('take', 2, 2, 1, 2, T0 + 60, 'a');
    store.merge(before);
    time.now = T0 + 60;
    store.merge(mine);
    time.now = T0 + TAKE_TTL + 5;
    expect(store.retract(mine, before)).toBe(true);
    expect(store.size).toBe(0);
  });
});

describe('scopes and buckets', () => {
  it('files zone-scope ops by chunk, world-scope ops by zone and player-scope ops by author', () => {
    expect(bucketOf(op('tile', 33, -1, Tile.Path, 1, T0))).toBe('c:1,-1');
    expect(bucketOf(op('take', -1, 64, 1, 1, T0))).toBe('c:-1,2');
    // A chart op's x and y are a map square. Zone 0,0 is squares 0..7; square -1 is in zone -1.
    expect(bucketOf(op('chart', ZONE_CHUNKS - 1, 0, 1, 1, T0))).toBe('z:0,0');
    expect(bucketOf(op('chart', ZONE_CHUNKS, -1, 1, 1, T0))).toBe('z:1,-1');
    // A world-scope op on a tile goes with that tile's zone; one with no place goes with zone 0,0.
    expect(bucketOf(op('name', 300, -300, 'Quiet Arch', 1, T0))).toBe('z:1,-2');
    expect(bucketOf(op('who', 0, 0, { name: 'Ann', hue: 1 }, 1, T0, 'ann'))).toBe('z:0,0');
    expect(bucketOf(op('purse', 0, 0, PURSE, 1, T0, 'ann'))).toBe('p:ann');
    expect(zoneChunkBuckets('1,-1')).toHaveLength(ZONE_CHUNKS * ZONE_CHUNKS);
    expect(zoneChunkBuckets('1,-1')).toContain('c:8,-8');
    expect(zoneChunkBuckets('1,-1')).toContain('c:15,-1');
    expect(atlasZone('z:-3,12')).toEqual([-3, 12]);
    expect(atlasZone('c:1,1')).toBe(null);
    expect(atlasZone('z:1,1,1')).toBe(null);
  });

  it('digests differ when a bucket\'s contents differ, in any layer', () => {
    const a = new OpStore(() => T0), b = new OpStore(() => T0);
    for (const s of [a, b]) s.merge(op('tile', 2, 2, Tile.Path, 1, T0));
    expect(a.digest('c:0,0')).toBe(b.digest('c:0,0'));
    b.merge(op('take', 2, 2, 1, 2, T0));
    expect(a.digest('c:0,0')).not.toBe(b.digest('c:0,0'));
    expect(b.digest('c:0,0')).toMatch(/^2:2:/);
    expect(a.digest('c:9,9')).toBe('');
    expect(a.bucketIds('z')).toEqual([]);
  });

  it('tells a host what it holds: the zone\'s chunks, the nearest of the atlas, and its own player ops', () => {
    const s = new OpStore(() => T0);
    s.merge(op('tile', 5, 5, Tile.Path, 1, T0)); // In zone 0,0.
    s.merge(op('tile', 300, 5, Tile.Path, 2, T0)); // In zone 1,0: not this zone's to sync.
    for (const zx of [0, 1, 2, 7, -9]) s.merge(op('chart', zx * ZONE_CHUNKS, 0, 1, 3, T0));
    s.merge(op('purse', 0, 0, PURSE, 4, T0, 'me'));
    s.merge(op('purse', 0, 0, PURSE, 5, T0, 'someone-else'));
    expect(Object.keys(syncDigests(s, '0,0', 'me', 3)).sort()).toEqual(['c:0,0', 'p:me', 'z:0,0', 'z:1,0', 'z:2,0']);
    expect(Object.keys(syncDigests(s, '1,0', null, 100)).sort()).toEqual(['c:9,0', 'z:-9,0', 'z:0,0', 'z:1,0', 'z:2,0', 'z:7,0']);
  });

  it('caps what a host takes for one bucket in one catch-up', () => {
    // Two open layers can each hold an op on every tile of a chunk.
    expect(bucketCap('c:3,-3')).toBe(2 * CHUNK * CHUNK);
    expect(bucketCap('z:0,0')).toBe(SYNC_OPS_BURST);
    expect(bucketCap('p:someone')).toBe(16);
  });

  it('measures reach by tile, by map square, or not at all', () => {
    expect(inReach(op('tile', 14, 10, Tile.Path, 1, T0), 10.5, 10.5)).toBe(true);
    expect(inReach(op('tile', 16, 10, Tile.Path, 1, T0), 10.5, 10.5)).toBe(false);
    // Standing in square 1,1: that square and the eight around it.
    expect(inReach(op('chart', 2, 0, 1, 1, T0), 40, 40)).toBe(true);
    expect(inReach(op('chart', 3, 1, 1, 1, T0), 40, 40)).toBe(false);
    expect(inReach(op('chart', -1, 0, 1, 1, T0), -0.5, 10)).toBe(true);
    expect(inReach(op('purse', 0, 0, PURSE, 1, T0), 9999, 9999)).toBe(true);
  });
});

describe('the clock ops are dated by', () => {
  it('reads a shift in days, hours, minutes or seconds', () => {
    expect(parseClockShift('+45d')).toBe(45 * 86400);
    expect(parseClockShift('-2h')).toBe(-7200);
    expect(parseClockShift('90m')).toBe(5400);
    expect(parseClockShift(' +30s ')).toBe(30);
    for (const bad of [null, undefined, '', '45', 'd', '+1w', '1.5h', '++1d']) expect(parseClockShift(bad)).toBe(0);
  });

  it('runs that far from the wall clock', () => {
    const real = Math.floor(Date.now() / 1000);
    expect(Math.abs(wallClock()() - real)).toBeLessThanOrEqual(1);
    expect(Math.abs(wallClock(3600)() - real - 3600)).toBeLessThanOrEqual(1);
    // A device 45 days ahead has seen today's harvest regrow.
    const s = new OpStore(wallClock(parseClockShift('+45d')));
    expect(s.merge(op('take', 0, 0, 1, 1, real))).toBe(false);
  });
});

describe('edited terrain', () => {
  it('overrides generated tiles in lookups and chunks, and reverts with null', () => {
    const seed = worldSeed(WORLD);
    const e = new OpStore(() => T0);
    const tiles = new TileCache(seed, 64, e);
    const changed: string[] = [];
    tiles.onChunkChange((cx, cy) => changed.push(`${cx},${cy}`));
    const x = CHUNK + 5, y = -3;

    e.merge(op('tile', x, y, Tile.Wall, 1, T0));
    expect(tiles.get(x, y)).toBe(Tile.Wall);
    expect(tiles.chunk(1, -1)[(y + CHUNK) * CHUNK + 5]).toBe(Tile.Wall);
    expect(tiles.base(1, -1)[(y + CHUNK) * CHUNK + 5]).toBe(tileAt(seed, x, y));
    expect(tiles.edited(1, -1)).toBe(true);
    expect(changed).toEqual(['1,-1']);

    e.merge(op('tile', x, y, null, 2, T0));
    expect(tiles.get(x, y)).toBe(tileAt(seed, x, y));
    expect(tiles.chunk(1, -1)[(y + CHUNK) * CHUNK + 5]).toBe(tileAt(seed, x, y));
    expect(changed).toEqual(['1,-1', '1,-1']);
  });

  it('is left alone by layers that only lie on top of the land', () => {
    const e = new OpStore(() => T0);
    const tiles = new TileCache(worldSeed(WORLD), 64, e);
    let changes = 0;
    tiles.onChunkChange(() => changes++);
    e.merge(op('take', 3, 3, 1, 1, T0));
    e.merge(op('chart', 0, 0, 1, 2, T0));
    e.merge(op('purse', 0, 0, PURSE, 3, T0));
    expect(changes).toBe(0);
    expect(tiles.edited(0, 0)).toBe(false);
    expect(tiles.chunk(0, 0)).toBe(tiles.base(0, 0));
  });

  it('blocks movement into a painted wall', () => {
    const e = new OpStore(() => T0);
    const grass = new TileCache(0, 64, e);
    const open = (x: number, y: number) => (e.tile(x, y) ?? Tile.Grass) as Tile;
    expect(step(open, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }, 0.3).x).toBeGreaterThan(1.5);
    e.merge(op('tile', 1, 0, Tile.Wall, 1, T0));
    expect(step(open, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }, 0.3).x).toBeLessThan(1);
    expect(grass.get(1, 0)).toBe(Tile.Wall);
  });
});
