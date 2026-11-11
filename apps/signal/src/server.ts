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
  reviewHost, sanitizeMetrics, type Candidate, type Challenge, type HostMetrics,
} from '../../../packages/shared/src/election.ts';
import {
  PROTOCOL_VERSION, type FromSignal, type NeighbourHost, type ToSignal,
} from '../../../packages/shared/src/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG = 16 * 1024;
const MAX_MSGS_PER_SEC = 50;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ZONE_RE = /^-?\d{1,9},-?\d{1,9}$/;

interface Client {
  ws: WebSocket;
  peerId?: string;
  world?: string;
  zoneKey?: string;
  /** Latest status heartbeat, or null before the first one. */
  metrics: HostMetrics | null;
  alive: boolean;
  budget: number;
}

interface Zone {
  /** Peer ids in join order. */
  members: string[];
  host: string | null;
  /** A peer that has been scoring well above the host, and since when. */
  challenge: Challenge | null;
}

const clients = new Set<Client>();
const peers = new Map<string, Client>();
/** `${world}|${zone}` -> zone state. */
const zones = new Map<string, Zone>();

const send = (c: Client | undefined, m: FromSignal) => {
  if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
};

const zoneKey = (world: string, zx: number, zy: number) => `${world}|${zx},${zy}`;
const zoneOfKey = (key: string) => key.slice(key.indexOf('|') + 1);

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

/** Re-run the election for a zone; announce a new host to every member and to neighbouring hosts. */
function review(key: string) {
  const z = zones.get(key);
  if (!z) return;
  const cands: Candidate[] = z.members.map((id) => ({ id, m: peers.get(id)?.metrics ?? null }));
  const r = reviewHost(z.host, cands, z.challenge, Date.now());
  z.challenge = r.challenge;
  if (r.host === z.host) return;
  z.host = r.host;
  const zone = zoneOfKey(key);
  if (z.host) for (const id of z.members) send(peers.get(id), { t: 'host', zone, hostId: z.host });
  hostChanged(key);
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
    return;
  }
  if (z.challenge?.id === c.peerId) z.challenge = null;
  if (z.host === c.peerId) review(key);
  else if (z.host) send(peers.get(z.host), { t: 'left', peerId: c.peerId });
}

function onMessage(c: Client, msg: ToSignal) {
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
    if (!z) zones.set(c.zoneKey, (z = { members: [], host: null, challenge: null }));
    z.members.push(c.peerId);
    if (z.host) send(c, { t: 'host', zone: msg.zone, hostId: z.host });
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
  if (msg.t === 'signal') {
    if (!c.peerId || typeof msg.to !== 'string') return;
    const target = peers.get(msg.to);
    if (!target || target.world !== c.world) return;
    const link = msg.link === 'border' ? 'border' : 'zone';
    send(target, { t: 'signal', from: c.peerId, link, data: msg.data });
  }
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, peers: peers.size, zones: zones.size }));
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
    clients.delete(c);
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
