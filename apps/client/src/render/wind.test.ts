import { describe, expect, it } from 'vitest';
import { parseWind, steadyWind, windAt } from './wind.ts';

describe('the wind', () => {
  it('always blows, never hard, and from a unit direction', () => {
    for (let s = 0; s < 86_400; s += 37) {
      const w = windAt(s * 1000);
      expect(Math.hypot(w.x, w.y)).toBeCloseTo(1, 6);
      expect(w.strength).toBeGreaterThan(0.1);
      expect(w.strength).toBeLessThan(0.72);
    }
  });

  it('shifts slowly, including over midnight', () => {
    for (let s = 86_400 - 1800; s < 86_400 + 1800; s += 1) {
      const a = windAt(s * 1000), b = windAt((s + 1) * 1000);
      expect(Math.abs(a.strength - b.strength)).toBeLessThan(0.006);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01);
    }
  });

  it('is the same for everyone at the same moment', () => {
    const now = 1_794_000_000_000;
    expect(windAt(now)).toEqual(windAt(now));
  });

  it('reads #wind= as a strength from 0 to 1', () => {
    expect(parseWind('0.8')).toBe(0.8);
    expect(parseWind('0')).toBe(0);
    expect(parseWind('7')).toBe(1);
    expect(parseWind('breezy')).toBeNull();
    expect(parseWind(null)).toBeNull();
    expect(steadyWind(0.5).strength).toBe(0.5);
  });
});
