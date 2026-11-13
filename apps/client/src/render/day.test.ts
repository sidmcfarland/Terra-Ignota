import { describe, expect, it } from 'vitest';
import {
  DAY_SECONDS, MOONS, MOON_DAYS, SUNRISE, SUNSET, TIMES, hourAt, keyBody, lightAt, luminance, makeLight, moonAt, moonOn, parseMoon, parseTime,
} from './day.ts';

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

describe('the moon', () => {
  const month = MOON_DAYS * DAY_SECONDS * 1000;

  it('goes from new to full and back once a month, smoothly', () => {
    expect(moonAt(0)).toBeCloseTo(0, 6);
    expect(moonAt(month / 2)).toBeCloseTo(1, 6);
    expect(moonAt(month / 4)).toBeCloseTo(0.5, 6);
    expect(moonAt(month * 3 + month / 4)).toBeCloseTo(moonAt(month / 4), 6);
    expect(moonAt(-month / 4)).toBeCloseTo(0.5, 6);
    // No night sees it change by more than a little: a night is under a third of a day.
    const night = 0.3 * DAY_SECONDS * 1000;
    for (let t = 0; t < month; t += month / 200) {
      const lit = moonAt(t);
      expect(lit).toBeGreaterThanOrEqual(0);
      expect(lit).toBeLessThanOrEqual(1);
      expect(Math.abs(moonAt(t + night) - lit)).toBeLessThan(0.13);
    }
  });

  it('reads a phase by name or as how much is lit', () => {
    expect(parseMoon('new')).toBe(0);
    expect(parseMoon('full')).toBe(1);
    expect(parseMoon('half')).toBe(MOONS.half);
    expect(parseMoon('0.3')).toBe(0.3);
    expect(parseMoon('7')).toBe(1);
    expect(parseMoon('')).toBeNull();
    expect(parseMoon(null)).toBeNull();
    expect(parseMoon('cheese')).toBeNull();
  });

  it('leaves a full-moon night, and every day, exactly as they were', () => {
    for (let h = 0; h < 24; h += 0.25) {
      expect(moonOn(lightAt(h), h, 1)).toEqual(lightAt(h));
      if (h >= SUNRISE && h < SUNSET) expect(moonOn(lightAt(h), h, 0)).toEqual(lightAt(h));
    }
  });

  it('makes a night darker the less moon there is, but never dark', () => {
    const full = lightAt(TIMES.night), half = moonOn(lightAt(TIMES.night), TIMES.night, 0.5), none = moonOn(lightAt(TIMES.night), TIMES.night, 0);
    expect(half.level).toBeLessThan(full.level);
    expect(none.level).toBeLessThan(half.level);
    // Open ground under a new moon is still most of what it is under a full one.
    expect(none.level).toBeGreaterThan(0.17);
    expect(none.level / full.level).toBeGreaterThan(0.7);
    // The moon's own light and its glint go; the sky's fill does not.
    expect(luminance(none.key)).toBeLessThan(luminance(full.key) * 0.3);
    expect(luminance(none.key)).toBeGreaterThan(0);
    expect(none.glint).toBeLessThan(full.glint * 0.2);
    expect(none.sky).toEqual(full.sky);
  });

  it('comes on with the night: sundown and first light are the same under any moon', () => {
    for (const h of [18.01, 5.99]) {
      expect(moonOn(lightAt(h), h, 0).level).toBeCloseTo(lightAt(h).level, 2);
    }
    // Through dusk the level only ever falls, whatever the moon.
    for (const lit of [0, 0.5, 1]) {
      let prev = Infinity;
      for (let h = 18.01; h < 21; h += 0.05) {
        const level = moonOn(lightAt(h, makeLight()), h, lit).level;
        expect(level).toBeLessThanOrEqual(prev + 1e-9);
        prev = level;
      }
    }
  });
});
