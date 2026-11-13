/**
 * Budgets a host holds its links to, so one peer can't flood it: message rates
 * and sizes per channel, and how many edits may arrive through catch-up.
 */
import { CHUNK } from './constants.ts';
import { LAYERS, type BucketId } from './edits.ts';

/** A budget that refills at `rate` per second, up to `burst`. Times are in milliseconds. */
export class TokenBucket {
  private tokens: number;
  private last = -1;
  private readonly rate: number;
  private readonly burst: number;

  constructor(rate: number, burst: number) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
  }

  /** What's in the bucket at `now`. */
  available(now: number): number {
    if (this.last >= 0 && now > this.last) this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    if (now > this.last) this.last = now;
    return this.tokens;
  }

  /** Spend n if the bucket holds that much. */
  take(now: number, n = 1): boolean {
    if (this.available(now) < n) return false;
    this.tokens -= n;
    return true;
  }
}

export interface LinkLimits {
  /** Messages per second and burst, per channel. */
  rPerSec: number;
  rBurst: number;
  uPerSec: number;
  uBurst: number;
  /** Largest message accepted, per channel (bytes; characters for JSON). */
  rMaxBytes: number;
  uMaxBytes: number;
  /** Dropped messages tolerated per 10 seconds before the link is cut. */
  strikes: number;
}

/**
 * What a host accepts from one client. A client normally sends 20 position
 * reports and a probe reply a second, and a handful of reliable messages: its
 * hello, its digests (at most about 30,000 characters: see SYNC_ATLAS_ZONES),
 * ops as it plays (10 a second at most), and answers to the host's catch-up
 * requests. The host only asks for as many ops as its catch-up budget holds
 * (SYNC_OPS_BURST), so those answers are at most about 41 messages at once and
 * 5 a second after that. A message of OPS_PER_MESSAGE ops is at most about
 * 50,000 characters.
 */
export const CLIENT_LIMITS: LinkLimits = {
  rPerSec: 20, rBurst: 80, uPerSec: 50, uBurst: 100, rMaxBytes: 64 * 1024, uMaxBytes: 64, strikes: 200,
};

/**
 * What a host accepts from a neighbouring host or a seed: player lists and
 * positions 20 times a second, and ops. World-scope ops cross these links from
 * the whole world, so their senders batch them (RELAY_FLUSH_MS): a few messages
 * a second however many ops there are.
 */
export const HOST_LINK_LIMITS: LinkLimits = {
  rPerSec: 40, rBurst: 120, uPerSec: 50, uBurst: 100, rMaxBytes: 64 * 1024, uMaxBytes: 32 * 1024, strikes: 200,
};

/** Decides, message by message, whether a link is within its limits. */
export class LinkGuard {
  /** Messages refused so far. */
  dropped = 0;
  /** Set once the peer has overrun its limits so persistently that the link should be closed. */
  tripped = false;
  private readonly limits: LinkLimits;
  private readonly r: TokenBucket;
  private readonly u: TokenBucket;
  private readonly strikes: TokenBucket;

  constructor(limits: LinkLimits) {
    this.limits = limits;
    this.r = new TokenBucket(limits.rPerSec, limits.rBurst);
    this.u = new TokenBucket(limits.uPerSec, limits.uBurst);
    this.strikes = new TokenBucket(limits.strikes / 10, limits.strikes);
  }

  /** Whether to handle a message of this size that just arrived on the reliable ('r') or unreliable ('u') channel. */
  allow(channel: 'r' | 'u', bytes: number, now: number): boolean {
    const reliable = channel === 'r';
    const ok = bytes <= (reliable ? this.limits.rMaxBytes : this.limits.uMaxBytes) && (reliable ? this.r : this.u).take(now);
    if (!ok) {
      this.dropped++;
      if (!this.strikes.take(now)) this.tripped = true;
    }
    return ok;
  }
}

/**
 * Ops per second, and in one burst, that a host verifies and merges from one peer's catch-up (four chunks of
 * painted tiles at once). The same budget holds what a neighbouring host or a seed may pass on unasked.
 */
export const SYNC_OPS_PER_SEC = 512;
export const SYNC_OPS_BURST = 4 * CHUNK * CHUNK;
/** Buckets a host has on request from one peer at a time, and how long it waits for the answers. */
export const SYNC_CHUNKS_AT_ONCE = 4;
export const SYNC_ANSWER_MS = 10_000;
/** Ops per 'edits' message sent, to keep it well under a link's size cap; and the most read from one received. */
export const OPS_PER_MESSAGE = 100;
export const MAX_OPS_PER_MESSAGE = 1024;
/** Zones of the atlas a peer lists digests for when it syncs (the nearest first). About 30 characters each. */
export const SYNC_ATLAS_ZONES = 1024;
/** How long a host or a seed gathers world-scope ops before passing them on to another host. */
export const RELAY_FLUSH_MS = 250;

/** Open zone-scope layers: each can hold one op per tile of a chunk. */
const CHUNK_LAYERS = Object.values(LAYERS).filter((d) => d.scope === 'zone' && d.value && !d.perAuthor).length;

/**
 * The most ops a host takes for one bucket in one catch-up, whatever the peer
 * says it holds: what a chunk can hold, a handful for a player, and for a
 * zone's atlas as much as the budget ever holds at once.
 */
export function bucketCap(id: BucketId): number {
  if (id.startsWith('c:')) return Math.min(SYNC_OPS_BURST, CHUNK_LAYERS * CHUNK * CHUNK);
  return id.startsWith('p:') ? 16 : SYNC_OPS_BURST;
}
