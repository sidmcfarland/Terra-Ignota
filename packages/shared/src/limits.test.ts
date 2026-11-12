import { describe, expect, it } from 'vitest';
import { CLIENT_LIMITS, LinkGuard, TokenBucket } from './limits.ts';

describe('TokenBucket', () => {
  it('starts full and refuses once empty', () => {
    const b = new TokenBucket(10, 3);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
  });

  it('refills at its rate, up to its burst', () => {
    const b = new TokenBucket(10, 3);
    for (let i = 0; i < 3; i++) b.take(0);
    expect(b.take(50)).toBe(false); // Half a token so far.
    expect(b.take(100)).toBe(true);
    expect(b.available(60_000)).toBe(3); // Never more than the burst.
  });

  it('spends several at once only if it holds that many', () => {
    const b = new TokenBucket(100, 1000);
    expect(b.take(0, 800)).toBe(true);
    expect(b.take(0, 300)).toBe(false);
    expect(b.available(0)).toBe(200); // A refused take spends nothing.
    expect(b.take(1000, 300)).toBe(true);
  });

  it('ignores a clock that goes backwards', () => {
    const b = new TokenBucket(10, 2);
    b.take(1000);
    b.take(1000);
    expect(b.take(500)).toBe(false);
    expect(b.take(1100)).toBe(true);
  });
});

describe('LinkGuard', () => {
  it('lets a normal client through', () => {
    const g = new LinkGuard(CLIENT_LIMITS);
    let refused = 0;
    // A minute of play: 20 position reports and a pong a second, plus an edit every 100ms.
    for (let ms = 0; ms < 60_000; ms += 50) {
      if (!g.allow('u', 12, ms)) refused++;
      if (ms % 1000 === 0 && !g.allow('u', 9, ms)) refused++;
      if (ms % 100 === 0 && !g.allow('r', 210, ms)) refused++;
    }
    expect(refused).toBe(0);
    expect(g.tripped).toBe(false);
  });

  it('drops what exceeds the rate, and recovers', () => {
    const g = new LinkGuard(CLIENT_LIMITS);
    let passed = 0;
    for (let i = 0; i < 150; i++) if (g.allow('u', 12, 0)) passed++;
    expect(passed).toBe(CLIENT_LIMITS.uBurst);
    expect(g.dropped).toBe(50);
    expect(g.tripped).toBe(false);
    expect(g.allow('u', 12, 1000)).toBe(true);
  });

  it('drops oversized messages', () => {
    const g = new LinkGuard(CLIENT_LIMITS);
    expect(g.allow('u', CLIENT_LIMITS.uMaxBytes + 1, 0)).toBe(false);
    expect(g.allow('r', CLIENT_LIMITS.rMaxBytes + 1, 0)).toBe(false);
    expect(g.allow('r', CLIENT_LIMITS.rMaxBytes, 0)).toBe(true);
  });

  it('budgets the two channels separately', () => {
    const g = new LinkGuard(CLIENT_LIMITS);
    for (let i = 0; i < CLIENT_LIMITS.uBurst + 10; i++) g.allow('u', 12, 0);
    expect(g.allow('r', 100, 0)).toBe(true);
  });

  it('trips when a peer keeps flooding', () => {
    const g = new LinkGuard(CLIENT_LIMITS);
    // 1000 messages a second: 50 pass, the rest are dropped.
    let ms = 0;
    for (; ms < 5000 && !g.tripped; ms++) g.allow('u', 12, ms);
    expect(g.tripped).toBe(true);
    expect(ms).toBeLessThan(1000);
  });
});
