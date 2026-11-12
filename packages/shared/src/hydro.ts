import { hash2 } from './rng.ts';
import { groundAt, macroAt, newGround, type Ground } from './terrain.ts';

/**
 * Water (M4c step 2): rivers, streams and lakes that gravity put there.
 *
 * The broad shape of the land (terrain.ts, without its fine noise) is sampled on a grid of drainage
 * nodes, one every NODE tiles. On that grid:
 *   1. Every hollow is flooded from its lowest node until the water finds a way out. That gives a
 *      lake with a level, and the land a surface with no pits in it. A basin too wide to follow gets
 *      a small lake at its lowest point and an outlet cut through its rim, towards the sea.
 *   2. Every node drains to its lowest neighbour on that surface; across a lake, towards its outlet.
 *   3. Rain is added up along the flow. Enough of it makes a stream, more makes a river.
 * Then, tile by tile (landAt): channels are carved along the flow lines so their beds only ever
 * descend, and ground below a lake's level is under that lake.
 *
 * Every device must compute the same water, and a world has no edge, so nothing may depend on where
 * a computation happens to start or stop. Each rule above is therefore LOCAL: what a node ends up as
 * depends only on the land within a fixed distance of it (floods stop FLOOD nodes from their pit,
 * cuts run BREACH nodes, rain is counted REACH nodes upstream). A region is only a unit of work and of caching: it computes
 * a window MARGIN nodes wider than it keeps, and what it keeps is exactly what any other window
 * would have computed for those nodes. Neighbouring regions agree with no shared edge data.
 *
 * Like terrain.ts, this file uses only arithmetic that is exact on every engine.
 */

/** Tiles between drainage nodes. */
export const NODE = 32;
/**
 * Nodes along a region's edge: 3,072 tiles. Measured, then picked (docs/PLAN.md, "Natural terrain"): the
 * window a region works in is 187 nodes wider than the region whatever its size, so small regions cost
 * nearly as much as large ones; this is the largest that computes within a quarter of a second on the dev machine.
 */
export const REGION_NODES = 96;
export const REGION_TILES = NODE * REGION_NODES;

/** Nodes kept around a region's own, so any tile in the region finds every node that can affect it. */
export const REGION_HALO = 5;
const HALO = REGION_HALO;
/** How far upstream rain is counted, in nodes. A channel that has flowed this far is a river. */
const REACH = 20;
/** How far from its lowest node a hollow's flood is followed, in nodes. */
const FLOOD = 5;
/** How far the outlet of a basin too wide to flood is cut, in nodes, and how much its bed drops per node. */
const BREACH = 16;
const BREACH_DROP = 0.002;
/** How much wider than what it keeps a region's window must be for every kept value to be exact (see computeRegion). */
const MARGIN = REACH + BREACH + 10 * FLOOD + 2;
/** Nodes along the edge of a region's arrays. */
export const REGION_EDGE = REGION_NODES + 2 * HALO + 1;
const EDGE = REGION_EDGE;

/** A hollow shallower than this fills, so water crosses it, without showing as a lake. */
const LAKE_MIN = 0.03;
/** How deep the lake at the lowest point of a basin too wide to flood is. */
const SINK = 0.04;
/** Where water ends on open ground it stands in a pond this deep and this many tiles across, dug into the ground. */
const POND_DEPTH = 0.06;
const POND_RADIUS = 10;
/** Region.flow of a node with a pond. */
export const POND = -2;
/** A lake's water stops this far below the land at the nodes around it. */
const SHORE = 0.02;
/** Rain gathered (1 or 2 per node, by climate) that makes a stream, and a river. Both at most REACH + 1, see `kinds`. */
const STREAM_RAIN = 18;
const RIVER_RAIN = 90;

