import { describe, expect, it } from 'vitest';
import { BLOOM, BLOOM_KINDS } from './cover.ts';
import {
  SEASON_NAMES, SEASON_SECONDS, WEATHERS, bloomsAt, flashAt, parseSeason, parseWeather, seasonAt, weatherAt, yearAt,
} from './weather.ts';

const HOUR = 3_600_000;

describe('the year', () => {
  it("lasts 400 of the game's days, 100 to a season: 13 real days and 8 hours", () => {
    expect(SEASON_SECONDS).toBe(100 * 48 * 60);
    expect(SEASON_SECONDS * 4).toBe((13 * 24 + 8) * 3600);
  });

  it('turns through four seasons and comes round again', () => {
    const year = SEASON_SECONDS * 4000;
    expect(yearAt(0)).toBe(0);
    expect(yearAt(year / 4)).toBeCloseTo(1, 9);
    expect(yearAt(year * 7 + year / 2)).toBeCloseTo(2, 6);
    for (let i = 0; i < 4; i++) expect(seasonAt(i + 0.3)[SEASON_NAMES[i]]).toBe(1);
  });

  it('blends each season into the next, and the four always sum to 1', () => {
    let prev = seasonAt(0);
    for (let y = 0.005; y <= 4.2; y += 0.005) {
      const s = seasonAt(y);
      expect(s.spring + s.summer + s.autumn + s.winter).toBeCloseTo(1, 9);
      for (const name of SEASON_NAMES) expect(Math.abs(s[name] - prev[name])).toBeLessThan(0.03);
      prev = s;
    }
    expect(seasonAt(0.95).summer).toBeGreaterThan(0.9);
  });

  it('reads #season= as a name or a point in the year', () => {
    expect(seasonAt(parseSeason('autumn')!).autumn).toBe(1);
    expect(parseSeason('3.5')).toBe(3.5);
    expect(parseSeason('monsoon')).toBeNull();
    expect(parseSeason(null)).toBeNull();
  });
});

describe('the weather', () => {
  const summer = seasonAt(1.3), winter = seasonAt(3.3);

  it('stays within 0 and 1 and drifts, never switches', () => {
    let prev = weatherAt(0, summer), low = 1, high = 0, jump = 0;
    for (let s = 2; s < 86_400 + 600; s += 2) {
      const w = weatherAt(s * 1000, summer);
      for (const k of ['cloud', 'rain', 'snow', 'fog', 'storm'] as const) {
        low = Math.min(low, w[k]);
        high = Math.max(high, w[k]);
        jump = Math.max(jump, Math.abs(w[k] - prev[k]));
      }
      prev = w;
    }
    expect(low).toBe(0);
    expect(high).toBe(1);
    // The fastest any amount moves: under 3% in two seconds, so a storm takes a minute or more to arrive.
    expect(jump).toBeLessThan(0.03);
  });

  it('is fair most of the time', () => {
    let cloudy = 0, raining = 0, stormy = 0, foggy = 0, n = 0;
    for (let ms = 0; ms < 24 * HOUR; ms += 20_000, n++) {
      const w = weatherAt(ms, summer);
      if (w.cloud > 0.5) cloudy++;
      if (w.rain > 0.3) raining++;
      if (w.storm > 0.3) stormy++;
      if (w.fog > 0.3) foggy++;
    }
    expect(cloudy / n).toBeLessThan(0.45);
    expect(raining / n).toBeGreaterThan(0.05);
    expect(raining / n).toBeLessThan(0.25);
    expect(stormy / n).toBeLessThan(0.06);
    expect(foggy / n).toBeLessThan(0.2);
  });

  it('snows in winter where it would rain in summer, and winter has no thunder', () => {
    for (let ms = 0; ms < 24 * HOUR; ms += 60_000) {
      const a = weatherAt(ms, summer), b = weatherAt(ms, winter);
      expect(a.snow).toBe(0);
      expect(b.rain).toBe(0);
      expect(b.snow).toBeCloseTo(a.rain, 9);
      expect(b.storm).toBe(0);
    }
  });

  it('reads #weather= as a name', () => {
    expect(parseWeather('rain')).toBe(WEATHERS.rain);
    expect(parseWeather('toString')).toBeNull();
    expect(parseWeather('')).toBeNull();
  });

  it('flickers with lightning only now and then, and briefly', () => {
    let lit = 0, peak = 0, n = 0;
    let low = 1;
    for (let ms = 0; ms < 600_000; ms += 10, n++) {
      const f = flashAt(ms);
      low = Math.min(low, f);
      if (f > 0.05) lit++;
      peak = Math.max(peak, f);
    }
    expect(low).toBe(0);
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.8);
    expect(lit / n).toBeLessThan(0.03);
    expect(lit).toBeGreaterThan(0);
  });
});

describe('the flowers', () => {
  const at = (year: number) => bloomsAt(seasonAt(year));

  it('has an amount for every kind, and leaves everything that is not a flower alone', () => {
    for (let y = 0; y < 4; y += 0.05) {
      const out = at(y);
      expect(out.length).toBe(BLOOM_KINDS);
      expect(out[0]).toBe(1);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(Object.values(BLOOM).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gives every flower a season when all of them are out, and none in winter', () => {
    const winter = at(3.3);
    for (const kind of Object.values(BLOOM)) {
      expect(Math.max(at(0.3)[kind], at(1.3)[kind], at(2.3)[kind])).toBe(1);
      expect(winter[kind]).toBe(0);
    }
  });

  it('keeps each to its own part of the year', () => {
    const spring = at(0.3), summer = at(1.3), autumn = at(2.3);
    // Buttercups and marsh marigolds are spring flowers.
    expect(spring[BLOOM.buttercup]).toBeGreaterThan(summer[BLOOM.buttercup]);
    expect(spring[BLOOM.marigold]).toBeGreaterThan(summer[BLOOM.marigold]);
    expect(autumn[BLOOM.buttercup]).toBe(0);
    // Thrift, oxeye daisies and cotton-grass are at their best in summer.
    for (const kind of [BLOOM.thrift, BLOOM.oxeye, BLOOM.cotton]) {
      expect(summer[kind]).toBeGreaterThan(spring[kind]);
      expect(summer[kind]).toBeGreaterThan(autumn[kind]);
    }
    // Harebells come late: none in spring, most in autumn.
    expect(spring[BLOOM.harebell]).toBe(0);
    expect(autumn[BLOOM.harebell]).toBeGreaterThan(summer[BLOOM.harebell]);
  });

  it('changes smoothly through the year', () => {
    let prev = at(0);
    for (let y = 0.01; y <= 4; y += 0.01) {
      const now = at(y);
      for (let k = 0; k < BLOOM_KINDS; k++) expect(Math.abs(now[k] - prev[k])).toBeLessThan(0.08);
      prev = now;
    }
  });
});
