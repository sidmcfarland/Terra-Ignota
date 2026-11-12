import type { Season, Weather } from './weather.ts';

/**
 * The air: the small things that hang in it, and when.
 * docs/ART_DIRECTION.md ("Atmosphere") is the source of truth; change both together.
 *
 * Plain numbers only. Nothing here has a clock of its own: each amount follows
 * from the hour, the weather, the season and the wind, so the atmosphere is
 * always the one that belongs to the moment and every explorer sees the same.
 */
export interface Air {
  /** Dust and pollen drifting in sunlight, strongest when the sun is low. */
  dust: number;
  /** Leaves coming down in autumn, more of them in a wind. */
  leaves: number;
  /** Fireflies: warm nights, from dusk into the small hours, in still air. */
  fireflies: number;
  /** Stars lying in still water: a clear, calm night. */
  stars: number;
  /** Mist that gathers in the low ground at dawn and burns off by mid-morning. */
  mist: number;
}

export function makeAir(): Air {
  return { dust: 0, leaves: 0, fireflies: 0, stars: 0, mist: 0 };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * `night` is how far the day has gone dark, 0 to 1 (the lanterns' own measure, see day.ts);
 * `wind` is the wind's strength, 0 to 1. All the amounts returned are 0 to 1.
 */
export function airAt(hour: number, night: number, weather: Weather, season: Season, wind: number, out: Air = makeAir()): Air {
  const dry = 1 - Math.max(weather.rain, weather.snow);
  const calm = 1 - smooth(0.3, 0.7, wind);
  const lowSun = smooth(0.45, 0.9, Math.abs(hour - 12) / 6);
  // In autumn the leaves take the dust's place in the air.
  out.dust = (1 - night) * dry * (1 - 0.7 * weather.cloud) * (0.45 + 0.55 * lowSun) * (1 - 0.7 * season.winter - 0.85 * season.autumn);
  out.leaves = season.autumn * (1 - 0.7 * night) * dry * (0.35 + 0.65 * Math.min(1, wind * 1.6));
  // After midnight the fireflies thin out; by the small hours they are gone.
  const evening = hour >= 12 ? 1 : 1 - smooth(0.5, 2.5, hour);
  const warm = season.summer + 0.6 * season.spring + 0.25 * season.autumn;
  out.fireflies = night * evening * dry * warm * (0.4 + 0.6 * calm) * (1 - 0.5 * weather.fog);
  out.stars = night * (1 - weather.cloud) * (1 - weather.fog) * dry * (0.3 + 0.7 * calm);
  const damp = 0.45 + 0.55 * season.autumn + 0.3 * season.spring + 0.2 * season.winter;
  out.mist = smooth(5, 6.3, hour) * (1 - smooth(7.3, 8.8, hour)) * (0.5 + 0.5 * calm) * damp * dry * 0.45;
  return out;
}