/** How far a node's river point may sit from the node. */
const JITTER = 0.35 * NODE;
/** One river span in this many is a ford: shallow enough to wade along its middle. */
const FORD_EVERY = 10;
/** Valley sides rise this much per tile from a channel's edge; a channel raises low ground beside it less steeply. */
const BANK = 0.025;
const LEVEE = 0.012;
/** Tiles from a channel's edge within which the ground is shaped by it. */
const CARVE = 20;
const WIDEST = 3;

/** How far inland (on the continent map) lakes start. The same as SEA_REACH in worldgen.ts: nearer the coast, water is sea. */
const COAST_STRIP = 0.02;

export const Channel = { None: 0, Stream: 1, River: 2 } as const;

/** The 8 neighbours, in the order every tie is broken in. */
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** The drainage of one region: (REGION_NODES + 2·HALO + 1)² nodes, row-major. Plain data, so it can cross to and from a worker. */
export interface Region {
  seed: number;
  rx: number;
  ry: number;
  /** Node coordinates of the first node in the arrays. */
  x0: number;
  y0: number;
  /** Height of the drained surface at each node: the land, or the water where a hollow filled. Never rises along the flow. */
  level: Float64Array;
  /** The level of the lake a node is under, or NaN. */
  lake: Float64Array;
  /** Which neighbour (0-7) a node drains to; -1 for none (the sea, or a lake with no way out); POND where water ends on open ground. */
  flow: Int8Array;
  /** Channel.None, Stream or River: what leaves the node. */
  kind: Uint8Array;
  /** Rain gathered at the node, capped. */
  rain: Uint16Array;
}

/**
 * Simulate a region's drainage. A pure function of (seed, rx, ry): `extra` widens the window it works
 * in, which must change nothing (a test checks that).
 *
 * Why the margin is enough. Counting inwards from the edge of the window, in nodes:
 *   - a flood is exact if its pit is FLOOD in (it never looks further than that from its pit);
 *   - a node's filled level is exact if every pit whose flood can reach it is: 2·FLOOD in;
 *   - whether a lake is a sink, and where its outlet starts, is exact if the whole lake's levels are
 *     and its neighbours'. A lake's nodes all lie within 2·FLOOD of the node that set its level, so
 *     within 4·FLOOD of each other: 6·FLOOD + 1 in;
 *   - a node's level after the cuts is exact if every cut that can reach it is: BREACH more;
 *   - a node's flow is exact if its level and its neighbours' are and, on a lake, the whole lake's:
 *     4·FLOOD + 1 more;
 *   - a node's rain is exact if the flow is, REACH nodes upstream: REACH more.
 */
