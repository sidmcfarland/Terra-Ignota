/**
 * The clock ops are dated by: the device's wall clock in unix seconds, plus an
 * optional shift for testing (the `#now=+45d` hash parameter, or `NOW=+45d` for
 * the seed), so expiry and decay can be seen without waiting.
 */

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * A clock shift such as `+45d`, `-2h`, `+90m` or `30s`, in seconds. 0 for
 * nothing, or for anything that isn't one.
 */
export function parseClockShift(s: string | null | undefined): number {
  const m = /^([+-]?)(\d{1,9})([smhd])$/.exec((s ?? '').trim());
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * Number(m[2]) * UNIT_SECONDS[m[3]];
}

/** A clock in unix seconds, `shift` seconds ahead of the device's. */
export function wallClock(shift = 0): () => number {
  return () => Math.floor(Date.now() / 1000) + shift;
}
