import { Tile, findSpawn, groundAt, heightOf, newGround, terrainHash, tileAt, tileAtFlat, worldSeed } from '@terra/shared';
import { tileColor } from './render/atlas.ts';

/**
 * A top-down overview of a world's generated terrain, for judging worldgen: `#map=1&w=<world>`.
 * Optional: `scale=<tiles per pixel>` (1-64, default 4) and `at=x,y` (centre; default the spawn).
 * Click to recentre, keys 1-7 or the buttons to change scale, "Walk here" opens the game at the centre.
 * It paints generated tiles only (no edits) in the atlas's flat colours, shaded by slope. Up to 4 tiles
 * per pixel every pixel is a real tile; beyond that cliffs are too thin to show, so each pixel is the
 * tile its spot would be on level ground (one sample instead of four), and relief shows in the shading.
 */

/** Above this many tiles per pixel, cliffs are not drawn. */
const CLIFFS_UP_TO = 4;

const SCALES = [1, 2, 4, 8, 16, 32, 64];
const NAMES = Object.fromEntries(Object.entries(Tile).map(([name, id]) => [id, name])) as Record<number, string>;

export function showOverview(world: string) {
  const seed = worldSeed(world);
  const params = new URLSearchParams(location.hash.slice(1));
  for (const id of ['hud', 'stick', 'debug', 'game']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  addEventListener('hashchange', () => location.reload());

  const spawn = findSpawn(seed);
  const at = (params.get('at') ?? '').split(',').map(Number);
  let cx = at.length === 2 && at.every(Number.isFinite) ? Math.floor(at[0]) : Math.floor(spawn.x);
  let cy = at.length === 2 && at.every(Number.isFinite) ? Math.floor(at[1]) : Math.floor(spawn.y);
  let scale = Math.min(64, Math.max(1, Math.floor(Number(params.get('scale')) || 4)));

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;image-rendering:pixelated;cursor:crosshair;background:#16222e';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:10px;left:10px;max-width:250px;padding:10px 12px;border-radius:8px;font:12px/1.45 system-ui,sans-serif;' +
    'color:#2e2418;background:rgba(244,236,216,0.93);box-shadow:0 1px 6px rgba(0,0,0,0.35)';
  document.body.appendChild(panel);
  const head = document.createElement('div');
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0';
  const hover = document.createElement('div');
  hover.style.minHeight = '1.45em';
  const legend = document.createElement('div');
  legend.style.marginTop = '6px';
  panel.append(head, buttons, hover, legend);

  const button = (label: string, title: string, go: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'font:inherit;padding:2px 7px;border:1px solid #8a7a5c;border-radius:4px;background:#fffaf0;color:inherit;cursor:pointer';
    b.onclick = go;
    buttons.appendChild(b);
    return b;
  };
  const scaleButtons = SCALES.map((s) => button(String(s), `${s} tile${s > 1 ? 's' : ''} per pixel`, () => show(cx, cy, s)));
  button('Spawn', 'Centre on the spawn', () => show(Math.floor(spawn.x), Math.floor(spawn.y), scale));
  button('Walk here', 'Open the game at the centre of this view', () => {
    location.hash = `w=${world}&at=${cx},${cy}`;
  });

  const state = { done: false, world, seed, cx, cy, scale, across: 0, ms: 0, share: {} as Record<string, number> };
  (window as unknown as { __ti: unknown }).__ti = {
    map: state,
    terrainHash: (w: string) => terrainHash(worldSeed(w)),
    show: (x: number, y: number, s: number) => show(x, y, s),
  };

  const g = newGround();
  let job = 0;

  function show(x: number, y: number, s: number) {
    cx = x; cy = y; scale = s;
    const p = new URLSearchParams({ map: '1', w: world, scale: String(s), at: `${x},${y}` });
    history.replaceState(null, '', `#${p.toString().replace('%2C', ',')}`);
    paint();
  }

  function paint() {
    const mine = ++job;
    const w = (canvas.width = innerWidth), h = (canvas.height = innerHeight);
    // From 4 tiles per pixel up, pixels sit on the generator's lattice, which is much cheaper to sample.
    const snap = scale >= 4 ? 4 : 1;
    const x0 = Math.floor((cx - Math.floor(w / 2) * scale) / snap) * snap, y0 = Math.floor((cy - Math.floor(h / 2) * scale) / snap) * snap;
    const kind = scale <= CLIFFS_UP_TO ? tileAt : tileAtFlat;
    // Heights of the row above, for shading.
    let above = new Float32Array(w + 1), here = new Float32Array(w + 1);
    const counts = new Map<number, number>();
    Object.assign(state, { done: false, cx, cy, scale, across: w * scale, share: {} });
    scaleButtons.forEach((b, i) => (b.style.fontWeight = SCALES[i] === scale ? '700' : '400'));
    head.innerHTML = '';
    head.append(
      Object.assign(document.createElement('b'), { textContent: `Terrain of “${world}”` }),
      document.createElement('br'),
      `${(w * scale).toLocaleString()} × ${(h * scale).toLocaleString()} tiles, ${scale} per pixel`,
      document.createElement('br'),
      `centre ${cx}, ${cy} · spawn ${Math.floor(spawn.x)}, ${Math.floor(spawn.y)}`,
      ...(scale > CLIFFS_UP_TO ? [document.createElement('br'), 'cliffs are too thin to draw at this scale'] : []),
    );
    legend.textContent = 'painting…';
    const started = performance.now();
    let row = 0;

    const slice = () => {
      if (mine !== job) return;
      const t0 = performance.now(), first = row;
      const rows: ImageData[] = [];
      while (row < h && performance.now() - t0 < 20) {
        const img = ctx.createImageData(w, 1), d = img.data;
        const y = y0 + row * scale;
        for (let i = 0; i < w; i++) {
          const x = x0 + i * scale;
          const t = kind(seed, x, y);
          counts.set(t, (counts.get(t) ?? 0) + 1);
          // Shade by slope, lit from the north-west: ground that rises away from the light is bright. Water is flat.
          groundAt(seed, x, y, g);
          const a = (here[i + 1] = Math.max(0, heightOf(g.u)));
          const shade = row === 0 || i === 0 ? 1 : Math.min(1.3, Math.max(0.6, 1 + (0.55 * (a - above[i])) / scale));
          const c = tileColor(t), o = i * 4;
          d[o] = c[0] * shade; d[o + 1] = c[1] * shade; d[o + 2] = c[2] * shade; d[o + 3] = 255;
        }
        rows.push(img);
        row++;
        [above, here] = [here, above];
      }
      rows.forEach((img, k) => ctx.putImageData(img, 0, first + k));
      if (row < h) return void setTimeout(slice, 0);

      // The spawn, ringed.
      const sx = (Math.floor(spawn.x) - x0) / scale, sy = (Math.floor(spawn.y) - y0) / scale;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 6.2832); ctx.stroke();

      const total = w * h;
      legend.innerHTML = '';
      for (const [t, n] of [...counts].sort((p, q) => q[1] - p[1])) {
        const c = tileColor(t), line = document.createElement('div');
        const swatch = document.createElement('span');
        swatch.style.cssText = `display:inline-block;width:10px;height:10px;margin-right:6px;border:1px solid rgba(0,0,0,0.3);background:rgb(${c[0]},${c[1]},${c[2]})`;
        const pct = (100 * n) / total;
        line.append(swatch, `${NAMES[t]} ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%`);
        legend.appendChild(line);
        state.share[NAMES[t]] = n / total;
      }
      state.ms = performance.now() - started;
      state.done = true;
    };
    slice();
  }

  const tileUnder = (e: MouseEvent): [number, number] => [
    cx + (Math.floor(e.clientX) - Math.floor(canvas.width / 2)) * scale,
    cy + (Math.floor(e.clientY) - Math.floor(canvas.height / 2)) * scale,
  ];
  canvas.addEventListener('mousemove', (e) => {
    const [x, y] = tileUnder(e);
    hover.textContent = `${x}, ${y}: ${NAMES[tileAt(seed, x, y)]}`;
  });
  canvas.addEventListener('click', (e) => {
    const [x, y] = tileUnder(e);
    show(x, y, scale);
  });
  addEventListener('keydown', (e) => {
    const i = Number(e.key) - 1;
    if (i >= 0 && i < SCALES.length) show(cx, cy, SCALES[i]);
  });
  let resize = 0;
  addEventListener('resize', () => {
    clearTimeout(resize);
    resize = window.setTimeout(paint, 200);
  });
  paint();
}