export function computeRegion(seed: number, rx: number, ry: number, extra = 0): Region {
  const pad = HALO + MARGIN + extra;
  const S = REGION_NODES + 2 * pad + 1, n = S * S;
  const wx0 = rx * REGION_NODES - REGION_NODES / 2 - pad, wy0 = ry * REGION_NODES - REGION_NODES / 2 - pad;
  const off = DX.map((dx, d) => dx + DY[d] * S);

  // The land at each node, whether it is sea, and how much rain it adds.
  const z = new Float64Array(n), inland = new Float64Array(n), sea = new Uint8Array(n), wet = new Int32Array(n);
  const g = newGround();
  for (let j = 0, k = 0; j < S; j++) {
    for (let i = 0; i < S; i++, k++) {
      macroAt(seed, (wx0 + i) * NODE, (wy0 + j) * NODE, g);
      z[k] = g.u;
      inland[k] = g.inland;
      if (g.inland < 0) sea[k] = 1;
      else wet[k] = g.rain > 0 ? 2 : 1;
    }
  }

  // 1. Flood every hollow from its pit (a node with no lower neighbour), lowest ground first, until the
  // water reaches the sea or FLOOD nodes from the pit. The highest ground it had to cover on the way
  // is the lake's level; everything covered before that is under the lake. Two pits in one hollow
  // find the same lake. If the water was still rising when the flood was given up, the basin is too
  // wide to know its level: only its lowest part, SINK deep, is taken as under water.
  const level = z.slice();
  const lake = new Uint8Array(n);
  const stamp = new Int32Array(n);
  const side = 2 * FLOOD + 1;
  const heap = new Int32Array(side * side), covered = new Int32Array(side * side);
  const before = (a: number, b: number) => z[a] < z[b] || (z[a] === z[b] && a < b);
  let floods = 0;
  for (let pj = FLOOD; pj < S - FLOOD; pj++) {
    for (let pi = FLOOD; pi < S - FLOOD; pi++) {
      const p = pj * S + pi;
      if (sea[p]) continue;
      let pit = true;
      for (let d = 0; d < 8 && pit; d++) if (before(p + off[d], p)) pit = false;
      if (!pit) continue;

      const id = ++floods;
      let size = 0, count = 0, top = -Infinity, rose = 0, draining = false, shows = true;
      stamp[p] = id;
      heap[size++] = p;
      while (size > 0) {
        // Take the lowest node the water touches.
        const node = heap[0], last = heap[--size];
        let h = 0;
        for (;;) {
          let c = 2 * h + 1;
          if (c >= size) break;
          if (c + 1 < size && before(heap[c + 1], heap[c])) c++;
          if (!before(heap[c], last)) break;
          heap[h] = heap[c];
          h = c;
        }
        heap[h] = last;
        if (sea[node]) {
          draining = true;
          break;
        }
        covered[count++] = node;
        draining = z[node] < top;
        if (z[node] > top) {
          top = z[node];
          rose = count;
        }
        const ni = node % S, nj = (node - ni) / S;
        if (ni - pi === FLOOD || pi - ni === FLOOD || nj - pj === FLOOD || pj - nj === FLOOD) break;
        for (let d = 0; d < 8; d++) {
          const m = node + off[d];
          if (stamp[m] === id) continue;
          stamp[m] = id;
          let c = size++;
          while (c > 0) {
            const parent = (c - 1) >> 1;
            if (!before(m, heap[parent])) break;
            heap[c] = heap[parent];
            c = parent;
          }
          heap[c] = m;
        }
      }
      if (!draining) {
        // Too wide: only the lowest part, up to SINK deep, is taken as under water.
        top = z[p] + SINK;
        rose = 0;
        while (rose < count && z[covered[rose]] <= top) rose++;
      } else shows = top - z[p] >= LAKE_MIN;
      for (let t = 0; t < rose; t++) {
        const m = covered[t];
        if (top > level[m]) level[m] = top;
        if (shows) lake[m] = 1;
      }
    }
  }

  // 2. Each node drains to its lowest neighbour on the filled surface. A lake's surface is level, so
  // its nodes have no lower neighbour: they drain towards the lake's outlets (its nodes that do),
  // nearest first. A lake with no outlet at all is a sink.
  const PENDING = -2;
  const to = new Int32Array(n), seen = new Int32Array(n);
  const flat: number[] = [], queue: number[] = [];
  const inside = (k: number) => {
    const i = k % S, j = (k - i) / S;
    return i > 0 && j > 0 && i < S - 1 && j < S - 1;
  };
  let pass = 0;
  /**
   * Work out the flow. Returns one node for each sink: on the first pass its node nearest the sea,
   * where a way out can be cut; on the last its deepest node, where the water ends.
   */
  const drain = (last: boolean): number[] => {
    const sinks: number[] = [];
    pass++;
    to.fill(-1);
    for (let j = 1; j < S - 1; j++) {
      for (let i = 1; i < S - 1; i++) {
        const k = j * S + i;
        if (sea[k]) continue;
        let best = -1;
        for (let d = 0; d < 8; d++) {
          const m = k + off[d];
          if (level[m] < level[k] && (best < 0 || level[m] < level[best])) best = m;
        }
        to[k] = best < 0 ? PENDING : best;
      }
    }
    for (let k0 = 0; k0 < n; k0++) {
      if (to[k0] !== PENDING || seen[k0] === pass) continue;
      flat.length = 0;
      queue.length = 0;
      queue.push(k0);
      seen[k0] = pass;
      while (queue.length) {
        const q = queue.pop()!;
        flat.push(q);
        for (let d = 0; d < 8; d++) {
          const m = q + off[d];
          if (seen[m] !== pass && !sea[m] && level[m] === level[q] && inside(m)) {
            seen[m] = pass;
            queue.push(m);
          }
        }
      }
      flat.sort((a, b) => a - b);
      for (const q of flat) if (to[q] >= 0) queue.push(q);
      if (!queue.length) {
        let end = flat[0];
        for (const q of flat) if (last ? before(q, end) : inland[q] < inland[end]) end = q;
        to[end] = -1;
        sinks.push(end);
        queue.push(end);
      }
      for (let h = 0; h < queue.length; h++) {
        const q = queue[h];
        for (let d = 0; d < 8; d++) {
          const m = q + off[d];
          if (to[m] === PENDING && level[m] === level[q]) {
            to[m] = q;
            queue.push(m);
          }
        }
      }
    }
    return sinks;
  };

  // A sink is a basin too wide for its flood to find the way out (or two hollows that each spilled
  // into the other). It gets an outlet: from its node nearest the sea, step by step to the lowest
  // neighbour that is nearer the sea still, along a bed that drops a little each step, until the land
  // itself is lower than the bed or the sea is reached. Whatever stands in the way is lowered to the
  // bed. That only steers the flow: where a river then takes that way, the tiles get a gorge through
  // the rim. If no way out is found within BREACH nodes the basin keeps its water: an inland lake.
  const filled = level.slice();
  const path: number[] = [];
  for (const start of drain(false)) {
    const bed = filled[start];
    let a = start, out = false;
    path.length = 0;
    for (let step = 1; step <= BREACH && !out; step++) {
      let m = -1;
      for (let d = 0; d < 8; d++) {
        const c = a + off[d];
        if (inland[c] < inland[a] && (m < 0 || filled[c] < filled[m])) m = c;
      }
      if (m < 0 || !inside(m)) break;
      if (sea[m] || filled[m] < bed - step * BREACH_DROP) out = true;
      else path.push((a = m));
    }
    if (!out) continue;
    for (let step = 0; step < path.length; step++) {
      const m = path[step], cut = bed - (step + 1) * BREACH_DROP;
      if (cut < level[m]) {
        level[m] = cut;
        lake[m] = 0;
      }
    }
  }
  const pond = new Uint8Array(n);
  for (const end of drain(true)) if (!lake[end]) pond[end] = 1;

  // 3. Rain, added up along the flow from at most REACH nodes upstream. `step` holds the rain that
  // started exactly so many nodes upstream; after the loop, whatever is left came the whole REACH.
  const rain = wet.slice();
  let step = wet.slice(), next = new Int32Array(n);
  for (let s = 0; s < REACH; s++) {
    next.fill(0);
    for (let k = 0; k < n; k++) if (step[k] && to[k] >= 0) next[to[k]] += step[k];
    for (let k = 0; k < n; k++) rain[k] += next[k];
    [step, next] = [next, step];
  }

  // Keep the region's own nodes and the halo.
  const out: Region = {
    seed, rx, ry,
    x0: rx * REGION_NODES - REGION_NODES / 2 - HALO,
    y0: ry * REGION_NODES - REGION_NODES / 2 - HALO,
    level: new Float64Array(EDGE * EDGE),
    lake: new Float64Array(EDGE * EDGE),
    flow: new Int8Array(EDGE * EDGE),
    kind: new Uint8Array(EDGE * EDGE),
    rain: new Uint16Array(EDGE * EDGE),
  };
  const skip = MARGIN + extra;
  for (let j = 0, o = 0; j < EDGE; j++) {
    for (let i = 0; i < EDGE; i++, o++) {
      const k = (j + skip) * S + i + skip;
      out.level[o] = level[k];
      out.lake[o] = lake[k] || pond[k] ? level[k] : NaN;
      out.flow[o] = pond[k] ? POND : to[k] < 0 ? -1 : off.indexOf(to[k] - k);
      out.kind[o] = sea[k] ? Channel.None : kinds(rain[k], step[k] > 0);
      out.rain[o] = Math.min(65535, rain[k]);
    }
  }
  return out;
}

