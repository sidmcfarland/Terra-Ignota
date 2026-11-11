import { expect, test, type Browser, type Page } from '@playwright/test';

interface Probe {
  role: string;
  self: { x: number; y: number };
  remotes: Array<{ id: string; name: string; x: number; y: number } | null>;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const ti = (window as any).__ti;
    const now = performance.now();
    return {
      role: ti.session.role,
      self: { x: ti.self.x, y: ti.self.y },
      remotes: [...ti.session.remotes.values()].map((r: any) => {
        const p = ti.session.sample(r, now);
        return p && { id: r.info.id, name: r.info.name, x: p.x, y: p.y };
      }),
    };
  });
}

async function join(browser: Browser, world: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(`/#w=${world}`);
  await page.waitForFunction(() => (window as any).__ti?.session);
  return page;
}

test('two players see each other move', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');

  // Each sees exactly one remote player.
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length).toBe(1);
  await expect.poll(async () => (await probe(b)).remotes.filter(Boolean).length).toBe(1);

  // B moves; A's view of B tracks B's real position.
  const before = (await probe(b)).self;
  await b.keyboard.down('d');
  await b.waitForTimeout(800);
  await b.keyboard.up('d');
  const after = (await probe(b)).self;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0.5);
  await expect.poll(async () => {
    const r = (await probe(a)).remotes[0]!;
    return Math.hypot(r.x - after.x, r.y - after.y);
  }).toBeLessThan(0.05);

  // A moves; B sees it via the host snapshot.
  await a.keyboard.down('s');
  await a.waitForTimeout(500);
  await a.keyboard.up('s');
  const aPos = (await probe(a)).self;
  await expect.poll(async () => {
    const r = (await probe(b)).remotes[0]!;
    return Math.hypot(r.x - aPos.x, r.y - aPos.y);
  }).toBeLessThan(0.05);
});

test('host leaving hands the zone to a remaining player', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  const c = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(c)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(c)).remotes.filter(Boolean).length).toBe(2);

  const t0 = Date.now();
  await a.context().close();

  // B joined first, so it becomes host; C reconnects to it.
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('host');
  await expect.poll(async () => (await probe(c)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(c)).remotes.filter(Boolean).length, { timeout: 20_000 }).toBe(1);
  expect(Date.now() - t0).toBeLessThan(5000);
  await expect.poll(async () => (await probe(b)).remotes.filter(Boolean).length).toBe(1);
});
