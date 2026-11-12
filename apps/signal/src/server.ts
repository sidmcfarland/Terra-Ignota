/**
 * Signaling + zone directory server.
 *
 * Introduces peers and relays WebRTC offers/answers/ICE. Elects and tracks
 * which peer hosts each zone from their status heartbeats (soft state). Never
 * sees gameplay traffic.
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  pickBackups, reviewHost, sanitizeMetrics, type Candidate, type Challenge, type HostMetrics,
} from '../../../packages/shared/src/election.ts';
import {
  PROTOCOL_VERSION, type FromSignal, type NeighbourHost, type ToSignal, type ZoneHost,
} from '../../../packages/shared/src/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG = 16 * 1024;
const MAX_MSGS_PER_SEC = 50;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ZONE_RE = /^-?\d{1,9},-?\d{1,9}$/;
/** A host reported silent gets this long to answer a probe before it's dropped. */
const PROBE_MS = 750;

interface Client {
  ws: WebSocket;
  peerId?: string;
  world?: string;
  zoneKey?: string;
  /** Latest status heartbeat, or null before the first one. */
  metrics: HostMetrics | null;
  /** An unanswered liveness probe, after a member reported this host silent. */
  probe?: { n: number; timer: ReturnType<typeof setTimeout> };
  /** A seed peer: never in a zone; told about every zone's host. */
  seed?: boolean;
  alive: boolean;
  budget: number;
}

interface Zone {
  /** Peer ids in join order. */
  members: string[];
  host: string | null;
  /** Members the host streams its state to, best first; the first eligible one succeeds it. */
  backups: string[];
  /** A peer that has been scoring well above the host, and since when. */
  challenge: Challenge | null;
}

const clients = new Set<Client>();
const peers = new Map<string, Client>();
/** `${world}|${zone}` -> zone state. */
const zones = new Map<string, Zone>();
const seeds = new Set<Client>();
let probeN = 0;

const send = (c: Client | undefined, m: FromSignal) => {
  if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
};

const zoneKey = (world: string, zx: number, zy: number) => `${world}|${zx},${zy}`;
const zoneOfKey = (key: string) => key.slice(key.indexOf('|') + 1);

/** Tell every seed that a zone's host changed (null: the zone emptied). */
function tellSeeds(key: string, hostId: string | null) {
  const bar = key.indexOf('|');
  for (const s of seeds) send(s, { t: 'zoneHost', world: key.slice(0, bar), zone: key.slice(bar + 1), hostId });
}

/** Tell the host of zone (zx, zy), if it has one, who hosts each neighbouring zone. */
function sendNeighbours(world: string, zx: number, zy: number) {
  const z = zones.get(zoneKey(world, zx, zy));
  if (!z?.host) return;
  const hosts: NeighbourHost[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const n = zones.get(zoneKey(world, zx + dx, zy + dy));
    if (n?.host) hosts.push({ zone: `${zx + dx},${zy + dy}`, hostId: n.host });
  }
  send(peers.get(z.host), { t: 'neighbours', zone: `${zx},${zy}`, hosts });
}

/** A zone's host changed (or the zone appeared or emptied): refresh it and its neighbours. */
function hostChanged(key: string) {
  const bar = key.indexOf('|');
  const world = key.slice(0, bar);
  const [zx, zy] = key.slice(bar + 1).split(',').map(Number);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sendNeighbours(world, zx + dx, zy + dy);
}

/**
 * Re-run the election for a zone. A new host or new backups are announced to
 * every member; a new host also to neighbouring hosts.
 */
function review(key: string) {
  const z = zones.get(key);
  if (!z) return;
  const cands: Candidate[] = z.members.map((id) => ({ id, m: peers.get(id)?.metrics ?? null }));
  const r = reviewHost(z.host, cands, z.challenge, Date.now(), z.backups);
  z.challenge = r.challenge;
  const backups = pickBackups(cands, r.host, z.backups);
  const hostMoved = r.host !== z.host;
  if (!hostMoved && backups.join() === z.backups.join()) return;
  z.host = r.host;
  z.backups = backups;
  const zone = zoneOfKey(key);
  if (z.host) for (const id of z.members) send(peers.get(id), { t: 'host', zone, hostId: z.host, backups });
  if (hostMoved) {
    hostChanged(key);
    tellSeeds(key, z.host);
  }
}

/** A member says its host went silent: probe the host from page script, and drop it if no answer comes. */
function suspectHost(c: Client, zone: string) {
  if (!c.zoneKey || zoneOfKey(c.zoneKey) !== zone) return;
  const z = zones.get(c.zoneKey);
  if (!z?.host || z.host === c.peerId) return;
  const host = peers.get(z.host);
  if (!host || host.probe) return;
  const n = ++probeN;
  host.probe = {
    n,
    timer: setTimeout(() => {
      if (host.probe?.n !== n) return;
      host.probe = undefined;
      console.log(`host ${host.peerId} of ${host.zoneKey} did not answer a probe; dropping it`);
      host.ws.terminate(); // The close handler leaves the zone, and the election picks a successor.
    }, PROBE_MS),
  };
  send(host, { t: 'probe', n });
}