/**
 * What leaves a node. Rain is only counted REACH nodes upstream, so on a long river the count can
 * fall as far-off headwaters drop out of it. A channel must never shrink back to nothing on its way
 * down, so: anything that has flowed REACH nodes is a river, and it stays one, because everything
 * downstream of it has flowed at least as far. Short of that, nothing has dropped out of the count,
 * so the count can only grow downstream, and a stream stays at least a stream.
 */
function kinds(rain: number, long: boolean): number {
  return long || rain >= RIVER_RAIN ? Channel.River : rain >= STREAM_RAIN ? Channel.Stream : Channel.None;
}

/** Half a channel's width in tiles. */
function halfWidth(kind: number, rain: number): number {
  if (kind === Channel.Stream) return rain < 45 ? 0.85 : 1.25;
  return rain < 180 ? 1.7 : rain < 400 ? 2.3 : WIDEST;
}

// ---- Regions, cached. Computing one takes a fraction of a second, so the client asks a worker for
// the regions around the player ahead of time and installs them here; anything not installed is
// computed on the spot.

let maxRegions = 16;
const regions = new Map<string, Region>();
let lastRegion: Region | null = null;

export const regionOf = (tile: number) => Math.floor((Math.floor(tile / NODE) + REGION_NODES / 2) / REGION_NODES);

