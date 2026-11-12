import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { netStats, type Counter } from '../../client/src/net/stats.ts';
import { Bot, makeWorld, type Tally } from './bot.ts';
import type { Options } from './options.ts';

/** What one worker process reports each second. Counts are since the worker started unless noted. */
export interface Sample {
  worker: number;
  /** Bots started, and how they stand right now. */
  started: number;
  connected: number;
  hosts: number;
  clients: number;
  /** Zones this worker's bots are in. */
  zones: string[];
  /** Per client: snapshots received in the last second. */
  snapRates: number[];
  /** Other players each bot currently sees, summed over the bots. */
  seen: number;
  /** Per host, over the last second: average and worst tick time (ms), and its client count. */
  tickAvg: number[];
  tickMax: number[];
  hostClients: number[];
  ticks: number;
  lateTicks: number;
  hostChanges: number;
  crossings: number;
  /** Gaps (ms) that ended in the last second, by cause. */
  gaps: Tally;
  /** Position reports the hosts accepted and corrected (hosts' current clients only). */
  reports: number;
  corrections: number;
  edits: number;
  merged: number;
  sent: Record<string, Counter>;
  recv: Record<string, Counter>;
  dropped: number;
  connectFails: number;
  errors: number;
  /** The first few distinct warnings and errors. */
  errorText: string[];
  /** Worst event-loop delay in the last second (ms). */
  lagMs: number;
  /** CPU seconds this process used in the last second, over all its threads. */
  cpu: number;
  rssMb: number;
}

const STEP_MS = 50;

