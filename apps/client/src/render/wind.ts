/**
 * The wind: one shared field that everything growing leans into.
 * docs/ART_DIRECTION.md ("Wind") is the source of truth; change both together.
 *
 * Plain numbers only, like day.ts. The wind's direction and strength are read
 * from the wall clock, so every explorer feels the same breeze and nothing is
 * sent. Weather (milestone 5) will push this harder; on its own it wanders
 * between nearly still and a fresh breeze, and never stops entirely.
 */

export interface Wind {
  /** Unit direction the wind blows toward, in world (x, y). */
  x: number;
  y: number;
  /** 0 (still) to 1 (a gale). Fair weather stays between about 0.12 and 0.7. */
  strength: number;
}

/** The prevailing wind blows from the south-west, toward the north-east. */
const PREVAILING = -Math.PI / 4;

/** The wind at a wall-clock time. It shifts over minutes, never abruptly. */
export function windAt(epochMs: number, out: Wind = { x: 1, y: 0, strength: 0.4 }): Wind {
  // Each swing fits a whole number of times into 24 hours (every 18, 7, 10 and 4 minutes or so),
  // so the pattern repeats daily without a jump and the sines keep their precision.
  const t = ((epochMs % 86_400_000) / 86_400_000) * Math.PI * 2;
  const angle = PREVAILING + 0.55 * Math.sin(79 * t) + 0.3 * Math.sin(205 * t + 1.9);
  out.x = Math.cos(angle);
  out.y = Math.sin(angle);
  out.strength = 0.41 + 0.19 * Math.sin(142 * t + 0.6) + 0.1 * Math.sin(335 * t + 2.2);
  return out;
}

/** `#wind=`: a strength from 0 to 1 that holds the wind steady from the prevailing direction. Null follows the clock. */
export function parseWind(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

/** The steady wind `#wind=` asks for. */
export function steadyWind(strength: number, out: Wind = { x: 1, y: 0, strength }): Wind {
  out.x = Math.cos(PREVAILING);
  out.y = Math.sin(PREVAILING);
  out.strength = strength;
  return out;
}