export function hasRegion(seed: number, rx: number, ry: number): boolean {
  return regions.has(`${seed},${rx},${ry}`);
}

export function installRegion(r: Region): void {
  const key = `${r.seed},${r.rx},${r.ry}`;
  if (!regions.has(key) && regions.size >= maxRegions) {
    const oldest = regions.keys().next().value!;
    if (regions.get(oldest) === lastRegion) lastRegion = null;
    regions.delete(oldest);
  }
  regions.set(key, r);
}

/** How many regions to hold at most (16 unless set): a map of a wide area needs more than a player does. */
export function setRegionCacheSize(count: number): void {
  maxRegions = Math.max(4, count);
}

export function getRegion(seed: number, rx: number, ry: number): Region {
  const key = `${seed},${rx},${ry}`;
  let r = regions.get(key);
  if (!r) {
    r = computeRegion(seed, rx, ry);
    installRegion(r);
  }
  return r;
}

/** Whether a region holds every node a point in the cell whose first node is (nx, ny) can need. */
const covers = (r: Region, seed: number, nx: number, ny: number) =>
  r.seed === seed && nx - r.x0 >= 4 && nx - r.x0 <= EDGE - 6 && ny - r.y0 >= 4 && ny - r.y0 <= EDGE - 6;

/**
 * A region that covers a cell. Regions overlap by their halos and agree wherever they overlap, so any
 * region already held that covers the cell will do: a chunk on a region's edge doesn't make its
 * neighbour get computed.
 */
function regionFor(seed: number, nx: number, ny: number): Region {
  if (lastRegion && covers(lastRegion, seed, nx, ny)) return lastRegion;
  const rx = Math.floor((nx + REGION_NODES / 2) / REGION_NODES), ry = Math.floor((ny + REGION_NODES / 2) / REGION_NODES);
  let r = regions.get(`${seed},${rx},${ry}`);
  if (!r) for (const held of regions.values()) if (covers(held, seed, nx, ny)) r = held;
  return (lastRegion = r ?? getRegion(seed, rx, ry));
}

// ---- Channels near a point. A node's river point is the node, nudged. A channel does not run from
// point to point, which would turn a corner at every node: it runs from the middle of one span to the
// middle of the next, bending past the point between them, in four straight pieces. Along that
// stretch the water falls from the level of the node behind to the level of the node it bends past,
// so it is never below the level of a lake it is still crossing.

