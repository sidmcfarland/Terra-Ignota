import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, SUNRISE, SUNSET, TIMES, hourAt, keyBody, lightAt, luminance, parseTime } from './day.ts';

describe('the clock', () => {
  it('runs through all 24 hours once a day, always forwards', () => {
    const steps = 2000, period = DAY_SECONDS * 1000;
    let turned = 0, prev = hourAt(0);
    const seen = new Set<number>();
    for (let i = 1; i <= steps; i++) {
      const h = hourAt((i / steps) * period);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
      if (h < prev) turned++;
      else expect(h - prev).toBeLessThan(0.2);
      seen.add(Math.floor(h));
      prev = h;
    }
    expect(turned).toBe(1); // past midnight, once
    expect(seen.size).toBe(24);
    expect(hourAt(period)).toBeCloseTo(hourAt(0), 6);
  });

  it('is the same for everyone at the same moment, whatever the day', () => {
    const now = 1_794_000_000_000;
    expect(hourAt(now + DAY_SECONDS * 1000 * 37)).toBeCloseTo(hourAt(now), 6);
  });

  it('reads #time= as a name or an hour', () => {
    expect(parseTime('golden')).toBe(TIMES.golden);
    expect(parseTime('16.5')).toBe(16.5);
    expect(parseTime('26')).toBe(2);
    expect(parseTime('teatime')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe('the light', () => {
  it('hands over between sun and moon at the horizon', () => {
    expect(keyBody(12)).toEqual({ moon: false, theta: Math.PI / 2 });
    expect(keyBody(0)).toEqual({ moon: true, theta: Math.PI / 2 });
    expect(keyBody(SUNRISE).theta).toBe(0);
    expect(keyBody(SUNSET)).toEqual({ moon: true, theta: 0 });
    expect(keyBody(SUNSET - 0.001).theta).toBeCloseTo(Math.PI, 2);
  });

  it('never jumps, except the key light changing hands below the horizon', () => {
    const step = 0.01;
    for (let h = 0; h < 24; h += step) {
      const a = lightAt(h), b = lightAt(h + step);
      const handover = Math.abs(h - SUNRISE) < 0.03 || Math.abs(h - SUNSET) < 0.03;
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(a.sky[c] - b.sky[c])).toBeLessThan(0.03);
        expect(Math.abs(a.bounce[c] - b.bounce[c])).toBeLessThan(0.03);
        if (!handover) expect(Math.abs(a.key[c] - b.key[c])).toBeLessThan(0.05);
      }
      expect(Math.abs(a.level - b.level)).toBeLessThan(0.015);
      expect(Math.abs(a.lamp - b.lamp)).toBeLessThan(0.03);
    }
  });

  it('is never dark, and lanterns are lit only when the light is low', () => {
    for (let h = 0; h < 24; h += 0.1) {
      const l = lightAt(h);
      expect(l.level).toBeGreaterThanOrEqual(0.24);
      expect(luminance(l.sky)).toBeGreaterThan(0.05);
      if (l.lamp > 0) expect(l.level).toBeLessThan(0.7);
    }
    expect(lightAt(TIMES.noon).lamp).toBe(0);
    expect(lightAt(TIMES.night).lamp).toBe(1);
  });
});
