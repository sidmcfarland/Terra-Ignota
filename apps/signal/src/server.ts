/**
 * Signaling + zone directory server.
 *
 * Introduces peers and relays WebRTC offers/answers/ICE. Tracks which peer
 * hosts each zone (soft state). Never sees gameplay traffic.
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { FromSignal, ToSignal } from '../../../packages/shared/src/protocol.ts';

const PROTOCOL_VERSION = 1;
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
  alive: boolean;
  budget: number;
}

const clients = new Set<Client>();
const peers = new Map<string, Client>();
/** `${world}|${zone}` -> members in join order; members[0] is host. */
const zones = new Map<string, string[]>();

const send = (c: Client | undefined, m: FromSignal) => {
  if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
};

function leaveZone(c: Client) {
  const key = c.zoneKey;
  if (!key || !c.peerId) return;
  c.zoneKey = undefined;
  const members = zones.get(key);
  if (!members) return;
  const wasHost = members[0] === c.peerId;
  const i = members.indexOf(c.peerId);
  if (i >= 0) members.splice(i, 1);
  if (members.length === 0) {
    zones.delete(key);
    return;
  }
  const zone = key.slice(key.indexOf('|') + 1);
  if (wasHost) {
    for (const id of members) send(peers.get(id), { t: 'host', zone, hostId: members[0] });
  } else {
    send(peers.get(members[0]), { t: 'left', peerId: c.peerId });
  }
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
    let members = zones.get(c.zoneKey);
    if (!members) zones.set(c.zoneKey, (members = []));
    members.push(c.peerId);
    send(c, { t: 'host', zone: msg.zone, hostId: members[0] });
    return;
  }
  if (msg.t === 'signal') {
    if (!c.peerId || typeof msg.to !== 'string') return;
    const target = peers.get(msg.to);
    if (!target || target.world !== c.world) return;
    send(target, { t: 'signal', from: c.peerId, data: msg.data });
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
  const c: Client = { ws, alive: true, budget: MAX_MSGS_PER_SEC };
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
