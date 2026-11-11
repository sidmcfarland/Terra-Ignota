import { expect, test, type Browser, type Page } from '@playwright/test';

interface Probe {
  role: string;
  zone: string;
  /** Clients this peer hosts, and open links to neighbouring zones' hosts. */
  clients: number;
  borders: number;
  /** The zone's backups as last announced, and the host tick this peer has seen. */
  backups: string[];
  tick: number;
  backupRank: number | null;
  stateTick: number | null;
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
      clients: ti.session.clientsDebug().length,
      borders: ti.session.bordersDebug().filter((b: any) => b.open).length,
      backups: [...ti.session.backups],
      tick: ti.session.currentTick,
      backupRank: ti.session.hostDebug()?.backupRank ?? null,
      stateTick: ti.session.hostDebug()?.stateTick ?? null,
      self: { x: ti.self.x, y: ti.self.y },
      remotes: [...ti.session.remotes.values()].map((r: any) => {
        const p = ti.session.sample(r, now);
        return p && { id: r.info.id, name: r.info.name, x: p.x, y: p.y };
      }),
    };
  });
}

async function join(browser: Browser, world: string, extra = ''): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  // render=0: these tests check networking state only, and software WebGL in
  // headless Chromium is slow enough to break handoff timings.
  await page.goto(`/#w=${world}&render=0&debug=1${extra}`);
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

  // The better-scoring of B and C takes over at once; the other reconnects to it.
  await expect.poll(async () => [(await probe(b)).role, (await probe(c)).role].sort().join(), { timeout: 20_000 })
    .toBe('client,host');
  const [host, client] = (await probe(b)).role === 'host' ? [b, c] : [c, b];
  await expect.poll(async () => (await probe(client)).remotes.filter(Boolean).length, { timeout: 20_000 }).toBe(1);
  expect(Date.now() - t0).toBeLessThan(5000);
  await expect.poll(async () => (await probe(host)).remotes.filter(Boolean).length).toBe(1);
});

test('a host that opts out hands over to an eligible player', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  // A peer that has opted out still hosts when it's alone, so play goes on...
  const a = await join(browser, world, '&host=0');
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  // ...but hands over as soon as an eligible player is in the zone.
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 10_000 }).toBe('host');
  await expect.poll(async () => (await probe(a)).role, { timeout: 10_000 }).toBe('client');
  await expect(a.locator('#hostBtn')).toHaveText('Hosting off');

  // B turns hosting off from the HUD; A is still opted out, so nobody better can take over.
  await b.locator('#hostBtn').click();
  await expect(b.locator('#hostBtn')).toHaveText('Hosting off');
  await b.waitForTimeout(2500);
  expect((await probe(b)).role).toBe('host');

  // A opts back in: B, opted out, hands over at once.
  const t0 = Date.now();
  await a.locator('#hostBtn').click();
  await expect.poll(async () => (await probe(a)).role, { timeout: 10_000 }).toBe('host');
  await expect.poll(async () => (await probe(b)).role, { timeout: 10_000 }).toBe('client');
  expect(Date.now() - t0).toBeLessThan(5000);
});

