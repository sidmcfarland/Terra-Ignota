import { describe, expect, it } from 'vitest';
import {
  HOST_SWITCH_HOLD_MS, bestHost, canHost, clientCap, hostScore, reviewHost, sanitizeMetrics,
  type Candidate, type HostMetrics,
} from './index.ts';

const desktop = (over: Partial<HostMetrics> = {}): HostMetrics => ({
  optIn: true, visible: true, mobile: false, battery: false, rttMs: 20, uptimeMs: 60_000,
  hostedMs: 0, uncleanExits: 0, lateTicks: 0, cap: 32, ...over,
});

describe('host eligibility and score', () => {
  it('requires opt-in, foreground, desktop and mains power', () => {
    expect(canHost(desktop())).toBe(true);
    expect(canHost(desktop({ optIn: false }))).toBe(false);
    expect(canHost(desktop({ visible: false }))).toBe(false);
    expect(canHost(desktop({ mobile: true }))).toBe(false);
    expect(canHost(desktop({ battery: true }))).toBe(false);
  });

  it('rewards low ping, uptime and hosting history; penalises crashes, late ticks and overload', () => {
    const base = hostScore(desktop(), 2);
    expect(hostScore(desktop({ rttMs: 200 }), 2)).toBeLessThan(base);
    expect(hostScore(desktop({ uptimeMs: 20 * 60_000 }), 2)).toBeGreaterThan(base);
    expect(hostScore(desktop({ hostedMs: 5 * 3_600_000 }), 2)).toBeGreaterThan(base);
    expect(hostScore(desktop({ uncleanExits: 2 }), 2)).toBeLessThan(base);
    expect(hostScore(desktop({ lateTicks: 0.3 }), 2)).toBeLessThan(base);
    expect(hostScore(desktop({ cap: 4 }), 10)).toBeLessThan(hostScore(desktop({ cap: 4 }), 3));
  });

  it('estimates capacity from cores and late ticks', () => {
    expect(clientCap(8, 0)).toBe(32);
    expect(clientCap(64, 0)).toBe(48);
    expect(clientCap(8, 0.5)).toBe(16);
  });

  it('sanitises untrusted metrics', () => {
    const m = sanitizeMetrics({ optIn: 'yes', rttMs: -5, lateTicks: 7, cap: 'x' });
    expect(m.optIn).toBe(false);
    expect(m.rttMs).toBe(0);
    expect(m.lateTicks).toBe(1);
    expect(m.cap).toBe(0);
    expect(sanitizeMetrics(null).rttMs).toBe(500);
  });
});

describe('host election', () => {
  it('picks the best eligible peer, falls back to anyone, then to join order', () => {
    const c: Candidate[] = [
      { id: 'a', m: desktop({ rttMs: 100 }) },
      { id: 'b', m: desktop({ rttMs: 10 }) },
      { id: 'c', m: desktop({ rttMs: 1, mobile: true }) },
    ];
    expect(bestHost(c)).toBe('b');
    expect(bestHost([{ id: 'p', m: desktop({ mobile: true }) }, { id: 'q', m: desktop({ battery: true, rttMs: 1 }) }]))
      .toBe('q');
    expect(bestHost([{ id: 'x', m: null }, { id: 'y', m: null }])).toBe('x');
  });

  it('replaces a missing host at once', () => {
    const c: Candidate[] = [{ id: 'b', m: desktop() }];
    expect(reviewHost('gone', c, null, 0).host).toBe('b');
  });

  it('hands off at once when the host backgrounds or opts out, if someone can take over', () => {
    const c: Candidate[] = [{ id: 'h', m: desktop({ visible: false }) }, { id: 'b', m: desktop() }];
    expect(reviewHost('h', c, null, 0).host).toBe('b');
    const alone: Candidate[] = [{ id: 'h', m: desktop({ optIn: false }) }, { id: 'p', m: desktop({ mobile: true }) }];
    expect(reviewHost('h', alone, null, 0).host).toBe('h');
  });

  it('needs a 20% better challenger for 30s before switching', () => {
    const host = desktop({ rttMs: 300, uptimeMs: 0 }); // score 70
    const close = desktop({ rttMs: 250, uptimeMs: 0 }); // 75: not enough
    const strong = desktop({ rttMs: 10, uptimeMs: 0 }); // 99: more than 84 needed
    expect(reviewHost('h', [{ id: 'h', m: host }, { id: 'c', m: close }], null, 0))
      .toEqual({ host: 'h', challenge: null });

    const c: Candidate[] = [{ id: 'h', m: host }, { id: 's', m: strong }];
    let r = reviewHost('h', c, null, 1000);
    expect(r).toEqual({ host: 'h', challenge: { id: 's', since: 1000 } });
    r = reviewHost('h', c, r.challenge, 1000 + HOST_SWITCH_HOLD_MS - 1);
    expect(r.host).toBe('h');
    r = reviewHost('h', c, r.challenge, 1000 + HOST_SWITCH_HOLD_MS);
    expect(r).toEqual({ host: 's', challenge: null });
  });

  it('resets the challenge when the challenger drops back', () => {
    const host = desktop({ rttMs: 300, uptimeMs: 0 });
    const r = reviewHost('h', [{ id: 'h', m: host }, { id: 's', m: desktop({ rttMs: 290, uptimeMs: 0 }) }],
      { id: 's', since: 0 }, HOST_SWITCH_HOLD_MS * 2);
    expect(r).toEqual({ host: 'h', challenge: null });
  });
});
