/**
 * Everything here decides terrain, and every device must compute the same terrain, so it uses only
 * arithmetic that is exact on every engine: + - * /, Math.floor, Math.abs, Math.imul and integer hashes.
 * No Math.sin, cos, pow or similar: engines are free to round those differently.
 */

// The 16 unit vectors at multiples of 22.5°, written out so no engine has to compute them.
const A = 0.9238795325112867, B = 0.7071067811865476, C = 0.3826834323650898;
const GX = new Float64Array([1, A, B, C, 0, -C, -B, -A, -1, -A, -B, -C, 0, C, B, A]);
const GY = new Float64Array([0, C, B, A, 1, A, B, C, 0, -C, -B, -A, -1, -A, -B, -C]);

/** Which of the 16 gradients a lattice point has. `h` is the seed mixed with the point's coordinates. */
function gradient(h: number): number {
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 15;
}

/** 2D gradient noise, roughly in [-1, 1]. Deterministic for a given seed, on every engine. */
export function perlin(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  // The same mix as `hash2` in rng.ts, with the per-axis products shared between corners.
  const ax0 = seed ^ Math.imul(x0 | 0, 0x27d4eb2d), ax1 = seed ^ Math.imul((x0 + 1) | 0, 0x27d4eb2d);
  const by0 = Math.imul(y0 | 0, 0x165667b1), by1 = Math.imul((y0 + 1) | 0, 0x165667b1);
  const g00 = gradient(ax0 ^ by0), g10 = gradient(ax1 ^ by0), g01 = gradient(ax0 ^ by1), g11 = gradient(ax1 ^ by1);
  const n00 = GX[g00] * fx + GY[g00] * fy;
  const n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const n01 = GX[g01] * fx + GY[g01] * (fy - 1);
  const n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.4142;
}

/** Fractal noise, roughly in [-1, 1]. */
export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin(seed + i * 1013, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
