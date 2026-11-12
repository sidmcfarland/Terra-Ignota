import './style.css';
import {
  Tile, TileCache, TileEdits, findSpawn, isWalkable, nextZone, signOp, step, worldSeed, zoneName, zoneOf,
  type PlayerInfo, type TileOp,
} from '@terra/shared';
import { inviteSpot, inviteUrl, loadConfig } from './config.ts';
import { DebugPanel } from './debug.ts';
import { HostingProfile } from './net/hosting.ts';
import { Input } from './input.ts';
import { Session } from './net/session.ts';
import { Store } from './net/store.ts';
import { GameView, type Player } from './render/view.ts';

const MIN_ZOOM = 8, MAX_ZOOM = 48;

async function main() {
  const cfg = loadConfig();
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
  const edits = new TileEdits();
  for (const op of await store.loadOps(cfg.world)) edits.merge(op);
  const tiles = new TileCache(worldSeed(cfg.world), 1024, edits);
  const view = new GameView(tiles);
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

  const info: PlayerInfo = { id: cfg.peerId, name: cfg.name, hue: cfg.hue };
  const input = new Input(view.canvas);
  let zoom = 20;
  view.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.pow(1.0015, -e.deltaY)));
  }, { passive: false });

  // The session follows the player across zone borders (see nextZone).
  let zone = zoneOf(self.x, self.y);
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
        onMerged: (op) => store.saveOp(cfg.world, op),
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
  const paint = async (x: number, y: number, tile: Tile | null): Promise<TileOp> => {
    const op = await signOp(cfg.world, identity, { x, y, tile, clock: edits.nextClock() });
    if (edits.merge(op)) store.saveOp(cfg.world, op);
    session?.publish(op);
    return op;
  };
  addEventListener('keydown', (e) => {
    if (e.repeat || e.key.toLowerCase() !== 'b' || e.target instanceof HTMLInputElement) return;
    const x = Math.floor(self.x + facing.x), y = Math.floor(self.y + facing.y);
    if (x === Math.floor(self.x) && y === Math.floor(self.y)) return;
    const cur = edits.get(x, y)?.tile;
    void paint(x, y, NEXT[cur === undefined || cur === null ? 'none' : cur] ?? null);
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
      debug.render({ seed: tiles.seed, zone, self, peerId: cfg.peerId, name: cfg.name, session, edits, author: identity.pub });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Test/debug hook.
  (window as unknown as { __ti: unknown }).__ti = { cfg, self, session, tiles, edits, paint, author: identity.pub };
}

void main();
