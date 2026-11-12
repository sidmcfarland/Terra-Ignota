import { ZONE_TILES, parseZone, zoneName, zoneOf, zonesNear, type TileEdits, type ZoneId } from '@terra/shared';
import type { Session } from './net/session.ts';

const STORE_KEY = 'ti.debug';

export interface DebugState {
  seed: number;
  zone: ZoneId;
  self: { x: number; y: number };
  peerId: string;
  name: string;
  session: Session | null;
  edits: TileEdits;
  /** This device's public key, the author id on its edits. */
  author: string;
}

/**
 * Developer overlay: zone, border bands, and who reports to whom.
 * Toggle with F3 or ` (backquote), the HUD button, or `#debug=1` in the URL.
 */
export class DebugPanel {
  visible: boolean;
  private readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(el: HTMLElement, button: HTMLButtonElement) {
    this.el = el;
    this.button = button;
    const param = new URLSearchParams(location.hash.slice(1)).get('debug');
    this.visible = param !== null ? param !== '0' : load();
    button.onclick = () => this.toggle();
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'F3' || e.key === '`') {
        e.preventDefault();
        this.toggle();
      }
    });
    this.apply();
  }

  toggle() {
    this.visible = !this.visible;
    try {
      localStorage.setItem(STORE_KEY, this.visible ? '1' : '0');
    } catch {
      // Storage blocked: the toggle still works for this visit.
    }
    this.apply();
  }

  private apply() {
    this.el.hidden = !this.visible;
    this.button.textContent = this.visible ? 'Hide debug' : 'Debug';
  }

  render(s: DebugState) {
    if (!this.visible) return;
    this.el.textContent = [...zoneLines(s), '', ...netLines(s), '', ...editLines(s)].join('\n');
  }
}

function load(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

const label = (seed: number, z: ZoneId) => `${z}  ${zoneName(seed, z)}`;
const short = (id: string) => id.slice(0, 8);
const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)}ms`);

function zoneLines({ seed, zone, self }: DebugState): string[] {
  const [cx, cy] = parseZone(zone);
  const lines = [`ZONE   ${label(seed, zone)}`];
  const standing = zoneOf(self.x, self.y);
  if (standing !== zone) lines.push(`STAND  ${label(seed, standing)}  (inside the margin)`);

  // Distance to each edge of the joined zone; negative means past it.
  const x0 = cx * ZONE_TILES, y0 = cy * ZONE_TILES;
  const edge = (v: number) => String(Math.floor(v)).padStart(4);
  lines.push(
    `EDGES  W${edge(self.x - x0)}  E${edge(x0 + ZONE_TILES - self.x)}  ` +
      `N${edge(self.y - y0)}  S${edge(y0 + ZONE_TILES - self.y)}`,
  );

  const others = zonesNear(self.x, self.y).filter((z) => z !== zone);
  if (others.length === 0) {
    lines.push('BANDS  none (more than 1 chunk from every border)');
  } else {
    others.forEach((z, i) => {
      const [zx, zy] = parseZone(z);
      const dir = (zy < cy ? 'N' : zy > cy ? 'S' : '') + (zx < cx ? 'W' : zx > cx ? 'E' : '');
      lines.push(`${i ? '       ' : 'BANDS  '}${dir.padEnd(2)} ${label(seed, z)}`);
    });
  }
  return lines;
}

function editLines({ edits, author, self }: DebugState): string[] {
  const here = edits.get(Math.floor(self.x), Math.floor(self.y));
  return [
    `EDITS  ${edits.size} tiles edited  ·  clock ${edits.clock}  ·  you sign as ${author.slice(0, 8)}`,
    here ? `       under you: by ${here.author.slice(0, 8)} at clock ${here.clock}` : '       under you: not edited',
  ];
}

function netLines({ session, peerId, name, seed }: DebugState): string[] {
  const lines = [`YOU    ${name}  id ${short(peerId)}`];
  if (!session) return [...lines, 'NET    solo (no signaling server configured)'];
  lines.push(`ROLE   ${session.role}  ·  signal ${session.signalUp ? 'up' : 'down'}`);
  lines.push(`VIEW   ${Math.round(session.viewRadius)} tiles  ·  sees ${session.remotes.size}  ·  ${session.playerCount} in the zone`);

  const h = session.hostingDebug();
  const m = h.metrics;
  lines.push(
    `ELECT  ${h.eligible ? 'can host' : `can't host: ${h.reasons.join(', ')}`}  ·  score ${h.score.toFixed(1)}`,
    `       rtt ${Math.round(m.rttMs)}ms  ·  up ${Math.floor(m.uptimeMs / 60_000)}m  ·  ` +
      `hosted ${(m.hostedMs / 3_600_000).toFixed(1)}h  ·  crashes ${m.uncleanExits}  ·  ` +
      `late ${(m.lateTicks * 100).toFixed(0)}%  ·  cap ${m.cap}`,
  );

  const host = session.hostDebug();
  if (host) {
    lines.push(
      `HOST   ${host.name ?? '?'}  id ${short(host.id)}  ·  link ${host.open ? 'open' : 'closed'}`,
      `       snapshot #${host.snapTick}, ${ms(host.snapAgeMs)} ago`,
      host.backupRank === null
        ? 'BACKUP no'
        : `BACKUP #${host.backupRank} in line  ·  state #${host.stateTick ?? '—'}, ${ms(host.stateAgeMs)} ago`,
    );
  }

  if (session.role === 'host') {
    const backups = session.backupsDebug();
    lines.push(
      `TICK   #${session.currentTick}  ·  ${(session.stats.tickMs / Math.max(1, session.stats.ticks)).toFixed(2)}ms each  ·  seeds ${session.seedCount}`,
      `BACKUPS ${backups.length ? backups.map((b, i) => `#${i + 1} ${b.name ?? short(b.id)}${b.streaming ? '' : ' (not connected)'}`).join('  ·  ') : 'none (alone in the zone)'}`,
    );
    const clients = session.clientsDebug();
    lines.push(`CLIENTS ${clients.length}  (what each reports to you)`);
    if (clients.length) {
      lines.push(`  ${'name'.padEnd(20)}${'id'.padEnd(10)}${'x'.padStart(8)}${'y'.padStart(8)}` +
        `${'age'.padStart(8)}${'seq'.padStart(7)}${'fixes'.padStart(7)}${'rtt'.padStart(7)}`);
    }
    for (const c of clients) {
      lines.push(
        `  ${(c.name ?? '(joining)').slice(0, 19).padEnd(20)}${short(c.id).padEnd(10)}` +
          `${c.x.toFixed(1).padStart(8)}${c.y.toFixed(1).padStart(8)}${ms(c.reportAgeMs).padStart(8)}` +
          `${String(c.seq).padStart(7)}${String(c.corrections).padStart(7)}${ms(c.rttMs).padStart(7)}` +
          `${c.open ? '' : '  link closed'}`,
      );
    }

    const borders = session.bordersDebug();
    lines.push(`NEIGHBOURS ${borders.length}  (hosts of adjacent zones)`);
    for (const b of borders) {
      const where = b.zone ? label(seed, b.zone) : '(zone not listed yet)';
      lines.push(
        `  ${where.padEnd(24)}host ${short(b.hostId)}  ${b.open ? 'open' : 'connecting'}` +
          `  ·  ${b.visible} near you, ${ms(b.edgeAgeMs)} ago`,
      );
    }
  }
  return lines;
}