const PIECE = 9;
const pieces = new Float64Array(PIECE * 5 * 36);
let pieceCount = 0, piecesOf: Region | null = null, piecesI = 0, piecesJ = 0;
let left = 0, right = 0, up = 0, down = 0;

const nudge = (seed: number, gx: number, gy: number, salt: number) => (hash2(seed ^ salt, gx, gy) / 4294967296 - 0.5) * 2;

/** Keep a straight piece of channel if it can shape the ground of the cell being gathered for. */
function piece(ax: number, ay: number, bx: number, by: number, la: number, lb: number, ha: number, hb: number, kind: number) {
  if (Math.max(ax, bx) < left || Math.min(ax, bx) > right || Math.max(ay, by) < up || Math.min(ay, by) > down) return;
  const o = pieceCount++ * PIECE;
  pieces[o] = ax; pieces[o + 1] = ay; pieces[o + 2] = bx; pieces[o + 3] = by;
  pieces[o + 4] = la; pieces[o + 5] = lb; pieces[o + 6] = ha; pieces[o + 7] = hb; pieces[o + 8] = kind;
}

function gatherPieces(r: Region, i0: number, j0: number) {
  piecesOf = r;
  piecesI = i0;
  piecesJ = j0;
  pieceCount = 0;
  const seed = r.seed;
  // The cell, grown by how far a channel shapes the ground.
  const reach = CARVE + WIDEST;
  left = (r.x0 + i0) * NODE - reach;
  right = (r.x0 + i0 + 1) * NODE + reach;
  up = (r.y0 + j0) * NODE - reach;
  down = (r.y0 + j0 + 1) * NODE + reach;
  for (let j = j0 - 2; j <= j0 + 3; j++) {
    for (let i = i0 - 2; i <= i0 + 3; i++) {
      const k = j * EDGE + i, kind = r.kind[k], d = r.flow[k];
      if (!kind || d < 0) continue;
      const m = k + DX[d] + DY[d] * EDGE, dm = r.flow[m];
      const gx = r.x0 + i, gy = r.y0 + j, hx = gx + DX[d], hy = gy + DY[d];
      const ax = gx * NODE + JITTER * nudge(seed, gx, gy, 0x3a71), ay = gy * NODE + JITTER * nudge(seed, gx, gy, 0x51c9);
      const bx = hx * NODE + JITTER * nudge(seed, hx, hy, 0x3a71), by = hy * NODE + JITTER * nudge(seed, hx, hy, 0x51c9);
      // The water never stands below the sea.
      const la = Math.max(0, r.level[k]), lb = Math.max(0, r.level[m]);
      const ha = halfWidth(kind, r.rain[k]), hb = r.kind[m] ? Math.max(ha, halfWidth(r.kind[m], r.rain[m])) : ha;
      // The middle of this node's span: where its stretch of channel starts.
      const sx = (ax + bx) / 2, sy = (ay + by) / 2, sh = (ha + hb) / 2;

      // A channel's first node has nothing arriving at it: the channel starts at its point.
      let head = true;
      for (let e = 0; e < 8 && head; e++) {
        const from = k + DX[e] + DY[e] * EDGE;
        if (r.kind[from] && r.flow[from] === (e + 4) % 8) head = false;
      }
      if (head) piece(ax, ay, sx, sy, la, la, ha, sh, kind);

      if (dm < 0) {
        // The next node is the end (the sea, or a lake with no way out): straight to it.
        piece(sx, sy, bx, by, la, lb, sh, hb, kind);
        continue;
      }
      // Otherwise: on to the middle of the next span, bending past the next node's point.
      const ix = hx + DX[dm], iy = hy + DY[dm], n = m + DX[dm] + DY[dm] * EDGE;
      const cx = ix * NODE + JITTER * nudge(seed, ix, iy, 0x3a71), cy = iy * NODE + JITTER * nudge(seed, ix, iy, 0x51c9);
      const hc = r.kind[n] ? Math.max(hb, halfWidth(r.kind[n], r.rain[n])) : hb;
      const ex = (bx + cx) / 2, ey = (by + cy) / 2, eh = (hb + hc) / 2;
      const next = r.kind[m] > kind ? r.kind[m] : kind;
      const ford = kind === Channel.River && hash2(seed ^ 0x6f0d, gx, gy) % FORD_EVERY === 0;
      let px = sx, py = sy, pl = la, ph = sh;
      for (let q = 1; q <= 4; q++) {
        // A point on the curve from the start, past (bx, by), to the end.
        const t = q / 4, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
        const qx = a * sx + b * bx + c * ex, qy = a * sy + b * by + c * ey;
        const ql = q === 4 ? lb : la + (lb - la) * t, qh = a * sh + b * hb + c * eh;
        piece(px, py, qx, qy, pl, ql, ph, qh, ford && (q === 2 || q === 3) ? Channel.Stream : q <= 2 ? kind : next);
        px = qx; py = qy; pl = ql; ph = qh;
      }
    }
  }
}