/** Run this process's share of the swarm, reporting a Sample every second. */
export function runWorker(o: Options, emit: (s: Sample) => void): { stop(): void } {
  // The client's Peer uses the browser WebRTC API; node-datachannel provides it.
  Object.assign(globalThis, { RTCPeerConnection });

  const world = makeWorld(o.world, o.zones);
  if (!world.zones.length) throw new Error('no land zones found near the world spawn');
  const worker = Math.max(o.worker, 0);
  // Bots of one zone are dealt round-robin to the workers, so a zone's links cross processes.
  const mine = (index: number) => Math.floor(index / world.zones.length) % o.procs === worker;

  const bots: Bot[] = [];
  const tally: Tally = { join: [], handoff: [], failover: [] };
  let retired = { crossings: 0, edits: 0, merged: 0, hostChanges: 0, ticks: 0, lateTicks: 0 };
  let errors = 0;
  const errorText: string[] = [];
  const note = (...args: unknown[]) => {
    errors++;
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 200);
    if (errorText.length < 8 && !errorText.includes(text)) errorText.push(text);
  };
  console.warn = note;
  console.error = note;
  process.on('uncaughtException', (err) => note('uncaught:', err));
  process.on('unhandledRejection', (err) => note('unhandled rejection:', err));

  let stopped = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const start = (index: number) => {
    void Bot.create(index, world, o, tally).then((bot) => {
      if (stopped) bot.close();
      else bots.push(bot);
    }, (err) => note('bot failed to start:', err));
  };
  for (let i = 0; i < o.bots; i++) if (mine(i)) timers.push(setTimeout(() => start(i), (i / o.ramp) * 1000));

  // Churn: one bot quits without a goodbye and a newcomer takes its place. Hosts and clients take turns.
  if (o.churn > 0) {
    let turn = 0;
    const period = o.churn * o.procs * 1000;
    const begin = (o.bots / o.ramp) * 1000 + (o.churn * worker + o.churn / 2) * 1000;
    timers.push(setTimeout(() => {
      const churn = () => {
        const wantHost = turn++ % 2 === 0;
        const pool = bots.filter((b) => (b.session.role === 'host') === wantHost);
        const victim = (pool.length ? pool : bots)[Math.floor(Math.random() * (pool.length || bots.length))];
        if (!victim) return;
        bots.splice(bots.indexOf(victim), 1);
        retire(victim);
        victim.close();
        // The newcomer takes the same slot in the swarm (same zone and role), as a new peer with a new identity.
        timers.push(setTimeout(() => start(victim.index), 1000));
      };
      churn();
      timers.push(setInterval(churn, period));
    }, begin));
  }

  function retire(b: Bot) {
    const s = b.session.stats;
    retired = {
      crossings: retired.crossings + b.crossings, edits: retired.edits + b.editsMade, merged: retired.merged + b.merged,
      hostChanges: retired.hostChanges + s.hostChanges, ticks: retired.ticks + s.ticks, lateTicks: retired.lateTicks + s.lateTicks,
    };
  }

  // The walk loop, booked against an ideal timeline like the session's tick. How late
  // it fires is the event-loop delay: how far behind this process is running.
  let lastStep = performance.now();
  let due = lastStep + STEP_MS;
  let lag = 0;
  let loop: ReturnType<typeof setTimeout>;
  const walk = () => {
    const now = performance.now();
    lag = Math.max(lag, now - due);
    due += STEP_MS;
    if (due < now - STEP_MS) due = now;
    loop = setTimeout(walk, Math.max(0, due - now));
    const dt = Math.min((now - lastStep) / 1000, 0.25);
    lastStep = now;
    for (const b of bots) b.step(dt, now);
  };
  loop = setTimeout(walk, STEP_MS);

  let cpu = process.cpuUsage();
  /** Per host session: tick totals at the last sample. */
  const lastTicks = new Map<Bot, { ticks: number; ms: number }>();
  const sampler = setInterval(() => {
    const now = performance.now();
    const used = process.cpuUsage(cpu);
    cpu = process.cpuUsage();
    const s: Sample = {
      worker, started: bots.length, connected: 0, hosts: 0, clients: 0, zones: [], snapRates: [], seen: 0,
      tickAvg: [], tickMax: [], hostClients: [], ticks: retired.ticks, lateTicks: retired.lateTicks,
      hostChanges: retired.hostChanges, crossings: retired.crossings,
      gaps: { join: tally.join.splice(0), handoff: tally.handoff.splice(0), failover: tally.failover.splice(0) },
      reports: 0, corrections: 0, edits: retired.edits, merged: retired.merged,
      sent: Object.fromEntries(netStats.sent), recv: Object.fromEntries(netStats.recv),
      dropped: netStats.dropped, connectFails: netStats.connectFails,
      errors, errorText, lagMs: Math.round(lag), cpu: (used.user + used.system) / 1e6,
      rssMb: Math.round(process.memoryUsage().rss / 2 ** 20),
    };
    lag = 0;
    const zones = new Set<string>();
    for (const b of bots) {
      const sess = b.session, st = sess.stats;
      zones.add(b.zone);
      if (b.connected) s.connected++;
      const isClient = sess.role === 'client';
      if (isClient) s.clients++;
      if (isClient && b.wasClient) s.snapRates.push(st.snaps - b.lastSnaps);
      b.wasClient = isClient;
      b.lastSnaps = st.snaps;
      for (const r of sess.remotes.values()) if (sess.sample(r, now)) s.seen++;
      s.ticks += st.ticks;
      s.lateTicks += st.lateTicks;
      s.hostChanges += st.hostChanges;
      s.crossings += b.crossings;
      s.edits += b.editsMade;
      s.merged += b.merged;
      if (sess.role === 'host') {
        s.hosts++;
        const clients = sess.clientsDebug();
        s.hostClients.push(clients.length);
        for (const c of clients) (s.reports += c.reports), (s.corrections += c.corrections);
        const last = lastTicks.get(b);
        if (last && st.ticks > last.ticks) {
          s.tickAvg.push((st.tickMs - last.ms) / (st.ticks - last.ticks));
          s.tickMax.push(st.tickMaxMs);
        }
        st.tickMaxMs = 0; // Start the next second's worst case afresh.
        lastTicks.set(b, { ticks: st.ticks, ms: st.tickMs });
      } else {
        lastTicks.delete(b);
      }
    }
    s.zones = [...zones];
    emit(s);
  }, 1000);

  return {
    stop() {
      stopped = true;
      clearTimeout(loop);
      clearInterval(sampler);
      for (const t of timers) clearTimeout(t);
      for (const b of bots) b.close();
    },
  };
}
