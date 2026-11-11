import './style.css';
import { TileCache, findSpawn, isWalkable, nextZone, step, worldSeed, zoneOf, type PlayerInfo } from '@terra/shared';
import { inviteSpot, inviteUrl, loadConfig } from './config.ts';
import { Input } from './input.ts';
import { Session } from './net/session.ts';
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

  const tiles = new TileCache(worldSeed(cfg.world));
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

  let hudT = 0, lastT = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    const next = step(tiles.get, self, view.toWorld(input.dir()), dt);
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
    if (draw) view.frame(self, players, zoom);

    if (now - hudT > 250) {
      hudT = now;
      const net = !session
        ? 'solo (no signaling server configured)'
        : `${session.role}${session.role === 'host' || session.role === 'client' ? ` · ${session.playerCount} here` : ''}`;
      status.textContent = `world ${cfg.world} · zone ${zone}\n${net}\n${cfg.name} @ ${Math.floor(self.x)}, ${Math.floor(self.y)}\nQ / E rotate view`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Test/debug hook.
  (window as unknown as { __ti: unknown }).__ti = { cfg, self, session };
}

void main();