/** Each span of channel that starts at one of a region's own nodes, as a straight line between river points: for drawing maps. */
export function channelSpans(r: Region, each: (ax: number, ay: number, bx: number, by: number, kind: number) => void): void {
  for (let j = HALO; j < EDGE - HALO - 1; j++) {
    for (let i = HALO; i < EDGE - HALO - 1; i++) {
      const k = j * EDGE + i, d = r.flow[k];
      if (!r.kind[k] || d < 0) continue;
      const gx = r.x0 + i, gy = r.y0 + j, hx = gx + DX[d], hy = gy + DY[d];
      each(
        gx * NODE + JITTER * nudge(r.seed, gx, gy, 0x3a71), gy * NODE + JITTER * nudge(r.seed, gx, gy, 0x51c9),
        hx * NODE + JITTER * nudge(r.seed, hx, hy, 0x3a71), hy * NODE + JITTER * nudge(r.seed, hx, hy, 0x51c9), r.kind[k],
      );
    }
  }
}

/** The channel a point is in: Channel.None, Stream or River. Geometry only: a lake or the sea over it wins (see tileAt). */
export function channelAt(seed: number, x: number, y: number): number {
  const nx = Math.floor(x / NODE), ny = Math.floor(y / NODE);
  const r = regionFor(seed, nx, ny);
  if (r !== piecesOf || nx - r.x0 !== piecesI || ny - r.y0 !== piecesJ) gatherPieces(r, nx - r.x0, ny - r.y0);
  let channel = 0;
  for (let o = 0; o < pieceCount * PIECE; o += PIECE) {
    const ax = pieces[o], ay = pieces[o + 1], dx = pieces[o + 2] - ax, dy = pieces[o + 3] - ay;
    let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + t * dx), ey = y - (ay + t * dy);
    const half = pieces[o + 6] + (pieces[o + 7] - pieces[o + 6]) * t;
    if (ex * ex + ey * ey <= half * half && pieces[o + 8] > channel) channel = pieces[o + 8];
  }
  return channel;
}

/**
 * The land at a point with its water: groundAt, then channels carved in and lakes filled. A pure
 * function of (seed, x, y); `x` and `y` may be fractional. See Ground for `lake` and `channel`.
 */
