import './style.css';
import { Application, Container } from 'pixi.js';
import { TileCache, findSpawn, isWalkable, step, worldSeed, zoneOf, type PlayerInfo } from '@terra/shared';
import { inviteSpot, inviteUrl, loadConfig } from './config.ts';
import { Input } from './input.ts';
import { Session } from './net/session.ts';
import { Avatars } from './render/avatars.ts';
import { Terrain } from './render/terrain.ts';

const MIN_ZOOM = 8, MAX_ZOOM = 48;

async function main() {
  const cfg = loadConfig();
  addEventListener('hashchange', () => {
    if (new URLSearchParams(location.hash.slice(1)).get('w') !== cfg.world) location.reload();
  });

  const tiles = new TileCache(worldSeed(cfg.world));
  const app = new Application();
  await app.init({ resizeTo: window, background: '#0e1a24', antialias: true, autoDensity: true, resolution: devicePixelRatio });
  document.getElementById('game')!.appendChild(app.canvas);

  const world = new Container();
  const terrain = new Terrain(tiles);
  world.addChild(terrain.container);
  const avatars = new Avatars();
  app.stage.addChild(world, avatars.container);

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
  const input = new Input(app.canvas);
  let zoom = 24;
  app.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.pow(1.0015, -e.deltaY)));
  }, { passive: false });

  // M2: one session for the zone you spawned in. Zone handoff comes in M3.
  const zone = zoneOf(base.x, base.y);
  const session = cfg.signalUrl
    ? new Session({
        signalUrl: cfg.signalUrl,
        world: cfg.world,
        zone,
        peerId: cfg.peerId,
        info,
        iceServers: cfg.iceServers,
        tiles: tiles.get,
        getSelf: () => self,
      })
    : null;

  const status = document.getElementById('status')!;
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

  let hudT = 0;
  app.ticker.add((t) => {
    const dt = Math.min(t.deltaMS / 1000, 0.1);
    const next = step(tiles.get, self, input.dir(), dt);
    self.x = next.x;
    self.y = next.y;

    const w = app.screen.width, h = app.screen.height;
    world.scale.set(zoom);
    world.position.set(Math.round(w / 2 - self.x * zoom), Math.round(h / 2 - self.y * zoom));
    terrain.update(self.x, self.y, w / zoom, h / zoom);

    const now = performance.now();
    avatars.begin();
    if (session) {
      for (const r of session.remotes.values()) {
        const p = session.sample(r, now);
        if (p) avatars.draw(r.info, w / 2 + (p.x - self.x) * zoom, h / 2 + (p.y - self.y) * zoom, zoom, false);
      }
    }
    avatars.draw(info, w / 2, h / 2, zoom, true);
    avatars.end();

    if (now - hudT > 250) {
      hudT = now;
      const net = !session
        ? 'solo (no signaling server configured)'
        : `${session.role}${session.role === 'host' || session.role === 'client' ? ` · ${session.playerCount} here` : ''}`;
      status.textContent = `world ${cfg.world} · zone ${zone}\n${net}\n${cfg.name} @ ${Math.floor(self.x)}, ${Math.floor(self.y)}`;
    }
  });

  // Test/debug hook.
  (window as unknown as { __ti: unknown }).__ti = { cfg, self, session };
}

void main();
