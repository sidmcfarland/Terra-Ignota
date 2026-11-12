/**
 * The weather and the seasons.
 * docs/ART_DIRECTION.md ("Weather and seasons") is the source of truth; change both together.
 *
 * Plain numbers only, like day.ts and wind.ts, and read from the wall clock in
 * the same way: every explorer sees the same sky and nothing is sent.
 *
 * Weather is not a list of states. It is five amounts (cloud, rain, snow, fog,
 * storm) that rise and fall on their own slow tides, and the look bends the
 * lights, the wind, the mist and the particles by them. So weather drifts in and
 * out; it never switches.
 */

/** One season, in real seconds. Four make a year. */
export const SEASON_SECONDS = 4 * 60 * 60;
export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonName = (typeof SEASON_NAMES)[number];

/** How much of each season is in the air; the four sum to 1. */
export interface Season {
  spring: number;
  summer: number;
  autumn: number;
  winter: number;
}

export interface Weather {
  /** 0 (clear sky) to 1 (overcast). */
  cloud: number;
  rain: number;
  /** Snowfall. Rain turns to snow as winter comes on. */
  snow: number;
  /** Mist lying in the low ground. */
  fog: number;
  /** Heavy weather: harder wind and distant lightning. */
  storm: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where the year stands at a wall-clock time: 0 is the first day of spring, 1 of summer, 2 autumn, 3 winter. */
export function yearAt(epochMs: number): number {
  const year = SEASON_SECONDS * 4000;
  return ((((epochMs % year) + year) % year) / year) * 4;
}

/** A season holds for most of its span, then gives way to the next over its last third. */
export function seasonAt(year: number, out: Season = { spring: 0, summer: 0, autumn: 0, winter: 0 }): Season {
  const y = ((year % 4) + 4) % 4, i = Math.floor(y);
  const next = smooth(0.67, 1, y - i);
  out.spring = out.summer = out.autumn = out.winter = 0;
  out[SEASON_NAMES[i]] = 1 - next;
  out[SEASON_NAMES[(i + 1) % 4]] += next;
  return out;
}

/** `#season=`: a name, or a point in the year from 0 to 4. Null follows the clock. */
export function parseSeason(s: string | null | undefined): number | null {
  if (!s) return null;
  const i = SEASON_NAMES.indexOf(s as SeasonName);
  if (i >= 0) return i + 0.3;
  const v = Number(s);
  return Number.isFinite(v) ? ((v % 4) + 4) % 4 : null;
}

/** The weathers by name, for `#weather=` and for comparable screenshots. */
export const WEATHERS: Record<string, Weather> = {
  clear: { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0 },
  broken: { cloud: 0.45, rain: 0, snow: 0, fog: 0, storm: 0 },
  overcast: { cloud: 1, rain: 0, snow: 0, fog: 0, storm: 0 },
  rain: { cloud: 1, rain: 0.75, snow: 0, fog: 0, storm: 0 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0, storm: 1 },
  fog: { cloud: 0.5, rain: 0, snow: 0, fog: 1, storm: 0 },
  snow: { cloud: 0.9, rain: 0, snow: 0.8, fog: 0, storm: 0 },
};

/** `#weather=`: a name from WEATHERS. Null follows the clock. */
export function parseWeather(s: string | null | undefined): Weather | null {
  return s && Object.hasOwn(WEATHERS, s) ? WEATHERS[s] : null;
}

/**
 * The weather at a wall-clock time. Two slow tides: one of wet weather (cloud,
 * then rain, then storm as it rises) and one of mist. Each swing fits a whole
 * number of times into 24 hours, so the pattern repeats daily without a jump.
 * A change of weather takes minutes to arrive. Fair weather is the rule: cloudy
 * about a quarter of the time, raining about a seventh, a storm about one minute
 * in twenty, mist about a tenth.
 */
export function weatherAt(
  epochMs: number,
  season: Season,
  out: Weather = { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0 },
): Weather {
  const t = ((epochMs % 86_400_000) / 86_400_000) * Math.PI * 2;
  // The wet tide swings about every 85 and 35 minutes on a three-hour swell; the mist every 130 and 50.
  const wet = 0.5 + 0.28 * Math.sin(17 * t + 0.4) + 0.17 * Math.sin(41 * t + 2) + 0.1 * Math.sin(7 * t + 4.1);
  const damp = 0.5 + 0.3 * Math.sin(11 * t + 1.1) + 0.2 * Math.sin(29 * t + 3);
  const fall = smooth(0.72, 0.88, wet);
  out.cloud = smooth(0.55, 0.75, wet);
  out.rain = fall * (1 - season.winter);
  out.snow = fall * season.winter;
  out.storm = smooth(0.9, 1, wet) * (1 - season.winter);
  out.fog = smooth(0.78, 0.95, damp) * (1 - 0.7 * fall);
  return out;
}

/**
 * Distant lightning, 0 to 1, at a wall-clock time: now and then a double flicker
 * that is gone in under half a second. Multiply by the storm's strength.
 */
export function flashAt(epochMs: number): number {
  const cell = Math.floor(epochMs / 6000);
  const r = Math.abs(Math.sin(cell * 12.9898) * 43758.5453) % 1;
  if (r > 0.4) return 0;
  const dt = epochMs - (cell * 6000 + r * 9000);
  if (dt < 0 || dt > 450) return 0;
  const second = dt > 150 ? 0.7 * Math.exp(-(dt - 150) / 70) : 0;
  return Math.min(1, Math.exp(-dt / 80) + second);
}
