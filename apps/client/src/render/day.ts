/**
 * The day: what time it is, and the light at each hour.
 * docs/ART_DIRECTION.md ("Time of day") is the source of truth; change both together.
 *
 * Plain numbers only (no Three.js), so it can be unit-tested and read without a renderer.
 * Colours are linear RGB.
 *
 * Every explorer sees the same hour, because it is read from the wall clock and
 * not sent over the network. The sun is up from 6 to 18; the moon is up the rest
 * of the time and travels the same arc, so the terrain's baked shadows serve both.
 * The moon waxes and wanes over a month of eight days, and the night is as bright as it is full.
 */

/** One whole day and night, in real seconds. */
export const DAY_SECONDS = 48 * 60;
export const SUNRISE = 6, SUNSET = 18;

/**
 * How the hours are spent: [fraction of the real day, hour]. The day lingers at
 * dawn and through the golden hour, and hurries through noon and the small hours.
 */
const PACE: ReadonlyArray<readonly [number, number]> = [
  [0, 5.5], [0.1, 7.5], [0.3, 11], [0.4, 14], [0.55, 16], [0.72, 18.5], [0.8, 20], [1, 29.5],
];

/** The hour of the day (0–24) at a wall-clock time. */
export function hourAt(epochMs: number): number {
  const period = DAY_SECONDS * 1000;
  const phase = (((epochMs % period) + period) % period) / period;
  let i = 1;
  while (i < PACE.length - 1 && PACE[i][0] <= phase) i++;
  const [p0, h0] = PACE[i - 1], [p1, h1] = PACE[i];
  return (h0 + ((phase - p0) / (p1 - p0)) * (h1 - h0)) % 24;
}

/** The key lighting arrangements, by name, for `#time=` and for comparable screenshots. */
export const TIMES = {
  dawn: 6.7,
  morning: 9,
  noon: 12,
  afternoon: 15.33,
  golden: 16.8,
  sunset: 17.55,
  dusk: 18.5,
  night: 21.5,
} as const;

/** `#time=`: a name from TIMES or an hour such as 16.5. Null follows the clock. */
export function parseTime(s: string | null | undefined): number | null {
  if (!s) return null;
  if (s in TIMES) return TIMES[s as keyof typeof TIMES];
  const h = Number(s);
  return Number.isFinite(h) ? ((h % 24) + 24) % 24 : null;
}

/** Whether the moon is the key light at this hour, and where the key light is on its arc (0 rising, π setting). */
export function keyBody(hour: number): { moon: boolean; theta: number } {
  const moon = hour < SUNRISE || hour >= SUNSET;
  const since = moon ? (hour - SUNSET + 24) % 24 : hour - SUNRISE;
  return { moon, theta: (since / 12) * Math.PI };
}

/** A month: the moon goes from new to full and back in this many days, so each night has a phase of its own. */
export const MOON_DAYS = 8;

