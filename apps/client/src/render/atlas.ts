import { CHUNK, Tile, TILE_COUNT, rand2, type TileCache } from '@terra/shared';

/** Texels per tile in chunk textures. */
export const RES = 4;

const BASE: Record<number, [number, number, number]> = {
  [Tile.DeepWater]: [29, 59, 92],
  [Tile.Water]: [47, 106, 143],
  [Tile.Sand]: [216, 198, 144],
  [Tile.Grass]: [92, 154, 70],
  [Tile.Forest]: [70, 128, 58],
  [Tile.Meadow]: [143, 179, 90],
  [Tile.Rock]: [138, 133, 119],
  [Tile.Snow]: [232, 238, 242],
};
if (Object.keys(BASE).length !== TILE_COUNT) throw new Error('missing tile colors');

const FLOWERS: Array<[number, number, number]> = [[230, 220, 120], [235, 150, 170], [240, 240, 240], [170, 150, 230]];

/**
 * Paints one chunk top-down at RES texels per tile. Kept from the original 2D
 * renderer for the planned shared atlas / map view (M5); not used in-game yet.
 */
export function paintChunk(tiles: TileCache, cx: number, cy: number): HTMLCanvasElement {
  const size = CHUNK * RES;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const seed = tiles.seed;
  const chunk = tiles.chunk(cx, cy);
  const ox = cx * CHUNK, oy = cy * CHUNK;

  const put = (px: number, py: number, c: [number, number, number], shade = 1) => {
    const i = (py * size + px) * 4;
    d[i] = Math.min(255, c[0] * shade);
    d[i + 1] = Math.min(255, c[1] * shade);
    d[i + 2] = Math.min(255, c[2] * shade);
    d[i + 3] = 255;
  };

  for (let ty = 0; ty < CHUNK; ty++) {
    for (let tx = 0; tx < CHUNK; tx++) {
      const t = chunk[ty * CHUNK + tx] as Tile;
      const wx = ox + tx, wy = oy + ty;
      const base = BASE[t];
      const tileShade = 0.94 + rand2(seed, wx, wy) * 0.12;
      for (let sy = 0; sy < RES; sy++) {
        for (let sx = 0; sx < RES; sx++) {
          const n = rand2(seed ^ 0x9e37, wx * RES + sx, wy * RES + sy);
          put(tx * RES + sx, ty * RES + sy, base, tileShade + (n - 0.5) * 0.06);
        }
      }
      const r = rand2(seed ^ 0x51ed, wx, wy);
      const px = tx * RES, py = ty * RES;
      if (t === Tile.Forest) {
        // Tree canopy: a dark blob with a highlight.
        const cxp = px + 1 + Math.floor(r * 2), cyp = py + 1 + Math.floor(r * 7) % 2;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) {
          const x = cxp + dx, y = cyp + dy;
          if (x >= px && x < px + RES && y >= py && y < py + RES) put(x, y, [42, 90, 39]);
        }
        put(cxp, cyp, [62, 120, 52]);
      } else if (t === Tile.Meadow && r < 0.35) {
        put(px + Math.floor(r * 40) % RES, py + Math.floor(r * 90) % RES, FLOWERS[Math.floor(r * 400) % FLOWERS.length]);
      } else if ((t === Tile.Water || t === Tile.DeepWater) && r < 0.2) {
        const y = py + Math.floor(r * 20) % RES;
        put(px + 1, y, base, 1.25);
        put(px + 2, y, base, 1.25);
      } else if (t === Tile.Rock && r < 0.5) {
        put(px + Math.floor(r * 30) % RES, py + Math.floor(r * 70) % RES, base, 0.75);
      } else if (t === Tile.Snow && r < 0.25) {
        put(px + Math.floor(r * 30) % RES, py + Math.floor(r * 70) % RES, [200, 214, 230]);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
