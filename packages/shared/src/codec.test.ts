import { describe, expect, it } from 'vitest';
import { MAX_POSITIONS, POS_SCALE, decodeUnreliable, encodeUnreliable } from './codec.ts';
import type { PlayerPos, Unreliable } from './protocol.ts';

const roundTrip = (m: Unreliable) => decodeUnreliable(encodeUnreliable(m));
/** A coordinate as it comes back: rounded to the codec's resolution. */
const q = (v: number) => Math.round(v * POS_SCALE) / POS_SCALE;

describe('unreliable codec', () => {
  it('round-trips a position report', () => {
    expect(roundTrip({ t: 'pos', seq: 0, x: 0, y: 0, view: 0 })).toEqual({ t: 'pos', seq: 0, x: 0, y: 0, view: 0 });
    expect(roundTrip({ t: 'pos', seq: 123456, x: 130.337, y: -98765.4321, view: 96 }))
      .toEqual({ t: 'pos', seq: 123456, x: q(130.337), y: q(-98765.4321), view: 96 });
  });

  it('keeps positions within 1/128 of a tile', () => {
    for (const v of [0.004, 17.499, -3.21, 255.999, 1e7 + 0.37]) {
      const m = roundTrip({ t: 'pos', seq: 1, x: v, y: -v, view: 64 }) as Extract<Unreliable, { t: 'pos' }>;
      expect(Math.abs(m.x - v)).toBeLessThanOrEqual(1 / 128);
      expect(Math.abs(m.y + v)).toBeLessThanOrEqual(1 / 128);
    }
  });

  it('round-trips probes with their exact timestamp', () => {
    expect(roundTrip({ t: 'ping', ts: 123456.789012 })).toEqual({ t: 'ping', ts: 123456.789012 });
    expect(roundTrip({ t: 'pong', ts: 0.5 })).toEqual({ t: 'pong', ts: 0.5 });
  });

  it('round-trips snapshots and edge lists', () => {
    const p: PlayerPos[] = [[0, 300.25, 120.5], [7, 310.015625, 119], [130, 250, 180.75], [20000, 301, 121]];
    expect(roundTrip({ t: 'snap', tick: 98765, n: 42, p })).toEqual({ t: 'snap', tick: 98765, n: 42, p });
    expect(roundTrip({ t: 'edge', p })).toEqual({ t: 'edge', p });
    expect(roundTrip({ t: 'snap', tick: 1, n: 1, p: [] })).toEqual({ t: 'snap', tick: 1, n: 1, p: [] });
    expect(roundTrip({ t: 'edge', p: [] })).toEqual({ t: 'edge', p: [] });
  });

  it('round-trips positions far from the origin and below zero', () => {
    const p: PlayerPos[] = [[1, -1_000_000.5, 2_000_000_000.25], [2, -1_000_100, 2_000_000_050]];
    expect(roundTrip({ t: 'snap', tick: 2 ** 40, n: 2, p })).toEqual({ t: 'snap', tick: 2 ** 40, n: 2, p });
  });

  it('round-trips backup state with peer ids', () => {
    const m: Unreliable = { t: 'state', tick: 77, p: [['AbC_dEf-123', 12.5, -3.25], ['bot12-xyz', 0, 0]] };
    expect(roundTrip(m)).toEqual(m);
  });

  it('packs a nearby player into about 5 bytes', () => {
    const p: PlayerPos[] = [];
    for (let i = 0; i < 20; i++) p.push([i, 1000 + ((i * 37) % 120), 2000 + ((i * 53) % 120)]);
    const bytes = encodeUnreliable({ t: 'snap', tick: 100_000, n: 30, p }).length;
    expect(bytes).toBeLessThanOrEqual(10 + 20 * 5);
    expect(encodeUnreliable({ t: 'pos', seq: 5000, x: 1000.5, y: 2000.5, view: 96 }).length).toBeLessThanOrEqual(10);
    // The same snapshot as protocol 6 sent it: JSON with 12-character ids.
    const json = JSON.stringify({ t: 'snap', tick: 100_000, p: p.map(([n, x, y]) => [`AbCdEfGhIj${10 + n}`, x, y]) }).length;
    expect(bytes * 4).toBeLessThan(json);
  });

  it('refuses malformed input instead of throwing', () => {
    expect(decodeUnreliable(new Uint8Array([]))).toBeNull();
    expect(decodeUnreliable(new Uint8Array([99, 1, 2]))).toBeNull(); // Unknown type.
    expect(decodeUnreliable(new Uint8Array([1, 5]))).toBeNull(); // Truncated position report.
    expect(decodeUnreliable(new Uint8Array([2, 0, 0]))).toBeNull(); // Truncated probe.
    expect(decodeUnreliable(new Uint8Array([4, 1, 1, 200, 200, 200, 200, 200, 200, 200, 200, 200]))).toBeNull(); // Runaway varint.
    const good = encodeUnreliable({ t: 'pos', seq: 1, x: 2, y: 3, view: 4 });
    expect(decodeUnreliable(new Uint8Array([...good, 0]))).toBeNull(); // Trailing bytes.
    expect(decodeUnreliable(good.buffer)).toEqual({ t: 'pos', seq: 1, x: 2, y: 3, view: 4 }); // An ArrayBuffer works too.
  });

  it('refuses a probe whose timestamp is not a number', () => {
    expect(decodeUnreliable(encodeUnreliable({ t: 'ping', ts: NaN }))).toBeNull();
    expect(decodeUnreliable(encodeUnreliable({ t: 'pong', ts: Infinity }))).toBeNull();
  });

  it('refuses a list that claims more positions than allowed', () => {
    // snap, tick 1, n 1, then a count of MAX_POSITIONS + 1 as a varint.
    const count = MAX_POSITIONS + 1;
    expect(decodeUnreliable(new Uint8Array([4, 1, 1, (count % 128) | 128, Math.floor(count / 128)]))).toBeNull();
  });

  it('writes values it cannot represent as zero, so decoding stays finite', () => {
    expect(roundTrip({ t: 'pos', seq: -1, x: NaN, y: Infinity, view: -5 })).toEqual({ t: 'pos', seq: 0, x: 0, y: 0, view: 0 });
  });

  it('decodes a view into a larger buffer', () => {
    const bytes = encodeUnreliable({ t: 'ping', ts: 42 });
    const padded = new Uint8Array(bytes.length + 6);
    padded.set(bytes, 3);
    expect(decodeUnreliable(padded.subarray(3, 3 + bytes.length))).toEqual({ t: 'ping', ts: 42 });
  });
});