/** How much of the moon is lit, from 0 (new) to 1 (full), at a wall-clock time. */
export function moonAt(epochMs: number): number {
  const period = MOON_DAYS * DAY_SECONDS * 1000;
  const phase = (((epochMs % period) + period) % period) / period;
  return (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

/** The moon's phases by name, for `#moon=` and for comparable screenshots: how much of it is lit. */
export const MOONS = { new: 0, crescent: 0.15, half: 0.5, gibbous: 0.85, full: 1 } as const;

/** `#moon=`: a name from MOONS or how much is lit, 0 to 1. Null follows the clock. */
export function parseMoon(s: string | null | undefined): number | null {
  if (!s) return null;
  if (s in MOONS) return MOONS[s as keyof typeof MOONS];
  const lit = Number(s);
  return Number.isFinite(lit) ? Math.min(1, Math.max(0, lit)) : null;
}

export interface Light {
  /** Key light (sun or moon), sky fill from above and bounce from below: colour times strength. */
  key: [number, number, number];
  sky: [number, number, number];
  bounce: [number, number, number];
  /** How bright open, level ground is (luminance). The three lights are scaled together to meet it. */
  level: number;
  /** Colour saturation of the whole picture. */
  sat: number;
  /** How much the explorers' lanterns show, 0–1. */
  lamp: number;
  /** Softness of the terrain's shadow edge. */
  soft: number;
  /** Strength of the key light's glint on water. */
  glint: number;
}

type Row = [
  at: number, key: number, keyI: number, sky: number, skyI: number, bounce: number, bounceI: number,
  level: number, sat: number, lamp: number, soft: number, glint: number,
];

const MOON = 0xa9c4f0;
// The key light's colour changes hands while it is below the horizon (the paired rows at 6 and 18).
const ROWS: Row[] = [
  // hour   key       ×     sky       ×     bounce    ×     level sat   lamp  soft   glint
  [0,       MOON,     0.6,  0x6e86b8, 0.5,  0x3a4460, 0.3,  0.25, 0.74, 1,    0.075, 1.8], // moonlit night
  [4.9,     MOON,     0.6,  0x6e86b8, 0.5,  0x3a4460, 0.3,  0.25, 0.74, 1,    0.075, 1.8],
  [5.6,     MOON,     0.3,  0x8684c4, 0.7,  0x4a4868, 0.3,  0.34, 0.82, 0.7,  0.075, 1.2], // first light
  [5.99,    MOON,     0.3,  0xc2a2c6, 0.8,  0x7a6070, 0.3,  0.47, 0.9,  0.3,  0.06,  1],
  [6.01,    0xff9c6e, 1.2,  0xc2a2c6, 0.8,  0x7a6070, 0.3,  0.47, 0.9,  0.3,  0.06,  1],   // daybreak
  [6.7,     0xffb48a, 1.3,  0xb0b2e2, 0.72, 0xa07a6c, 0.3,  0.64, 0.96, 0,    0.05,  1.2], // dawn
  [8.5,     0xffefd6, 1.15, 0xb2d0ee, 0.66, 0x9c8c6c, 0.34, 0.86, 1,    0,    0.045, 1],   // morning
  [12,      0xfff4e2, 1,    0xb8d4f0, 0.7,  0xa49070, 0.4,  0.92, 1,    0,    0.04,  1],   // noon
  [15.33,   0xffe6be, 1.2,  0xb3cdec, 0.66, 0x9c8566, 0.34, 0.88, 1,    0,    0.045, 1],   // afternoon
  [16.8,    0xffcf96, 1.4,  0xaab8e2, 0.6,  0xa88462, 0.36, 0.74, 1.06, 0,    0.05,  1.3], // golden hour
  [17.55,   0xff9458, 2.1,  0xb8a8d0, 0.6,  0x9a6a5e, 0.34, 0.62, 1.08, 0,    0.06,  1.5], // sunset
  [17.99,   0xff7c4c, 1.8,  0xb79ac2, 0.75, 0x7a6070, 0.3,  0.46, 0.95, 0.5,  0.06,  1.2],
  [18.01,   MOON,     0.3,  0xb79ac2, 0.75, 0x7a6070, 0.3,  0.46, 0.92, 0.5,  0.06,  1.2], // sundown
  [18.6,    MOON,     0.3,  0x7c7ebe, 0.7,  0x4a4868, 0.3,  0.34, 0.84, 0.85, 0.075, 1.4], // dusk
  [19.4,    MOON,     0.6,  0x6e86b8, 0.5,  0x3a4460, 0.3,  0.25, 0.74, 1,    0.075, 1.8],
  [24,      MOON,     0.6,  0x6e86b8, 0.5,  0x3a4460, 0.3,  0.25, 0.74, 1,    0.075, 1.8],
];

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function rgb(hex: number, strength: number): [number, number, number] {
  return [
    linear(((hex >> 16) & 255) / 255) * strength,
    linear(((hex >> 8) & 255) / 255) * strength,
    linear((hex & 255) / 255) * strength,
  ];
}

const KEYS = ROWS.map((r) => ({
  at: r[0], key: rgb(r[1], r[2]), sky: rgb(r[3], r[4]), bounce: rgb(r[5], r[6]),
  level: r[7], sat: r[8], lamp: r[9], soft: r[10], glint: r[11],
}));

export function makeLight(): Light {
  return { key: [0, 0, 0], sky: [0, 0, 0], bounce: [0, 0, 0], level: 1, sat: 1, lamp: 0, soft: 0.045, glint: 1 };
}

/** The light at an hour, blended between the arrangements on either side of it. Not yet scaled to `level`. */
export function lightAt(hour: number, out: Light = makeLight()): Light {
  const h = ((hour % 24) + 24) % 24;
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i].at <= h) i++;
  const a = KEYS[i - 1], b = KEYS[i];
  const t = (h - a.at) / (b.at - a.at);
  const mix = (x: number, y: number) => x + (y - x) * t;
  for (let c = 0; c < 3; c++) {
    out.key[c] = mix(a.key[c], b.key[c]);
    out.sky[c] = mix(a.sky[c], b.sky[c]);
    out.bounce[c] = mix(a.bounce[c], b.bounce[c]);
  }
  out.level = mix(a.level, b.level);
  out.sat = mix(a.sat, b.sat);
  out.lamp = mix(a.lamp, b.lamp);
  out.soft = mix(a.soft, b.soft);
  out.glint = mix(a.glint, b.glint);
  return out;
}

/** Under a new moon the moon's own light falls to this share of a full moon's: starlight still gives the land its form. */
const NEW_MOON_KEY = 0.25;
/** The dead of night is this much darker under a new moon than under a full one. Night is never dark. */
const NEW_MOON_DIM = 0.28;
const DUSK_LEVEL = 0.46, NIGHT_LEVEL = 0.25;

/**
 * Bend a night's light to the moon's phase. `lit` is how much of the moon is lit (see moonAt). A full
 * moon changes nothing: the table above is a full-moon night. Under less moon the key light weakens and
 * its glint on water goes; the night darkens only as far as it is moonlight that lights it, so sundown
 * and first light are untouched and the dark comes on with the night.
 */
export function moonOn(light: Light, hour: number, lit: number): Light {
  const h = ((hour % 24) + 24) % 24;
  if (h >= SUNRISE && h < SUNSET) return light;
  const dark = 1 - Math.min(1, Math.max(0, lit));
  const k = 1 - (1 - NEW_MOON_KEY) * dark;
  for (let c = 0; c < 3; c++) light.key[c] *= k;
  const night = Math.min(1, Math.max(0, (DUSK_LEVEL - light.level) / (DUSK_LEVEL - NIGHT_LEVEL)));
  light.level *= 1 - NEW_MOON_DIM * dark * night;
  light.glint *= 1 - 0.9 * dark;
  return light;
}

export const luminance = (c: ArrayLike<number>) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
