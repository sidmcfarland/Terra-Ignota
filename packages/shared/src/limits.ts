/**
 * Budgets a host holds its links to, so one peer can't flood it: message rates
 * and sizes per channel, and how many edits may arrive through catch-up.
 */
import { CHUNK } from './constants.ts';

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
 * hello, its digests, edits as it paints (10 a second at most), and answers
 * to the host's catch-up requests (up to 6 messages per chunk).
 */
export const CLIENT_LIMITS: LinkLimits = {
  rPerSec: 20, rBurst: 80, uPerSec: 50, uBurst: 100, rMaxBytes: 64 * 1024, uMaxBytes: 64, strikes: 200,
};

/** What a host accepts from a neighbouring host or a seed: player lists and positions 20 times a second, and edits. */
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

/** Edits per second, and in one burst, that a host verifies and merges from one peer's catch-up (four chunks' worth at once). */
export const SYNC_OPS_PER_SEC = 512;
export const SYNC_OPS_BURST = 4 * CHUNK * CHUNK;
/** Chunks a host has on request from one peer at a time, and how long it waits for the answers. */
export const SYNC_CHUNKS_AT_ONCE = 4;
export const SYNC_ANSWER_MS = 10_000;
