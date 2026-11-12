/**
 * Bot swarm: headless players for load testing.
 *
 * Each bot is a real zone Session (the client's own networking code, over
 * node-datachannel's WebRTC), so it joins zones through the signal server,
 * links to hosts, hosts when elected, walks with the shared step() and crosses
 * zone borders like a player. The swarm prints what it measures every few
 * seconds and a summary at the end.
 *
 *   npm run bots -- --bots 100 --zones 4 --duration 30 --signal ws://localhost:8787
 */
import { fork, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, TICK_HZ } from '@terra/shared';
import type { Counter } from '../../client/src/net/stats.ts';
import { parseOptions, toArgs, type Options } from './options.ts';
import { runWorker, type Sample } from './worker.ts';

const o = parseOptions(process.argv.slice(2));

if (o.worker >= 0) {
  // A worker process: run its share of the bots and report to the parent.
  const w = runWorker(o, (s) => process.send?.(s));
  process.on('message', (m) => {
    if (m !== 'stop') return;
    w.stop();
    setTimeout(() => process.exit(0), 200);
  });
  process.on('disconnect', () => process.exit(0));
} else {
  runSwarm(o);
}

/** One second of the whole swarm: the workers' samples combined. */
interface Row {
  t: number;
  started: number;
  connected: number;
  hosts: number;
  clients: number;
  zones: number;
  snapRates: number[];
  seen: number;
  tickAvg: number[];
  tickMax: number[];
  hostClients: number[];
  ticks: number;
  lateTicks: number;
  hostChanges: number;
  crossings: number;
  join: number[];
  handoff: number[];
  failover: number[];
  reports: number;
  corrections: number;
  edits: number;
  merged: number;
  refused: number;
  sent: Record<string, Counter>;
  recvBytes: number;
  dropped: number;
  connectFails: number;
  errors: number;
  errorText: string[];
  lagMs: number;
  cpu: number;
  rssMb: number;
}

function runSwarm(o: Options) {
  const latest = new Map<number, Sample>();
  const rows: Row[] = [];
  let done = false;
  const children: ChildProcess[] = [];
  let local: { stop(): void } | null = null;
  const pending = { join: [] as number[], handoff: [] as number[], failover: [] as number[] };
  const onSample = (s: Sample) => {
    latest.set(s.worker, s);
    pending.join.push(...s.gaps.join);
    pending.handoff.push(...s.gaps.handoff);
    pending.failover.push(...s.gaps.failover);
  };

  if (o.procs === 1) {
    local = runWorker(o, onSample);
  } else {
    const script = fileURLToPath(import.meta.url);
    for (let i = 0; i < o.procs; i++) {
      const child = fork(script, toArgs({ ...o, worker: i }), { stdio: 'inherit' });
      child.on('message', (m) => onSample(m as Sample));
      child.on('exit', (code) => {
        if (!done && code) console.log(`worker ${i} exited with code ${code}`);
      });
      children.push(child);
    }
  }

  const rampS = o.bots / o.ramp;
  const measureFrom = rampS + o.settle;
  const endAt = o.duration > 0 ? rampS + o.duration : Infinity;
  console.log(
    `swarm: ${o.bots} bots over ${o.zones} zones in world ${o.world} via ${o.signal} (protocol ${PROTOCOL_VERSION})\n` +
      `       ${o.procs} process${o.procs > 1 ? 'es' : ''}, ${o.ramp} bots/s ramp (${rampS.toFixed(0)}s), ` +
      `measuring from ${measureFrom.toFixed(0)}s${o.duration > 0 ? ` to ${endAt.toFixed(0)}s` : ''}; ` +
      `hosts ${o.hosts}, roam ${o.roam}, view ${o.view}, edits ${o.edits}/s, churn ${o.churn || 'off'}`,
  );

  const t0 = performance.now();
  const timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const row = combine(t, [...latest.values()], pending);
    pending.join = [];
    pending.handoff = [];
    pending.failover = [];
    rows.push(row);
    if (rows.length % Math.max(1, Math.round(o.report)) === 0) console.log(line(row, rows[rows.length - 1 - Math.round(o.report)] ?? null));
    if (t >= endAt) finish();
  }, 1000);

  function finish() {
    if (done) return;
    done = true;
    clearInterval(timer);
    const summary = summarize(o, rows.filter((r) => r.t >= measureFrom), rows);
    console.log(report(summary));
    if (o.json) writeFileSync(o.json, JSON.stringify(summary, null, 2));
    local?.stop();
    for (const c of children) c.send('stop');
    setTimeout(() => process.exit(summary.stable ? 0 : 1), 800);
  }
  process.on('SIGINT', finish);
}

