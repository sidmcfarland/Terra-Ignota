/**
 * Seed peer: an always-on replica of every world's edits, in every layer.
 *
 * It registers with the signal server as a seed, learns which peer hosts each
 * zone, and dials every zone host over WebRTC (via node-datachannel). On each
 * link it syncs like a returning client would (the zone's chunks and the whole
 * world's atlas), then receives every new op the host spreads. Ops are kept on
 * disk, so a zone that everyone left gets its edits back from the seed when
 * players return.
 *
 * It also carries the atlas between zones: a world-scope op from one host is
 * passed on to every other host it is linked to in that world. And it keeps
 * each player's own ops (the purse), which it hands to whichever host that
 * player is on when that host asks.
 * Anyone can run one.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { WebSocket } from 'ws';
import {
  BORDER_VIEW, LAYERS, MAX_OPS_PER_MESSAGE, OPS_PER_MESSAGE, PROTOCOL_VERSION, RELAY_FLUSH_MS, SYNC_ATLAS_ZONES,
  asOp, atlasZone, distToZone, isTooNew, opPoint, parseClockShift, syncDigests, verifyOp, wallClock, zoneChunkBuckets,
  type FromSignal, type Op, type ToSignal, type ZoneHost,
} from '../../../packages/shared/src/index.ts';
import { Peer } from '../../client/src/net/peer.ts';
import { DiskStore } from './store.ts';

// The client's Peer uses the browser WebRTC API; node-datachannel provides it.
Object.assign(globalThis, { RTCPeerConnection });

const SIGNAL_URL = process.env.SIGNAL_URL ?? 'ws://localhost:8787';
const PORT = Number(process.env.SEED_PORT ?? 8788);
const DATA_DIR = process.env.DATA_DIR ?? 'data';
const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const REDIAL_MS = 3000;
/** How often expired ops are dropped, and a file they dominate is rewritten. */
const SWEEP_MS = 10 * 60_000;
/** `NOW=+45d` shifts the clock ops are dated and expired by, like the client's `#now=`. */
const now = wallClock(parseClockShift(process.env.NOW));

const peerId = `seed-${randomBytes(6).toString('base64url')}`;
const store = new DiskStore(DATA_DIR, now);

/** Our link to a zone's host, and the world-scope ops waiting to be passed on to it. */
interface Link {
  peer: Peer;
  queue: Op[];
  timer?: ReturnType<typeof setTimeout>;
}

/** `${world}|${zone}` -> its host, as the signal server last reported. */
const hosts = new Map<string, ZoneHost>();
/** `${world}|${zone}` -> our link to that zone's host. */
const links = new Map<string, Link>();

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
        if (h.hostId === m.from) void links.get(key)?.peer.handleSignal(m.data);
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
  drop(key);
  if (h) {
    hosts.set(key, h);
    dial(key, h);
  } else {
    hosts.delete(key);
  }
}

/** Close and forget the link to a zone's host. */
function drop(key: string) {
  const link = links.get(key);
  if (!link) return;
  links.delete(key);
  clearTimeout(link.timer);
  link.peer.close();
}

function sendOps(peer: Peer, ops: Op[]) {
  for (let i = 0; i < ops.length; i += OPS_PER_MESSAGE) peer.sendR({ t: 'edits', ops: ops.slice(i, i + OPS_PER_MESSAGE) });
}

