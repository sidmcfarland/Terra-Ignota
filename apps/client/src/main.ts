import './style.css';
import {
  LAYERS, OpStore, Tile, TileCache, ZONE_TILES, findSpawn, isWalkable, nextZone, parseClockShift, signOp, step, wallClock,
  worldSeed, zoneName, zoneOf,
  type Layer, type Op, type PlayerInfo, type Value,
} from '@terra/shared';
import { inviteSpot, inviteUrl, loadConfig } from './config.ts';
import { DebugPanel } from './debug.ts';
import { HostingProfile } from './net/hosting.ts';
import { Input } from './input.ts';
import { RegionLoader } from './regions.ts';
import { Session } from './net/session.ts';
import { Store } from './net/store.ts';
import { parseMoon, parseTime } from './render/day.ts';
import { GameView, type Player } from './render/view.ts';
import { parseSeason } from './render/weather.ts';
import { parseWind } from './render/wind.ts';

const MIN_ZOOM = 8, MAX_ZOOM = 48;
/** Drainage regions within this many tiles of the player are computed ahead: well past what the view shows. */
const REGION_AHEAD = 640;

async function main() {
  const cfg = loadConfig();
  // `#map=1` shows the top-down terrain overview instead of the game.
  if (new URLSearchParams(location.hash.slice(1)).get('map') === '1') return (await import('./overview.ts')).showOverview(cfg.world);
  addEventListener('hashchange', () => {
    if (new URLSearchParams(location.hash.slice(1)).get('w') !== cfg.world) location.reload();
  });

  // `#render=0` runs the game loop without drawing. The e2e tests use it: headless
  // Chromium rasterises WebGL on the CPU, which starves the networking timers.
  const draw = new URLSearchParams(location.hash.slice(1)).get('render') !== '0';

  // This device's identity and its replica of the world's edits, from IndexedDB.
  // Ops were verified before they were stored, so they load without re-checking.
  const store = await Store.open();
  const identity = await store.identity();
  // `#now=+45d` shifts the clock that dates ops and expires them, so decay can be seen without waiting.
  const clockShift = parseClockShift(new URLSearchParams(location.hash.slice(1)).get('now'));
  const edits = new OpStore(wallClock(clockShift));
  // An op that doesn't load has expired since it was stored.
  for (const op of await store.loadOps(cfg.world)) if (!edits.merge(op)) store.deleteOp(cfg.world, op);
  // Another player's own ops (a purse this device held while hosting them) are kept in memory only.
  const keep = (op: Op) => LAYERS[op.l].scope !== 'player' || op.author === identity.pub;
  /** Ops of ours the host refused, newest last: for the debug hook. */
  const rejects: Array<{ op: Op; why: string }> = [];
  const tiles = new TileCache(worldSeed(cfg.world), 1024, edits);
  // Rivers and lakes are simulated a region at a time. A worker gets the regions near the player ready
  // ahead of need (first the ones the game starts in); one that isn't ready is computed on the spot.
  const regions = new RegionLoader(tiles.seed);
  const start = inviteSpot() ?? { x: ZONE_TILES / 2, y: ZONE_TILES / 2 };
  await regions.around(start.x, start.y, REGION_AHEAD);
  // `#chunks=main` builds chunk meshes on the main thread, as the game did before it had a worker for them:
  // for comparing the two on a device.
  const view = new GameView(tiles, regions, new URLSearchParams(location.hash.slice(1)).get('chunks') !== 'main');
  // `#time=dawn` (or an hour, `#time=16.5`) holds the light still; without it the day follows the clock.
  view.setHour(parseTime(new URLSearchParams(location.hash.slice(1)).get('time')));
  // `#moon=new` (or how much is lit, `#moon=0.3`) holds the moon's phase, which sets how bright the night is.
  view.setMoon(parseMoon(new URLSearchParams(location.hash.slice(1)).get('moon')));
  // `#wind=0.8` holds the wind at a strength (0 to 1); without it the wind wanders with the clock.
  view.setWind(parseWind(new URLSearchParams(location.hash.slice(1)).get('wind')));
  // `#weather=rain` and `#season=autumn` hold the sky and the year in the same way.
  view.setWeather(new URLSearchParams(location.hash.slice(1)).get('weather'));
  // `#pr=1.5` holds the canvas at a pixel ratio; without it the ratio follows the measured frame time.
  const pr = Number(new URLSearchParams(location.hash.slice(1)).get('pr'));
  if (pr > 0) view.setPixelRatio(pr);
  view.setSeason(parseSeason(new URLSearchParams(location.hash.slice(1)).get('season')));
  document.getElementById('game')!.appendChild(view.canvas);

  // Spawn at the invite spot if walkable, else the world spawn; jitter so
  // players don't stack exactly.
  const spot = inviteSpot();
  const base = spot && isWalkable(tiles.get(Math.floor(spot.x), Math.floor(spot.y))) ? spot : findSpawn(tiles.seed);
  const self = { x: base.x, y: base.y };
  for (let i = 0; i < 20; i++) {
    const x = base.x + (Math.random() - 0.5) * 4, y = base.y + (Math.random() - 0.5) * 4;
    if (isWalkable(tiles.get(Math.floor(x), Math.floor(y)))) {
      self.x = x;
      self.y = y;
      break;
    }
  }

  setInterval(() => void regions.around(self.x, self.y, REGION_AHEAD), 1000);

  const info: PlayerInfo = { id: cfg.peerId, name: cfg.name, hue: cfg.hue };
  let zoom = 20;
  const zoomBy = (factor: number) => (zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor)));
  // Zoom: the wheel with a mouse, a pinch with two fingers.
  const input = new Input(view.canvas, zoomBy);
  view.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(Math.pow(1.0015, -e.deltaY));
  }, { passive: false });

  // The session follows the player across zone borders (see nextZone). It starts in the zone of the
  // spot players arrive at, not of where this one happened to be set down around it: a spawn can lie
  // right on a zone border, and players who arrive together must not start in two zones, each hosting
  // its own. (A zone holds its players up to a chunk outside it, so the few tiles don't matter.)
  let zone = zoneOf(base.x, base.y);
  const profile = new HostingProfile(cfg.peerId);
  const hostBtn = document.getElementById('hostBtn') as HTMLButtonElement;
  const showHosting = () => {
    hostBtn.textContent = profile.optIn ? 'Hosting on' : 'Hosting off';
    hostBtn.setAttribute('aria-pressed', String(profile.optIn));
  };
  hostBtn.onclick = () => {
    profile.setOptIn(!profile.optIn);
    showHosting();
  };
  showHosting();

  const session = cfg.signalUrl
    ? new Session({
        signalUrl: cfg.signalUrl,
        world: cfg.world,
        zone,
        peerId: cfg.peerId,
        info,
        identity,
        edits,
        onMerged: (op) => keep(op) && store.saveOp(cfg.world, op),
        onRemoved: (op) => store.deleteOp(cfg.world, op),
        onRejected: (op, why) => {
          rejects.push({ op, why });
          if (rejects.length > 32) rejects.shift();
        },
        profile,
        iceServers: cfg.iceServers,
        tiles: tiles.get,
        getSelf: () => self,
        // How far the screen shows at this zoom (the radius GameView draws to); the host sends players within it.
        getView: () => Math.hypot(innerWidth, innerHeight * Math.sqrt(3)) / zoom / 2,
      })
    : null;

  // B paints the tile in front of you: path, then wall, then back to the original.
  // (Not the tile you're on: a wall there would trap you.)
  let facing = { x: 0, y: 1 };
  const NEXT: Record<string, Tile | null> = { none: Tile.Path, [Tile.Path]: Tile.Wall, [Tile.Wall]: null };
  // Every lasting change is an op in some layer: signed, merged here first, then passed on. If the host
  // refuses it, the session takes it back and what it displaced stands again.
  const put = async (l: Layer, x: number, y: number, v: Value | null): Promise<Op> => {
    const op = await signOp(cfg.world, identity, { l, x, y, v, clock: edits.nextClock(), at: edits.now() });
    const prev = edits.current(op) ?? null;
    if (edits.merge(op)) {
      store.saveOp(cfg.world, op);
      session?.publish(op, prev);
    }
    return op;
  };
  const paint = (x: number, y: number, tile: Tile | null) => put('tile', x, y, tile);
  addEventListener('keydown', (e) => {
    if (e.repeat || e.key.toLowerCase() !== 'b' || e.target instanceof HTMLInputElement) return;
    const x = Math.floor(self.x + facing.x), y = Math.floor(self.y + facing.y);
    if (x === Math.floor(self.x) && y === Math.floor(self.y)) return;
    const cur = edits.tile(x, y);
    void paint(x, y, NEXT[cur === null ? 'none' : cur] ?? null);
  });

  const status = document.getElementById('status')!;
  const debug = new DebugPanel(document.getElementById('debug')!, document.getElementById('debugBtn') as HTMLButtonElement);
  const inviteBtn = document.getElementById('invite') as HTMLButtonElement;
  inviteBtn.onclick = async () => {
    const url = inviteUrl(cfg.world, self);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Terra Ignota', url });
      else await navigator.clipboard.writeText(url);
      inviteBtn.textContent = 'Copied!';
    } catch {
      prompt('Invite link:', url);
    }
    setTimeout(() => (inviteBtn.textContent = 'Copy invite link'), 1500);
  };

  let hudT = 0, lastT = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    const dir = view.toWorld(input.dir());
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0.1) facing = { x: dir.x / len, y: dir.y / len };
    const next = step(tiles.get, self, dir, dt);
    self.x = next.x;
    self.y = next.y;
    zone = nextZone(zone, self.x, self.y);
    session?.setZone(zone);

    const players: Player[] = [];
    if (session) {
      for (const r of session.remotes.values()) {
        const p = session.sample(r, now);
        if (p) players.push({ info: r.info, x: p.x, y: p.y, self: false });
      }
    }
    players.push({ info, x: self.x, y: self.y, self: true });
    if (draw) {
      view.showZones = debug.visible;
      view.frame(self, players, zoom);
    }

    if (now - hudT > 250) {
      hudT = now;
      const net = !session
        ? 'solo (no signaling server configured)'
        : `${session.role}${session.role === 'host' || session.role === 'client' ? ` · ${session.playerCount} here` : ''}`;
      status.textContent =
        `world ${cfg.world} · zone ${zone} ${zoneName(tiles.seed, zone)}\n${net}\n` +
        `${cfg.name} @ ${Math.floor(self.x)}, ${Math.floor(self.y)}\nQ / E rotate view · B paint · F3 debug`;
      debug.render({
        seed: tiles.seed, zone, self, peerId: cfg.peerId, name: cfg.name, session, edits, author: identity.pub, clockShift,
        perf: draw ? view.perf : null,
        hour: draw ? view.hour : null,
        moon: draw ? view.moon : null,
        wind: draw ? view.wind.strength : null,
        weather: draw ? view.weather : null,
        season: draw ? view.season : null,
      });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Test/debug hook.
  (window as unknown as { __ti: unknown }).__ti = {
    cfg, self, session, tiles, edits, paint, put, rejects, clockShift, author: identity.pub, view,
    setZoom: (z: number) => (zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))),
    getZoom: () => zoom,
  };
}

void main();