export function landAt(seed: number, x: number, y: number, g: Ground): void {
  groundAt(seed, x, y, g);
  // The open sea has no rivers in it.
  if (g.inland < 0) return;
  const nx = Math.floor(x / NODE), ny = Math.floor(y / NODE);
  const r = regionFor(seed, nx, ny);
  const i0 = nx - r.x0, j0 = ny - r.y0;
  if (r !== piecesOf || i0 !== piecesI || j0 !== piecesJ) gatherPieces(r, i0, j0);
  let u = g.u;

  // A pond: a bowl dug around the river point of a node where water ends.
  const k = j0 * EDGE + i0;
  for (let c = 0; c < 4; c++) {
    const q = k + (c & 1) + (c >> 1) * EDGE;
    if (r.flow[q] !== POND) continue;
    const gx = r.x0 + i0 + (c & 1), gy = r.y0 + j0 + (c >> 1);
    const ex = x - (gx * NODE + JITTER * nudge(seed, gx, gy, 0x3a71)), ey = y - (gy * NODE + JITTER * nudge(seed, gx, gy, 0x51c9));
    const near = 1 - (ex * ex + ey * ey) / (POND_RADIUS * POND_RADIUS);
    if (near > 0 && r.level[q] - POND_DEPTH * near < u) u = r.level[q] - POND_DEPTH * near;
  }

  // Each channel nearby asks for a valley: no higher than its banks rising away from it, and no lower
  // than a gentle levee falling away from it. Where they disagree the valley wins.
  let cut = Infinity, fill = -Infinity, water = Infinity, channel = 0;
  for (let o = 0; o < pieceCount * PIECE; o += PIECE) {
    const ax = pieces[o], ay = pieces[o + 1], dx = pieces[o + 2] - ax, dy = pieces[o + 3] - ay;
    let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + t * dx), ey = y - (ay + t * dy);
    const half = pieces[o + 6] + (pieces[o + 7] - pieces[o + 6]) * t;
    const far = half + CARVE, d2 = ex * ex + ey * ey;
    if (d2 > far * far) continue;
    const surface = pieces[o + 4] + (pieces[o + 5] - pieces[o + 4]) * t;
    const out = Math.sqrt(d2) - half;
    if (out <= 0) {
      if (surface < water) water = surface;
      if (pieces[o + 8] > channel) channel = pieces[o + 8];
      if (surface < cut) cut = surface;
      if (surface > fill) fill = surface;
    } else {
      if (surface + BANK * out < cut) cut = surface + BANK * out;
      if (surface - LEVEE * out > fill) fill = surface - LEVEE * out;
    }
  }

  // Lakes. The water's height here is the lake's level near its own nodes, falling away to below the
  // ground towards nodes that aren't under it; never above the level itself (the lower level, where
  // two lakes meet, so water only steps down from one to the other). Not on the strip along the
  // coast: a lake never touches the sea.
  let lake = -Infinity;
  const a = r.lake[k], b = r.lake[k + 1], c = r.lake[k + EDGE], d = r.lake[k + EDGE + 1];
  if (g.inland >= COAST_STRIP && (a === a || b === b || c === c || d === d)) {
    let cap = Infinity;
    if (a === a && a < cap) cap = a;
    if (b === b && b < cap) cap = b;
    if (c === c && c < cap) cap = c;
    if (d === d && d < cap) cap = d;
    const fx = x / NODE - nx, fy = y / NODE - ny;
    const la = a === a ? a : r.level[k] - SHORE, lb = b === b ? b : r.level[k + 1] - SHORE;
    const lc = c === c ? c : r.level[k + EDGE] - SHORE, ld = d === d ? d : r.level[k + EDGE + 1] - SHORE;
    const north = la + (lb - la) * fx, south = lc + (ld - lc) * fx;
    lake = north + (south - north) * fy;
    if (lake > cap) lake = cap;
    if (lake > u) {
      // Under the lake already. The flow that crosses a lake leaves its bed alone; where a channel's
      // water stands above the lake's thinning edge, the surface is the channel's.
      if (channel && water > lake) lake = water;
      g.lake = lake - u;
      g.u = lake;
      return;
    }
  }

  if (fill > u) u = fill;
  if (cut < u) u = cut;
  if (channel) {
    // The water's surface. It meets a lake at the lake's own level, so it is not sunk below its banks.
    u = water;
    g.channel = channel;
  }
  // A channel can cut the ground at a lake's edge to below its water.
  if (lake > -Infinity) {
    g.lake = lake - u;
    if (lake > u) {
      u = lake;
      g.channel = 0;
    }
  }
  g.u = u;
}