function combine(t: number, samples: Sample[], gaps: { join: number[]; handoff: number[]; failover: number[] }): Row {
  const sum = (f: (s: Sample) => number) => samples.reduce((a, s) => a + f(s), 0);
  const sent: Record<string, Counter> = {};
  let recvBytes = 0;
  for (const s of samples) {
    for (const [k, c] of Object.entries(s.sent)) {
      const d = (sent[k] ??= { n: 0, bytes: 0, max: 0 });
      d.n += c.n;
      d.bytes += c.bytes;
      d.max = Math.max(d.max, c.max);
    }
    for (const c of Object.values(s.recv)) recvBytes += c.bytes;
  }
  return {
    t,
    started: sum((s) => s.started), connected: sum((s) => s.connected), hosts: sum((s) => s.hosts), clients: sum((s) => s.clients),
    zones: new Set(samples.flatMap((s) => s.zones)).size,
    snapRates: samples.flatMap((s) => s.snapRates),
    seen: sum((s) => s.seen),
    tickAvg: samples.flatMap((s) => s.tickAvg), tickMax: samples.flatMap((s) => s.tickMax),
    hostClients: samples.flatMap((s) => s.hostClients),
    ticks: sum((s) => s.ticks), lateTicks: sum((s) => s.lateTicks),
    hostChanges: sum((s) => s.hostChanges), crossings: sum((s) => s.crossings),
    join: gaps.join, handoff: gaps.handoff, failover: gaps.failover,
    reports: sum((s) => s.reports), corrections: sum((s) => s.corrections),
    edits: sum((s) => s.edits), merged: sum((s) => s.merged), refused: sum((s) => s.refused),
    sent, recvBytes,
    dropped: sum((s) => s.dropped), connectFails: sum((s) => s.connectFails),
    errors: sum((s) => s.errors), errorText: [...new Set(samples.flatMap((s) => s.errorText))].slice(0, 8),
    lagMs: Math.max(0, ...samples.map((s) => s.lagMs)), cpu: sum((s) => s.cpu), rssMb: sum((s) => s.rssMb),
  };
}

