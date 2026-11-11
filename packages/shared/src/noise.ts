import { hash2 } from './rng.ts';

const GRADS: ReadonlyArray<readonly [number, number]> = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)] as const;
});

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D gradient noise, roughly in [-1, 1]. Deterministic for a given seed. */
export function perlin(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const dot = (ix: number, iy: number, dx: number, dy: number) => {
    const g = GRADS[hash2(seed, ix, iy) & 15];
    return g[0] * dx + g[1] * dy;
  };
  const u = fade(fx), v = fade(fy);
  const n00 = dot(x0, y0, fx, fy);
  const n10 = dot(x0 + 1, y0, fx - 1, fy);
  const n01 = dot(x0, y0 + 1, fx, fy - 1);
  const n11 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
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