test('a hung host is detected and its first backup takes over with its state', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  const c = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(c)).role, { timeout: 20_000 }).toBe('client');

  // Both clients become backups, and state reaches them.
  await expect.poll(async () => (await probe(a)).backups.length, { timeout: 10_000 }).toBe(2);
  await expect.poll(async () => (await probe(b)).stateTick ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await probe(c)).stateTick ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  const [first] = (await probe(a)).backups;
  const [bId, cId] = [await peerIdOf(b), await peerIdOf(c)];
  const [heir, other] = first === bId ? [b, c] : [c, b];
  expect([bId, cId]).toContain(first);
  const tickBefore = (await probe(a)).tick;

  // Freeze A's page script. Its socket stays open, so only the silence watchdog
  // and the directory's probe can tell that it's gone.
  const t0 = Date.now();
  void a.evaluate(() => {
    for (;;) { /* hang */ }
  }).catch(() => {});

  await expect.poll(async () => (await probe(heir)).role, { timeout: 10_000 }).toBe('host');
  const tookMs = Date.now() - t0;
  await expect.poll(async () => (await probe(other)).role, { timeout: 10_000 }).toBe('client');
  await expect.poll(async () => (await probe(other)).remotes.filter(Boolean).length, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await probe(heir)).remotes.filter(Boolean).length, { timeout: 10_000 }).toBe(1);
  expect((await probe(heir)).tick).toBeGreaterThanOrEqual(tickBefore); // The tick carried on from A's state.
  console.log(`hung host replaced in ${tookMs}ms`);
  expect(tookMs).toBeLessThan(4000);

  await a.context().close().catch(() => {});
});

test('a host whose tab goes to the background hands off at once', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');

  const t0 = Date.now();
  await a.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await probe(b)).role, { timeout: 10_000 }).toBe('host');
  await expect.poll(async () => (await probe(a)).role, { timeout: 10_000 }).toBe('client');
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect.poll(async () => (await probe(b)).remotes.filter(Boolean).length, { timeout: 10_000 }).toBe(1);
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
  // A stops hosting B, though still sees B across the border (see the border-link test).
  await teleport(b, border + ZONE_MARGIN + 5);
  await expect.poll(async () => (await probe(b)).zone).toBe(east);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('host');
  await expect.poll(async () => (await probe(a)).clients).toBe(0);
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
  await expect.poll(async () => (await probe(a)).clients).toBe(0);
  await expect.poll(async () => (await probe(b)).clients).toBe(0);
  expect((await probe(a)).zone).not.toBe((await probe(b)).zone);
});

const peerIdOf = (p: Page) => p.evaluate(() => (window as any).__ti.cfg.peerId as string);
const sees = async (p: Page, id: string) => (await probe(p)).remotes.some((r) => r?.id === id);

test('neighbouring hosts link up so players see across a zone border', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const c = await join(browser, world);
  await expect.poll(async () => (await probe(c)).role, { timeout: 20_000 }).toBe('client');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  const [aId, bId, cId] = [await peerIdOf(a), await peerIdOf(b), await peerIdOf(c)];

  // B moves into the empty zone to the east, 40 tiles past the border: it hosts
  // that zone, and the two hosts link up because their zones are neighbours.
  const [zx] = (await probe(a)).zone.split(',').map(Number);
  const border = (zx + 1) * ZONE_TILES;
  await teleport(b, border + ZONE_MARGIN + 8);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('host');
  await expect.poll(async () => (await probe(a)).borders, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await probe(b)).borders, { timeout: 20_000 }).toBe(1);

  // Players near the border show up on the other side; C sees B through its host A.
  await teleport(a, border - 10);
  await teleport(c, border - 12);
  await expect.poll(() => sees(a, bId), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => sees(c, bId), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => sees(b, aId), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => sees(b, cId), { timeout: 10_000 }).toBe(true);

  // Positions relayed across the border track the real ones.
  const bPos = (await probe(b)).self;
  await expect.poll(async () => {
    const r = (await probe(c)).remotes.find((r) => r?.id === bId);
    return r ? Math.hypot(r.x - bPos.x, r.y - bPos.y) : Infinity;
  }).toBeLessThan(0.05);

  // B walks deep into its zone, out of range of A's zone: A and C stop seeing B.
  // Range is measured to the other zone, not to each viewer, so B still sees A
  // (A is still near B's zone). Per-viewer interest management is M6.
  await teleport(b, border + 200);
  await expect.poll(() => sees(a, bId), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => sees(c, bId), { timeout: 10_000 }).toBe(false);
  expect(await sees(b, aId)).toBe(true);
  expect((await probe(a)).borders).toBe(1); // The link stays up; B just has nothing to share.
});