function dial(key: string, h: ZoneHost) {
  const peer: Peer = new Peer(h.hostId, true, ICE, (data) => send({ t: 'signal', to: h.hostId, link: 'seed', data }), {
    onOpen: () => sync(peer, h),
    onClose: () => {
      if (links.get(key)?.peer !== peer) return;
      drop(key);
      // The host may still be there (a failed connection): try again while it's listed.
      setTimeout(() => {
        if (hosts.get(key)?.hostId === h.hostId && !links.has(key)) dial(key, h);
      }, REDIAL_MS);
    },
    onReliable: (m) => {
      if (m.t === 'edits') void receive(key, h, m.ops);
      else if (m.t === 'syncWant') {
        // The host asks for buckets where we may hold ops it lacks: its zone's chunks, any zone's atlas,
        // and the own ops of the players it has.
        const zone = new Set(zoneChunkBuckets(h.zone));
        const edits = store.world(h.world);
        const keys = Array.isArray(m.keys)
          ? m.keys.filter((k) => typeof k === 'string' && (zone.has(k) || atlasZone(k) || k.startsWith('p:')))
          : [];
        sendOps(peer, keys.flatMap((k) => edits.bucketOps(k)));
      }
    },
    onUnreliable: () => {},
  });
  links.set(key, { peer, queue: [] });
}

/** Tell the host what we hold: its zone's chunks and the world's atlas. It sends what we lack and asks for what it lacks. */
function sync(peer: Peer, h: ZoneHost) {
  peer.sendR({ t: 'sync', d: syncDigests(store.world(h.world), h.zone, null, SYNC_ATLAS_ZONES) });
}

/**
 * Verify ops from a host, merge them, write the ones that changed to disk, and
 * pass the world-scope ones on to the other hosts of that world.
 *
 * A zone-scope op is only taken in or near the zone of the host that sent it:
 * a host holds no others, and this way one host can't fill the seed's disk
 * with tile edits everywhere. World-scope ops (the atlas) and players' own ops
 * are taken from any host.
 */
async function receive(from: string, h: ZoneHost, ops: unknown) {
  if (!Array.isArray(ops)) return;
  const edits = store.world(h.world);
  const atlas: Op[] = [];
  for (const raw of ops.slice(0, MAX_OPS_PER_MESSAGE)) {
    const op = asOp(raw);
    if (!op || isTooNew(op, now())) continue;
    const scope = LAYERS[op.l].scope;
    if (scope === 'zone') {
      const at = opPoint(op);
      if (!at || distToZone(at.x, at.y, h.zone) > BORDER_VIEW) continue;
    }
    if (!edits.wouldChange(op)) continue; // Nothing new, or expired: skip the signature check.
    if (!(await verifyOp(h.world, op))) continue;
    if (!edits.merge(op)) continue;
    store.append(h.world, op);
    if (scope === 'world') atlas.push(op);
  }
  if (atlas.length) relay(from, h.world, atlas);
}

/**
 * Pass world-scope ops on to every other host we're linked to in that world.
 * They are gathered for a moment first, so a host gets a few messages a second
 * from us however fast the world is being charted.
 */
function relay(from: string, world: string, ops: Op[]) {
  for (const [key, link] of links) {
    if (key === from || hosts.get(key)?.world !== world || !link.peer.isOpen) continue;
    for (const op of ops) link.queue.push(op);
    link.timer ??= setTimeout(() => {
      link.timer = undefined;
      sendOps(link.peer, link.queue.splice(0));
    }, RELAY_FLUSH_MS);
  }
}

// `/health` reports the seed's links and the worlds it has loaded. `/health?world=<id>` adds what is
// stored for one world, layer by layer, loading it from disk if no host has brought it into memory yet.
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    const open = [...links.values()].filter((l) => l.peer.isOpen).length;
    const world = url.searchParams.get('world');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, peerId, signal: ws?.readyState === WebSocket.OPEN, zones: hosts.size, links: open, worlds: store.stats(),
      ...(world ? { world, layers: store.has(world) ? store.layers(world) : {} } : {}),
    }));
    return;
  }
  res.writeHead(404).end();
});
server.listen(PORT, () => {
  const at = server.address();
  console.log(`seed listening on :${typeof at === 'object' && at ? at.port : PORT}, storing edits in ${DATA_DIR}`);
});

setInterval(() => store.sweep(), SWEEP_MS).unref();
connect();