function leaveZone(c: Client) {
  const key = c.zoneKey;
  if (!key || !c.peerId) return;
  c.zoneKey = undefined;
  const z = zones.get(key);
  if (!z) return;
  const i = z.members.indexOf(c.peerId);
  if (i >= 0) z.members.splice(i, 1);
  if (z.members.length === 0) {
    zones.delete(key);
    hostChanged(key);
    tellSeeds(key, null);
    return;
  }
  if (z.challenge?.id === c.peerId) z.challenge = null;
  if (z.host === c.peerId) review(key);
  else if (z.host) send(peers.get(z.host), { t: 'left', peerId: c.peerId });
}

function onMessage(c: Client, msg: ToSignal) {
  if (msg.t === 'seed') {
    if (msg.v !== PROTOCOL_VERSION) return send(c, { t: 'error', message: 'protocol version mismatch; update the seed' });
    if (!ID_RE.test(msg.peerId) || c.zoneKey) return send(c, { t: 'error', message: 'bad seed registration' });
    if (!c.peerId) {
      if (peers.has(msg.peerId)) return send(c, { t: 'error', message: 'peerId in use' });
      c.peerId = msg.peerId;
      peers.set(c.peerId, c);
    }
    c.seed = true;
    seeds.add(c);
    const hosts: ZoneHost[] = [];
    for (const [key, z] of zones) {
      if (z.host) hosts.push({ world: key.slice(0, key.indexOf('|')), zone: zoneOfKey(key), hostId: z.host });
    }
    send(c, { t: 'zones', hosts });
    return;
  }
  if (c.seed && msg.t !== 'signal') return; // Seeds only relay signals.
  if (msg.t === 'join') {
    if (msg.v !== PROTOCOL_VERSION) return send(c, { t: 'error', message: 'protocol version mismatch; reload' });
    if (!ID_RE.test(msg.peerId) || !ID_RE.test(msg.world) || !ZONE_RE.test(msg.zone)) {
      return send(c, { t: 'error', message: 'bad join' });
    }
    if (c.peerId && c.peerId !== msg.peerId) return send(c, { t: 'error', message: 'peerId change' });
    if (!c.peerId) {
      if (peers.has(msg.peerId)) return send(c, { t: 'error', message: 'peerId in use' });
      c.peerId = msg.peerId;
      peers.set(c.peerId, c);
    }
    leaveZone(c);
    c.world = msg.world;
    c.zoneKey = `${msg.world}|${msg.zone}`;
    let z = zones.get(c.zoneKey);
    if (!z) zones.set(c.zoneKey, (z = { members: [], host: null, backups: [], challenge: null }));
    z.members.push(c.peerId);
    if (z.host) send(c, { t: 'host', zone: msg.zone, hostId: z.host, backups: z.backups });
    else review(c.zoneKey); // Empty zone: the joiner hosts it.
    return;
  }
  if (msg.t === 'status') {
    c.metrics = sanitizeMetrics(msg.m);
    if (c.zoneKey) review(c.zoneKey);
    return;
  }
  if (msg.t === 'ping') {
    send(c, { t: 'pong', n: Number(msg.n) || 0 });
    return;
  }
  if (msg.t === 'alive') {
    if (c.probe && c.probe.n === msg.n) {
      clearTimeout(c.probe.timer);
      c.probe = undefined;
    }
    return;
  }
  if (msg.t === 'hostDown') {
    if (typeof msg.zone === 'string') suspectHost(c, msg.zone);
    return;
  }
  if (msg.t === 'signal') {
    if (!c.peerId || typeof msg.to !== 'string') return;
    if (c.seed && msg.link !== 'seed') return;
    const target = peers.get(msg.to);
    // Peers signal within their world; seeds belong to none, so they can reach any host.
    if (!target || (target.world !== c.world && !c.seed && !target.seed)) return;
    const link = msg.link === 'border' || msg.link === 'seed' ? msg.link : 'zone';
    send(target, { t: 'signal', from: c.peerId, link, data: msg.data });
  }
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, peers: peers.size, zones: zones.size, seeds: seeds.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG });

wss.on('connection', (ws) => {
  const c: Client = { ws, metrics: null, alive: true, budget: MAX_MSGS_PER_SEC };
  clients.add(c);
  ws.on('pong', () => (c.alive = true));
  ws.on('message', (raw) => {
    if (--c.budget < 0) return;
    let msg: ToSignal;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg && typeof msg === 'object') onMessage(c, msg);
  });
  ws.on('close', () => {
    if (c.probe) clearTimeout(c.probe.timer);
    clients.delete(c);
    seeds.delete(c);
    leaveZone(c);
    if (c.peerId && peers.get(c.peerId) === c) peers.delete(c.peerId);
  });
});

setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 15_000).unref();

setInterval(() => {
  for (const c of clients) c.budget = MAX_MSGS_PER_SEC;
}, 1000).unref();

http.listen(PORT, () => console.log(`signal listening on :${PORT}`));
