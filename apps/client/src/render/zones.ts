import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineDashedMaterial, LineSegments } from 'three';
import { ZONE_MARGIN, ZONE_TILES, elevationAt } from '@terra/shared';
import { WATER_Y, heightFromElevation } from './terrain.ts';

/** Lines sit this far above the ground (or water) so they don't fight it for depth. */
const LIFT = 0.06;
/** Rebuild when the camera has moved this many tiles, not every frame. */
const STEP = 8;

const borderMat = new LineBasicMaterial({ color: 0xf4f1e6, transparent: true, opacity: 0.45, depthWrite: false });
const marginMat = new LineDashedMaterial({
  color: 0xf4f1e6, transparent: true, opacity: 0.32, depthWrite: false, dashSize: 1.5, gapSize: 1.5,
});

/**
 * Debug overlay: zone borders (solid) and the handoff margins either side of
 * them (dashed), draped over the terrain. Borders always fall on whole tiles,
 * so the lines run along tile edges and match the ground mesh exactly.
 */
export class ZoneLines {
  readonly group = new Group();
  private key = '';
  private borders: LineSegments | null = null;
  private margins: LineSegments | null = null;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.group.visible = false;
  }

  update(camX: number, camY: number, radius: number) {
    if (!this.group.visible) return;
    const key = `${Math.floor(camX / STEP)},${Math.floor(camY / STEP)},${Math.ceil(radius / STEP)}`;
    if (key === this.key) return;
    this.key = key;

    const r = Math.ceil(radius / STEP) * STEP + 2 * STEP;
    const x0 = Math.floor(camX - r), x1 = Math.ceil(camX + r);
    const y0 = Math.floor(camY - r), y1 = Math.ceil(camY + r);

    const border: number[] = [], margin: number[] = [];
    for (let k = Math.floor(x0 / ZONE_TILES) - 1; k <= Math.ceil(x1 / ZONE_TILES) + 1; k++) {
      const x = k * ZONE_TILES;
      if (x >= x0 && x <= x1) this.vertical(border, x, y0, y1);
      for (const m of [x - ZONE_MARGIN, x + ZONE_MARGIN]) if (m >= x0 && m <= x1) this.vertical(margin, m, y0, y1);
    }
    for (let k = Math.floor(y0 / ZONE_TILES) - 1; k <= Math.ceil(y1 / ZONE_TILES) + 1; k++) {
      const y = k * ZONE_TILES;
      if (y >= y0 && y <= y1) this.horizontal(border, y, x0, x1);
      for (const m of [y - ZONE_MARGIN, y + ZONE_MARGIN]) if (m >= y0 && m <= y1) this.horizontal(margin, m, x0, x1);
    }

    this.borders = this.replace(this.borders, border, borderMat);
    this.margins = this.replace(this.margins, margin, marginMat);
  }

  set visible(on: boolean) {
    if (on === this.group.visible) return;
    this.group.visible = on;
    this.key = ''; // Rebuild for wherever the camera is now.
  }

  private y(x: number, y: number): number {
    return Math.max(heightFromElevation(elevationAt(this.seed, x, y)), WATER_Y) + LIFT;
  }

  private vertical(out: number[], x: number, y0: number, y1: number) {
    for (let y = y0; y < y1; y++) out.push(x, this.y(x, y), y, x, this.y(x, y + 1), y + 1);
  }

  private horizontal(out: number[], y: number, x0: number, x1: number) {
    for (let x = x0; x < x1; x++) out.push(x, this.y(x, y), y, x + 1, this.y(x + 1, y), y);
  }

  private replace(old: LineSegments | null, pts: number[], mat: LineBasicMaterial | LineDashedMaterial) {
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
    }
    if (pts.length === 0) return null;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    const lines = new LineSegments(geo, mat);
    if (mat instanceof LineDashedMaterial) lines.computeLineDistances();
    lines.renderOrder = 1; // After the semi-transparent water, so lines over water stay visible.
    this.group.add(lines);
    return lines;
  }
}
