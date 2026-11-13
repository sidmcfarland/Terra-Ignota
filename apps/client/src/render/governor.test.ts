import { describe, expect, it } from 'vitest';
import { PixelRatioGovernor } from './governor.ts';

/** Feed `seconds` of frames, each `ms` apart; returns every ratio the governor asked for. */
function run(g: PixelRatioGovernor, ms: number, seconds: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds * 1000; t += ms) {
    const r = g.sample(ms);
    if (r !== null) changes.push(r);
  }
  return changes;
}

describe('the pixel ratio governor', () => {
  it('starts as sharp as the screen, capped at 2, and never goes under 1', () => {
    expect(new PixelRatioGovernor(3).ratio).toBe(2);
    expect(new PixelRatioGovernor(3).min).toBe(1);
    expect(new PixelRatioGovernor(1.5).ratio).toBe(1.5);
    expect(new PixelRatioGovernor(1).min).toBe(1);
    expect(new PixelRatioGovernor(1.5).min).toBe(1);
    // A screen at ratio 1 has nothing to give: it is never changed.
    const plain = new PixelRatioGovernor(1);
    expect(run(plain, 33.3, 30)).toEqual([]);
  });

  it('leaves the ratio alone while frames are on time', () => {
    const g = new PixelRatioGovernor(2);
    expect(run(g, 16.7, 60)).toEqual([]);
    expect(run(g, 8.3, 30)).toEqual([]); // a 120 Hz screen
    expect(g.ratio).toBe(2);
  });

  it('drops within a few seconds when frames run late, step by step, down to its floor', () => {
    const g = new PixelRatioGovernor(2);
    // From a cold start: 90 frames of warm-up, then the first window of 45.
    expect(run(g, 33.3, 4)).toEqual([]);
    const changes = run(g, 33.3, 2);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0]).toBe(1.7);
    run(g, 33.3, 30);
    expect(g.ratio).toBe(g.min);
    expect(run(g, 33.3, 10)).toEqual([]);
  });

  it('ignores the first frames, a single hitch, and a tab that was hidden', () => {
    const g = new PixelRatioGovernor(2);
    for (let i = 0; i < 80; i++) expect(g.sample(40)).toBeNull(); // chunks building at the start
    run(g, 16.7, 5);
    expect(g.sample(120)).toBeNull(); // one long frame
    expect(g.sample(5000)).toBeNull(); // back from a hidden tab
    expect(run(g, 16.7, 10)).toEqual([]);
    expect(g.ratio).toBe(2);
  });

  it('climbs back slowly once frames are on time again, and no sooner than half a minute', () => {
    const g = new PixelRatioGovernor(2);
    run(g, 33.3, 6);
    const low = g.ratio;
    expect(low).toBeLessThan(2);
    expect(run(g, 16.7, 20)).toEqual([]);
    const rises = run(g, 16.7, 120);
    expect(rises.length).toBeGreaterThan(0);
    for (let i = 1; i < rises.length; i++) expect(rises[i]).toBeGreaterThan(rises[i - 1]);
    expect(g.ratio).toBe(2);
  });

  it('settles: a ratio that proves too much is tried again less and less often', () => {
    // A device that keeps 60 a second at 1.7 and below, and not above.
    const g = new PixelRatioGovernor(2);
    let rises = 0, t = 0, last = g.ratio;
    const firstHalf = { rises: 0 }, secondHalf = { rises: 0 };
    const total = 40 * 60 * 1000;
    while (t < total) {
      const ms = g.ratio > 1.7 ? 33.3 : 16.7;
      t += ms;
      const r = g.sample(ms);
      if (r !== null) {
        if (r > last) { rises++; (t < total / 2 ? firstHalf : secondHalf).rises++; }
        last = r;
      }
    }
    expect(rises).toBeGreaterThan(0);
    expect(secondHalf.rises).toBeLessThan(firstHalf.rises);
    // Most of the time is spent at the ratio that works.
    expect(g.ratio).toBeLessThanOrEqual(2);
  });
});