const sentBytes = (r: Row) => Object.values(r.sent).reduce((a, c) => a + c.bytes, 0);
const fix = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const kb = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(2)} MB` : `${(bytes / 1e3).toFixed(1)} kB`);

function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);

/** One progress line. Rates are over the time since `prev`. */
function line(r: Row, prev: Row | null): string {
  const dt = prev ? r.t - prev.t : r.t;
  const out = (sentBytes(r) - (prev ? sentBytes(prev) : 0)) / dt;
  return (
    `${String(Math.round(r.t)).padStart(4)}s  up ${r.connected}/${r.started}  hosts ${r.hosts}  zones ${r.zones}` +
    `  snaps/s med ${fix(quantile(r.snapRates, 0.5), 0)} p5 ${fix(quantile(r.snapRates, 0.05), 0)}` +
    `  tick avg ${fix(mean(r.tickAvg), 2)} max ${fix(Math.max(0, ...r.tickMax), 1)}ms` +
    `  out ${kb(out)}/s  sees ${fix(r.seen / Math.max(1, r.started), 1)}` +
    `  crossed ${r.crossings}  host changes ${r.hostChanges}  errors ${r.errors}` +
    `  lag ${r.lagMs}ms  cpu ${fix(r.cpu, 1)}  rss ${r.rssMb}MB`
  );
}

interface Summary {
  options: Options;
  machine: string;
  protocol: number;
  /** Seconds measured, after the ramp and settling time. */
  seconds: number;
  bots: number;
  zones: number;
  hosts: number;
  /** Clients per host: average and the largest zone. */
  clientsPerHost: { mean: number; max: number };
  /** Bots connected, as a share of the swarm: the average and the worst second. */
  connected: { mean: number; min: number };
  /** Snapshots each client received per second (the host sends 20). */
  snapsPerClient: { median: number; p5: number; min: number };
  /** Other players a bot sees, on average. */
  sees: number;
  /** Host tick time in ms: mean, 95th percentile and maximum of each host's worst tick per second; and the share that started late. */
  hostTick: { meanMs: number; p95WorstMs: number; maxMs: number; late: number };
  /** Traffic the bots sent, per second: in all, per message type, and the snapshot bytes one client receives. */
  sentPerSec: number;
  byType: Record<string, { perSec: number; bytesPerSec: number; meanBytes: number; maxBytes: number }>;
  snapBytesPerClientPerSec: number;
  /** Zone crossings, and how long each kind of gap in connection lasted (ms). */
  crossings: number;
  hostChanges: number;
  joinMs: { n: number; median: number; p95: number };
  handoffMs: { n: number; median: number; p95: number };
  failoverMs: { n: number; median: number; p95: number };
  /** Share of position reports a host corrected. */
  corrected: number;
  edits: number;
  editsMerged: number;
  editsRefused: number;
  errors: number;
  errorText: string[];
  connectFails: number;
  dropped: number;
  /** Worst event-loop delay in any bot process (ms), CPU cores used on average, and memory. */
  maxLagMs: number;
  cpuCores: number;
  rssMb: number;
  stable: boolean;
  /** Why the run doesn't count as stable, if it doesn't. */
  problems: string[];
}

function summarize(o: Options, rows: Row[], all: Row[]): Summary {
  const first = rows[0], last = rows[rows.length - 1];
  const seconds = first && last ? Math.max(1, last.t - first.t) : 0;
  const stat = (v: number[]) => ({ n: v.length, median: Math.round(quantile(v, 0.5)), p95: Math.round(quantile(v, 0.95)) });
  const byType: Summary['byType'] = {};
  let snapBytes = 0;
  if (first && last) {
    for (const [k, c] of Object.entries(last.sent)) {
      const a = first.sent[k] ?? { n: 0, bytes: 0, max: 0 };
      const n = c.n - a.n, bytes = c.bytes - a.bytes;
      if (n <= 0) continue;
      byType[k] = { perSec: round(n / seconds), bytesPerSec: Math.round(bytes / seconds), meanBytes: round(bytes / n), maxBytes: c.max };
      if (k === 'u:snap') snapBytes = bytes / seconds;
    }
  }
  const rates = rows.flatMap((r) => r.snapRates);
  const worst = rows.flatMap((r) => r.tickMax);
  const ticks = first && last ? last.ticks - first.ticks : 0;
  const s: Summary = {
    options: o,
    machine: `${cpus()[0]?.model.trim()} × ${cpus().length} threads, Node ${process.version}, ${process.platform}`,
    protocol: PROTOCOL_VERSION,
    seconds: Math.round(seconds),
    bots: o.bots,
    zones: Math.max(0, ...rows.map((r) => r.zones)),
    hosts: Math.round(mean(rows.map((r) => r.hosts))),
    clientsPerHost: { mean: round(mean(rows.flatMap((r) => r.hostClients))), max: Math.max(0, ...rows.flatMap((r) => r.hostClients)) },
    connected: { mean: round(mean(rows.map((r) => r.connected)) / o.bots, 4), min: round(Math.min(...rows.map((r) => r.connected)) / o.bots, 4) },
    snapsPerClient: { median: quantile(rates, 0.5), p5: quantile(rates, 0.05), min: Math.min(...rates) },
    sees: round(mean(rows.map((r) => r.seen / Math.max(1, r.started)))),
    hostTick: {
      meanMs: round(mean(rows.flatMap((r) => r.tickAvg)), 3), p95WorstMs: round(quantile(worst, 0.95), 2), maxMs: round(Math.max(0, ...worst), 2),
      late: ticks ? round((last.lateTicks - first.lateTicks) / ticks, 4) : 0,
    },
    sentPerSec: first && last ? Math.round((sentBytes(last) - sentBytes(first)) / seconds) : 0,
    byType,
    snapBytesPerClientPerSec: Math.round(snapBytes / Math.max(1, mean(rows.map((r) => r.clients)))),
    crossings: last ? last.crossings : 0,
    hostChanges: last ? last.hostChanges : 0,
    joinMs: stat(all.flatMap((r) => r.join)),
    handoffMs: stat(all.flatMap((r) => r.handoff)),
    failoverMs: stat(all.flatMap((r) => r.failover)),
    corrected: last && last.reports ? round(last.corrections / (last.reports + last.corrections), 4) : 0,
    edits: last ? last.edits : 0,
    editsMerged: last ? last.merged : 0,
    editsRefused: last ? last.refused : 0,
    errors: last ? last.errors : 0,
    errorText: last ? last.errorText : [],
    connectFails: last ? last.connectFails : 0,
    dropped: last ? last.dropped : 0,
    maxLagMs: Math.max(0, ...rows.map((r) => r.lagMs)),
    cpuCores: round(mean(rows.map((r) => r.cpu)), 2),
    rssMb: last ? last.rssMb : 0,
    stable: false,
    problems: [],
  };
  // What "stable" means here: nearly everyone connected all the time (a bot crossing a
  // border is briefly between hosts), snapshots arriving at close to the tick rate, hosts
  // keeping up with their ticks, and nothing logged as an error.
  if (!rows.length) s.problems.push('nothing was measured (the run ended before the measuring window)');
  if (s.connected.mean < 0.98) s.problems.push(`only ${pct(s.connected.mean)} of bots connected on average`);
  // With churn on, a host is killed on purpose and its whole zone is between hosts for a moment,
  // so the worst second says little; what counts then is how fast the zone comes back.
  if (!o.churn && s.connected.min < 0.95) s.problems.push(`connected bots dipped to ${pct(s.connected.min)}`);
  if (o.churn && s.failoverMs.p95 > 3000) s.problems.push(`reconnecting after a host change took ${s.failoverMs.p95}ms (95th percentile)`);
  if (!(s.snapsPerClient.median >= TICK_HZ - 1)) s.problems.push(`median client got ${s.snapsPerClient.median} snapshots/s, not ${TICK_HZ}`);
  if (!(s.snapsPerClient.p5 >= TICK_HZ * 0.75)) s.problems.push(`slowest 5% of clients got ${s.snapsPerClient.p5} snapshots/s or fewer`);
  if (s.hostTick.late > 0.05) s.problems.push(`${pct(s.hostTick.late)} of host ticks started late`);
  if (s.errors) s.problems.push(`${s.errors} warnings or errors logged`);
  s.stable = s.problems.length === 0;
  return s;
}

const round = (v: number, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function report(s: Summary): string {
  const types = Object.entries(s.byType)
    .sort((a, b) => b[1].bytesPerSec - a[1].bytesPerSec)
    .map(([k, c]) => `    ${k.padEnd(10)} ${fix(c.perSec, 0).padStart(7)}/s  ${kb(c.bytesPerSec).padStart(10)}/s  mean ${fix(c.meanBytes, 0).padStart(5)} B  max ${String(c.maxBytes).padStart(6)} B`);
  const gap = (g: { n: number; median: number; p95: number }) => (g.n ? `${g.n} (median ${g.median}ms, p95 ${g.p95}ms)` : '0');
  return [
    '',
    `SUMMARY  ${s.bots} bots, ${s.zones} zones, measured ${s.seconds}s, protocol ${s.protocol}`,
    `  machine          ${s.machine}`,
    `  connected        ${pct(s.connected.mean)} on average, ${pct(s.connected.min)} in the worst second`,
    `  hosts            ${s.hosts}, with ${fix(s.clientsPerHost.mean)} clients each on average (largest ${s.clientsPerHost.max})`,
    `  snapshots/client median ${s.snapsPerClient.median}/s, 5th percentile ${s.snapsPerClient.p5}/s, lowest ${s.snapsPerClient.min}/s (hosts send ${TICK_HZ}/s)`,
    `  players seen     ${fix(s.sees)} per bot on average`,
    `  host tick        mean ${fix(s.hostTick.meanMs, 3)}ms, worst-per-second p95 ${fix(s.hostTick.p95WorstMs, 2)}ms, max ${fix(s.hostTick.maxMs, 2)}ms, ${pct(s.hostTick.late)} started late`,
    `  sent             ${kb(s.sentPerSec)}/s by all bots; snapshots cost each client ${kb(s.snapBytesPerClientPerSec)}/s`,
    ...types,
    `  zone crossings   ${s.crossings}; hand-offs ${gap(s.handoffMs)}`,
    `  host changes     ${s.hostChanges}; reconnects after one ${gap(s.failoverMs)}`,
    `  joins            ${gap(s.joinMs)}`,
    `  movement         ${pct(s.corrected)} of position reports corrected by hosts`,
    `  edits            ${s.edits} made, ${s.editsMerged} merged from the network, ${s.editsRefused} refused by hosts`,
    `  errors           ${s.errors} logged, ${s.connectFails} links failed to open, ${s.dropped} messages dropped by limits`,
    ...s.errorText.map((e) => `    ${e}`),
    `  bot processes    worst event-loop delay ${s.maxLagMs}ms, ${fix(s.cpuCores, 2)} CPU cores, ${s.rssMb} MB`,
    s.stable ? '  STABLE' : `  NOT STABLE: ${s.problems.join('; ')}`,
    '',
  ].join('\n');
}
