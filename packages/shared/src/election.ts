/**
 * Host election rules. The signal server runs these today; they live in shared
 * so peers can run the same rules once a DHT replaces the server.
 */

/** What a peer reports about itself in its status heartbeat. */
export interface HostMetrics {
  /** The player allows this device to host ("Available to host"). */
  optIn: boolean;
  /** The tab is in the foreground. Background tabs have their timers throttled. */
  visible: boolean;
  mobile: boolean;
  /** Running on battery, where the browser can tell. */
  battery: boolean;
  /** Average round trip to the zone's clients while hosting; otherwise to the signal server. */
  rttMs: number;
  /** How long this tab has been open. */
  uptimeMs: number;
  /** Total time this device has spent hosting, across visits. */
  hostedMs: number;
  /** Times this device stopped while hosting without a clean exit (crash, killed tab). */
  uncleanExits: number;
  /** Fraction (0..1) of recent host ticks that ran late. */
  lateTicks: number;
  /** Clients this device can comfortably host. */
  cap: number;
}

/** Status heartbeat interval. */
export const STATUS_INTERVAL_MS = 2000;
/** A challenger must beat the current host's score by this fraction... */
export const HOST_SWITCH_MARGIN = 0.2;
/** ...continuously for this long before hosting moves. */
export const HOST_SWITCH_HOLD_MS = 30_000;
/** Members the host streams its state to, ready to take over. */
export const BACKUP_COUNT = 2;

/** Hard limits: a peer that fails these never hosts while one that passes is available. */
export function canHost(m: HostMetrics): boolean {
  return m.optIn && m.visible && !m.mobile && !m.battery;
}

/** Higher is better. Around 100 for a typical desktop. */
export function hostScore(m: HostMetrics, members: number): number {
  let s = 100;
  s -= Math.min(m.rttMs, 500) / 10; // up to -50 for a slow link
  s += Math.min(m.uptimeMs / 60_000, 30); // +1 per minute open, up to +30
  s += Math.min((m.hostedMs / 3_600_000) * 2, 20); // +2 per hour hosted, up to +20
  s -= Math.min(m.uncleanExits * 10, 40);
  s -= m.lateTicks * 50;
  if (members > m.cap) s -= 50;
  return s;
}

/** Clients a device can host: about 4 per CPU core, less if its ticks are running late. */
export function clientCap(cores: number, lateTicks: number): number {
  const base = Math.min(48, Math.max(8, Math.round((cores || 4) * 4)));
  return Math.max(4, Math.round(base * (1 - Math.min(Math.max(lateTicks, 0), 1))));
}

/** Coerce an untrusted status payload into sane metrics. */
export function sanitizeMetrics(raw: unknown): HostMetrics {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
  };
  return {
    optIn: r.optIn === true,
    visible: r.visible === true,
    mobile: r.mobile === true,
    battery: r.battery === true,
    rttMs: Number.isFinite(Number(r.rttMs)) ? num(r.rttMs, 10_000) : 500,
    uptimeMs: num(r.uptimeMs, 1e12),
    hostedMs: num(r.hostedMs, 1e12),
    uncleanExits: num(r.uncleanExits, 1000),
    lateTicks: num(r.lateTicks, 1),
    cap: num(r.cap, 1000),
  };
}

export interface Candidate {
  id: string;
  /** Null until the peer's first status arrives. */
  m: HostMetrics | null;
}

export interface Challenge {
  id: string;
  since: number;
}

/**
 * Candidates (given in join order) from best to worst host: eligible peers by
 * score, then ineligible peers by score, then peers with no status yet in join
 * order. Score ties go to the lower id.
 */
export function rankCandidates(cands: Candidate[]): string[] {
  const n = cands.length;
  const byScore = (pool: Candidate[]) =>
    pool
      .map((c) => ({ id: c.id, s: hostScore(c.m!, n) }))
      .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((c) => c.id);
  const known = cands.filter((c) => c.m);
  return [
    ...byScore(known.filter((c) => canHost(c.m!))),
    ...byScore(known.filter((c) => !canHost(c.m!))),
    ...cands.filter((c) => !c.m).map((c) => c.id),
  ];
}

/**
 * The best host: the highest-scoring eligible peer; if none is eligible, the
 * highest-scoring peer anyway so play goes on; with no statuses yet, the
 * earliest to join.
 */
export function bestHost(cands: Candidate[]): string | null {
  return rankCandidates(cands)[0] ?? null;
}

/**
 * The members the host streams its state to. Current backups keep their place
 * while they're still here and able to host (so near-equal scores don't
 * reshuffle them on every heartbeat); empty places go to the best-ranked rest.
 */
export function pickBackups(
  cands: Candidate[],
  host: string | null,
  current: string[] = [],
  n = BACKUP_COUNT,
): string[] {
  const kept = current.filter((id) => {
    if (id === host) return false;
    const c = cands.find((c) => c.id === id);
    return !!c && (!c.m || canHost(c.m));
  });
  const rest = rankCandidates(cands).filter((id) => id !== host && !kept.includes(id));
  return [...kept, ...rest].slice(0, n);
}

/**
 * Who takes over when the host is gone: the first backup still present that
 * can host (it already has the zone's state), otherwise the best candidate.
 */
export function successor(cands: Candidate[], backups: string[]): string | null {
  for (const id of backups) {
    const c = cands.find((c) => c.id === id);
    if (c?.m && canHost(c.m)) return id;
  }
  return bestHost(cands);
}

/**
 * Decide whether a zone's host should change. Called whenever a member joins,
 * leaves or reports status. Hosting moves immediately when the host is gone or
 * can no longer host and an eligible peer exists. Otherwise a challenger must
 * score HOST_SWITCH_MARGIN higher for HOST_SWITCH_HOLD_MS before it takes over.
 */
export function reviewHost(
  host: string | null,
  cands: Candidate[],
  challenge: Challenge | null,
  now: number,
  backups: string[] = [],
): { host: string | null; challenge: Challenge | null } {
  const current = cands.find((c) => c.id === host);
  if (!current) return { host: successor(cands, backups), challenge: null };
  if (!current.m) return { host, challenge: null }; // Its first status hasn't arrived yet.

  const n = cands.length;
  if (!canHost(current.m)) {
    const best = bestHost(cands);
    const bm = cands.find((c) => c.id === best)?.m;
    if (best && best !== host && bm && canHost(bm)) return { host: best, challenge: null };
    return { host, challenge: null };
  }

  const hs = hostScore(current.m, n);
  const need = hs > 0 ? hs * (1 + HOST_SWITCH_MARGIN) : hs + 100 * HOST_SWITCH_MARGIN;
  let top: Candidate | null = null, topS = -Infinity;
  for (const c of cands) {
    if (c.id === host || !c.m || !canHost(c.m)) continue;
    const s = hostScore(c.m, n);
    if (s > topS) (top = c), (topS = s);
  }
  if (!top || topS < need) return { host, challenge: null };
  if (challenge?.id !== top.id) return { host, challenge: { id: top.id, since: now } };
  if (now - challenge.since >= HOST_SWITCH_HOLD_MS) return { host: top.id, challenge: null };
  return { host, challenge };
}
