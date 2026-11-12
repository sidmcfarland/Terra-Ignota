/**
 * Seed peer: an always-on replica of every world's edits.
 *
 * It registers with the signal server as a seed, learns which peer hosts each
 * zone, and dials every zone host over WebRTC (via node-datachannel). On each
 * link it syncs the zone's edits like a returning client would, then receives
 * every new edit the host spreads. Edits are kept on disk, so a zone that
 * everyone left gets its edits back from the seed when players return.
 * Anyone can run one.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { WebSocket } from 'ws';
import {
  BORDER_VIEW, PROTOCOL_VERSION, distToZone, isWellFormed, opWins, verifyOp, zoneChunkKeys,
  type FromSignal, type ToSignal, type ZoneHost,
} from '../../../packages/shared/src/index.ts';
import { Peer } from '../../client/src/net/peer.ts';
import { DiskStore } from './store.ts';

// The client's Peer uses the browser WebRTC API; node-datachannel provides it.
Object.assign(globalThis, { RTCPeerConnection });

const SIGNAL_URL = process.env.SIGNAL_URL ?? 'ws://localhost:8787';
const PORT = Number(process.env.SEED_PORT ?? 8788);
const DATA_DIR = process.env.DATA_DIR ?? 'data';
const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const OPS_PER_MESSAGE = 200;
const REDIAL_MS = 3000;

const peerId = `seed-${randomBytes(6).toString('base64url')}`;
const store = new DiskStore(DATA_DIR);

/** `${world}|${zone}` -> its host, as the signal server last reported. */
const hosts = new Map<string, ZoneHost>();
/** `${world}|${zone}` -> our link to that zone's host. */
const links = new Map<string, Peer>();

let ws: WebSocket | null = null;
let backoff = 1000;

function send(m: ToSignal) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function connect() {
  const sock = new WebSocket(SIGNAL_URL);
  ws = sock;
  sock.on('open', () => {
    backoff = 1000;
    send({ t: 'seed', v: PROTOCOL_VERSION, peerId });
    console.log(`seed ${peerId} registered with ${SIGNAL_URL}`);
  });
  sock.on('message', (raw) => {
    try {
      onSignal(JSON.parse(String(raw)) as FromSignal);
    } catch (err) {
      console.warn('bad signal message', err);
    }
  });
  sock.on('close', () => {
    if (ws !== sock) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15_000);
  });
  sock.on('error', () => {}); // 'close' follows and handles the retry.
}

function onSignal(m: FromSignal) {
  switch (m.t) {
    case 'zones': {
      const listed = new Set(m.hosts.map((h) => `${h.world}|${h.zone}`));
      for (const key of [...hosts.keys()]) if (!listed.has(key)) setHost(key, null);
      for (const h of m.hosts) setHost(`${h.world}|${h.zone}`, h);
      break;
    }
    case 'zoneHost':
      setHost(`${m.world}|${m.zone}`, m.hostId ? { world: m.world, zone: m.zone, hostId: m.hostId } : null);
      break;
    case 'signal': {
      if (m.link !== 'seed') break;
      for (const [key, h] of hosts) {
        if (h.hostId === m.from) void links.get(key)?.handleSignal(m.data);
      }
      break;
    }
    case 'error':
      console.error('signal error:', m.message);
      break;
  }
}

/** A zone's host changed (or the zone emptied): drop the old link, dial the new host. */
function setHost(key: string, h: ZoneHost | null) {
  const cur = hosts.get(key);
  if (cur && h && cur.hostId === h.hostId) return;
  links.get(key)?.close();
  links.delete(key);
  if (h) {
    hosts.set(key, h);
    dial(key, h);
  } else {
    hosts.delete(key);
  }
}

function dial(key: string, h: ZoneHost) {
  const peer: Peer = new Peer(h.hostId, true, ICE, (data) => send({ t: 'signal', to: h.hostId, link: 'seed', data }), {
    onOpen: () => sync(peer, h),
    onClose: () => {
      if (links.get(key) !== peer) return;
      links.delete(key);
      // The host may still be there (a failed connection): try again while it's listed.
      setTimeout(() => {
        if (hosts.get(key)?.hostId === h.hostId && !links.has(key)) dial(key, h);
      }, REDIAL_MS);
    },
    onReliable: (m) => {
      if (m.t === 'edits') void receive(h, m.ops);
      else if (m.t === 'syncWant') {
        const zone = new Set(zoneChunkKeys(h.zone));
        const edits = store.world(h.world);
        const keys = Array.isArray(m.chunks) ? m.chunks.filter((k) => typeof k === 'string' && zone.has(k)) : [];
        const ops = keys.flatMap((k) => edits.chunkOps(k));
        for (let i = 0; i < ops.length; i += OPS_PER_MESSAGE) peer.sendR({ t: 'edits', ops: ops.slice(i, i + OPS_PER_MESSAGE) });
      }
    },
    onUnreliable: () => {},
  });
  links.set(key, peer);
}

/** Tell the host what we hold for its zone; it sends what we lack and asks for what it lacks. */
function sync(peer: Peer, h: ZoneHost) {
  const edits = store.world(h.world);
  const d: Record<string, string> = {};
  for (const key of zoneChunkKeys(h.zone)) {
    const dg = edits.digest(key);
    if (dg) d[key] = dg;
  }
  peer.sendR({ t: 'sync', d });
}

/**
 * Verify ops from a host, merge them, and write the ones that changed to disk.
 * A host only ever holds edits in or near its own zone, so anything further
 * away is refused: one host can't fill the seed's disk with edits everywhere.
 */
async function receive(h: ZoneHost, ops: unknown) {
  if (!Array.isArray(ops)) return;
  const edits = store.world(h.world);
  for (const op of ops.slice(0, 1024)) {
    if (!isWellFormed(op) || distToZone(op.x + 0.5, op.y + 0.5, h.zone) > BORDER_VIEW) continue;
    const cur = edits.get(op.x, op.y);
    if (cur && !opWins(op, cur)) continue; // Nothing new: skip the signature check.
    if (!(await verifyOp(h.world, op))) continue;
    if (edits.merge(op)) store.append(h.world, op);
  }
}

createServer((req, res) => {
  if (req.url === '/health') {
    const open = [...links.values()].filter((p) => p.isOpen).length;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, peerId, signal: ws?.readyState === WebSocket.OPEN, zones: hosts.size, links: open, worlds: store.stats() }));
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`seed listening on :${PORT}, storing edits in ${DATA_DIR}`));

connect();
