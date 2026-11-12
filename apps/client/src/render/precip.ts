import { BufferAttribute, BufferGeometry, Mesh, Vector4 } from 'three';
import { rand2 } from '@terra/shared';
import { precipMaterial } from './look.ts';
import type { Weather } from './weather.ts';
import type { Wind } from './wind.ts';

/** Streaks in the air at the heaviest. One draw call; the budget is 500 particles. */
const COUNT = 480;
/** How tall the box of falling weather is, in tiles. */
const HEIGHT = 14;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Rain and snow: one mesh of little quads that fall through a box around the
 * explorer and wrap when they leave it. The vertex shader places every one, so
 * a frame costs the CPU a handful of multiplications however hard it rains.
 * Rain is long, thin, fast and slanted by the wind; snow is small, slow and
 * wanders. Rain turning to snow is a blend between the two.
 */
export class Precipitation {
  readonly mesh: Mesh;
  private readonly fall = new Vector4(0, -1, 0, 0);
  private readonly shape = new Vector4();
  private readonly box = new Vector4(60, HEIGHT, 60, 0);
  private readonly drift = new Vector4(0, 0, 0, 1);

  constructor() {
    const pos = new Float32Array(COUNT * 12), uv = new Float32Array(COUNT * 8), seed = new Float32Array(COUNT * 16);
    const index: number[] = [];
    for (let i = 0; i < COUNT; i++) {
      const sx = rand2(11, i, 0), sy = rand2(12, i, 0), sz = rand2(13, i, 0), rank = (i + 0.5) / COUNT;
      for (let c = 0; c < 4; c++) {
        uv.set([c & 1, c >> 1], (i * 4 + c) * 2);
        seed.set([sx, sy, sz, rank], (i * 4 + c) * 4);
      }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setAttribute('aSeed', new BufferAttribute(seed, 4));
    geo.setIndex(index);
    this.mesh = new Mesh(geo, precipMaterial(this.fall, this.shape, this.box, this.drift));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** `floor` is the height of the ground under the explorer; `radius` is how far the view reaches, in tiles. */
  update(weather: Weather, wind: Wind, floor: number, radius: number, dt: number) {
    const amount = Math.max(weather.rain, weather.snow);
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    const snow = weather.snow / (weather.rain + weather.snow);
    const push = mix(7, 2.2, snow) * wind.strength;
    const vx = wind.x * push, vy = -mix(15, 1.7, snow), vz = wind.y * push;
    const speed = Math.hypot(vx, vy, vz);
    this.fall.set(vx / speed, vy / speed, vz / speed, amount);
    // Length, half width, opacity, and how far a flake wanders sideways.
    this.shape.set(mix(0.9, 0.09, snow), mix(0.018, 0.045, snow), mix(0.3, 0.85, snow), mix(0, 0.35, snow));
    // The box is a little smaller than the view, so the same drops come round again across the screen.
    // That keeps the air full for 480 streaks, and falling rain does not show the repeat.
    const size = Math.min(70, Math.max(24, radius * 1.15));
    this.box.set(size, HEIGHT, size, floor - 1);
    // Added up frame by frame, so a change in the wind bends the fall instead of jumping it.
    const d = this.drift;
    d.x = (d.x + vx * dt) % size;
    d.y = (d.y + vy * dt) % HEIGHT;
    d.z = (d.z + vz * dt) % size;
    d.w = mix(1, 1.7, snow);
  }
}
