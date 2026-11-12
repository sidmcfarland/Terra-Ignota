import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Vector4,
} from 'three';
import { rand2 } from '@terra/shared';
import type { Air } from './air.ts';
import { motesMaterial } from './look.ts';
import type { Wind } from './wind.ts';

/** Motes in the air at the most. One draw call. With the rain (which clears them) the total stays under 500. */
const COUNT = 160;
const DUST = 0, LEAVES = 1, FIREFLIES = 2;

/**
 * The small things that hang in the air near the ground: dust and pollen in
 * sunlight, leaves coming down in autumn, fireflies on warm nights. One kind
 * shows at a time; one gives way to the next by thinning to nothing first.
 *
 * Each mote keeps to a spot on the ground inside a box that wraps around the
 * explorer. The CPU only finds the height of the ground at each spot (160
 * lookups a frame); the vertex shader does the wandering, falling and blinking.
 */
export class Motes {
  readonly mesh: Mesh;
  private readonly mote = new Vector4(0, DUST, 0, 0);
  private readonly base = new Float32Array(COUNT * 3);
  private readonly seed = new Float32Array(COUNT * 4);
  private readonly baseAttr: InstancedBufferAttribute;
  private driftX = 0;
  private driftZ = 0;

  constructor() {
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    for (let i = 0; i < COUNT; i++) for (let c = 0; c < 4; c++) this.seed[i * 4 + c] = rand2(21 + c, i, 0);
    geo.setAttribute('aSeed', new InstancedBufferAttribute(this.seed, 4));
    this.baseAttr = new InstancedBufferAttribute(this.base, 3);
    this.baseAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('aBase', this.baseAttr);
    geo.instanceCount = COUNT;
    this.mesh = new Mesh(geo, motesMaterial(this.mote));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * `heightAt` gives the height of the ground (world x, y); `floor` is the lowest a mote may sit (the water).
   * `radius` is how far the view reaches, in tiles.
   */
  update(
    air: Air, wind: Wind, focus: { x: number; y: number }, radius: number, dt: number,
    heightAt: (x: number, y: number) => number, floor: number,
  ) {
    // By day the air holds dust, or leaves in autumn; by night, fireflies. Whichever there is more of shows,
    // less the other, so the change from one to the next passes through empty air.
    const day = Math.max(air.dust, air.leaves), night = air.fireflies;
    const amount = Math.abs(day - night);
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    const kind = night > day ? FIREFLIES : air.leaves > air.dust ? LEAVES : DUST;
    this.mote.set(amount, kind, 0, 0);

    // Dust and leaves go with the wind; fireflies hold their ground.
    const size = Math.min(44, Math.max(18, radius * 1.1));
    const carry = kind === FIREFLIES ? 0 : kind === LEAVES ? 0.5 : 1.2;
    this.driftX = (this.driftX + wind.x * wind.strength * carry * dt) % size;
    this.driftZ = (this.driftZ + wind.y * wind.strength * carry * dt) % size;
    const base = this.base, seed = this.seed, half = size / 2;
    for (let i = 0; i < COUNT; i++) {
      // Wrap around the explorer, so a mote stays put in the world as the explorer walks.
      let x = (seed[i * 4] * size + this.driftX - focus.x) % size;
      let z = (seed[i * 4 + 1] * size + this.driftZ - focus.y) % size;
      if (x < 0) x += size;
      if (z < 0) z += size;
      x += focus.x - half;
      z += focus.y - half;
      base[i * 3] = x;
      base[i * 3 + 1] = Math.max(heightAt(x, z), floor);
      base[i * 3 + 2] = z;
    }
    this.baseAttr.needsUpdate = true;
  }
}
