import { Container, Sprite, Texture } from 'pixi.js';
import { CHUNK, Tile, TILE_COUNT, rand2, type TileCache } from '@terra/shared';

/** Texels per tile in chunk textures. */
const RES = 4;
const MAX_BUILDS_PER_FRAME = 4;

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

function paintChunk(tiles: TileCache, cx: number, cy: number): Texture {
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
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/** Streams chunk sprites around the camera. Container is in tile units. */
export class Terrain {
  readonly container = new Container();
  private sprites = new Map<string, Sprite>();

  private readonly tiles: TileCache;

  constructor(tiles: TileCache) {
    this.tiles = tiles;
  }

  update(camX: number, camY: number, viewW: number, viewH: number) {
    const x0 = Math.floor((camX - viewW / 2) / CHUNK) - 1, x1 = Math.floor((camX + viewW / 2) / CHUNK) + 1;
    const y0 = Math.floor((camY - viewH / 2) / CHUNK) - 1, y1 = Math.floor((camY + viewH / 2) / CHUNK) + 1;
    const ccx = Math.floor(camX / CHUNK), ccy = Math.floor(camY / CHUNK);

    // Build nearest-first, a few per frame.
    const missing: Array<[number, number]> = [];
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!this.sprites.has(`${cx},${cy}`)) missing.push([cx, cy]);
    }
    missing.sort((a, b) => Math.hypot(a[0] - ccx, a[1] - ccy) - Math.hypot(b[0] - ccx, b[1] - ccy));
    for (const [cx, cy] of missing.slice(0, MAX_BUILDS_PER_FRAME)) {
      const s = new Sprite(paintChunk(this.tiles, cx, cy));
      s.position.set(cx * CHUNK, cy * CHUNK);
      s.scale.set(1 / RES);
      this.container.addChild(s);
      this.sprites.set(`${cx},${cy}`, s);
    }

    // Unload chunks well outside the view.
    for (const [key, s] of this.sprites) {
      const cx = s.x / CHUNK, cy = s.y / CHUNK;
      if (cx < x0 - 2 || cx > x1 + 2 || cy < y0 - 2 || cy > y1 + 2) {
        s.destroy({ texture: true, textureSource: true });
        this.sprites.delete(key);
      }
    }
  }
}
