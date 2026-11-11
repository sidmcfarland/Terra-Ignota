import { expect, test, type Browser, type Page } from '@playwright/test';

interface Probe {
  role: string;
  zone: string;
  self: { x: number; y: number };
  remotes: Array<{ id: string; name: string; x: number; y: number } | null>;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const ti = (window as any).__ti;
    const now = performance.now();
    return {
      role: ti.session.role,
      zone: ti.session.zone,
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
  // render=0: these tests check networking state only, and software WebGL in
  // headless Chromium is slow enough to break handoff timings.
  await page.goto(`/#w=${world}&render=0&debug=1`);
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

  // Debug panels: the host lists what B reports; B names the host it reports to.
  const nameOf = (p: Page) => p.evaluate(() => (window as any).__ti.cfg.name as string);
  const [aName, bName] = [await nameOf(a), await nameOf(b)];
  await expect(a.locator('#debug')).toContainText('CLIENTS 1');
  await expect(a.locator('#debug')).toContainText(bName.slice(0, 19));
  await expect(b.locator('#debug')).toContainText(`HOST   ${aName}`);

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

// Mirrors packages/shared/src/constants.ts (ZONE_TILES = 32 * 8, ZONE_MARGIN = 32).
const ZONE_TILES = 256;
const ZONE_MARGIN = 32;

async function teleport(page: Page, x: number) {
  await page.evaluate((x) => ((window as any).__ti.self.x = x), x);
}

test('crossing a zone border moves the player to that zone, with a margin', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length).toBe(1);

  const home = (await probe(b)).zone;
  const [zx, zy] = home.split(',').map(Number);
  const border = (zx + 1) * ZONE_TILES;
  const east = `${zx + 1},${zy}`;

  // Just past the border, inside the margin: no switch.
  await teleport(b, border + 5);
  await b.waitForTimeout(500);
  expect((await probe(b)).zone).toBe(home);

  // Past the margin: B leaves A's zone and hosts the empty zone to the east.
  await teleport(b, border + ZONE_MARGIN + 5);
  await expect.poll(async () => (await probe(b)).zone).toBe(east);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('host');
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length).toBe(0);
  expect((await probe(a)).role).toBe('host');

  // Back over the border but inside the margin: stays east.
  await teleport(b, border - 5);
  await b.waitForTimeout(500);
  expect((await probe(b)).zone).toBe(east);

  // Past the margin on the way back: rejoins A's zone as a client.
  await teleport(b, border - ZONE_MARGIN - 5);
  await expect.poll(async () => (await probe(b)).zone).toBe(home);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length).toBe(1);
  await expect.poll(async () => (await probe(b)).remotes.filter(Boolean).length).toBe(1);
});

test('a host leaving its zone hands the zone to a remaining player', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');

  const [zx] = (await probe(a)).zone.split(',').map(Number);
  await teleport(a, (zx + 1) * ZONE_TILES + ZONE_MARGIN + 5);

  await expect.poll(async () => (await probe(a)).role, { timeout: 20_000 }).toBe('host');
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('host');
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length).toBe(0);
  await expect.poll(async () => (await probe(b)).remotes.filter(Boolean).length).toBe(0);
  expect((await probe(a)).zone).not.toBe((await probe(b)).zone);
});
