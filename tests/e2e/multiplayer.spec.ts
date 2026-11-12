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
  // A walks over to B: players only see each other within their view radius.
  await teleport(a, border - ZONE_MARGIN - 10);
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
  // (B steps back towards the border; inside the margin, so it stays in its zone.)
  await teleport(a, border - 10);
  await teleport(c, border - 12);
  await teleport(b, border + 20);
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

  // B walks deep into its zone, out of everyone's view: A and C stop seeing B, and B stops seeing them.
  await teleport(b, border + 200);
  await expect.poll(() => sees(a, bId), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => sees(c, bId), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => sees(b, aId), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => sees(b, cId), { timeout: 10_000 }).toBe(false);
  expect((await probe(a)).borders).toBe(1); // The link stays up; B just has nothing to share.

  // View is per player, not per zone. B comes back to the border while A walks to the far
  // side of its own zone: C, still at the border, and B see each other; A sees neither of
  // them, and neither sees A, though A is still C's host and still relays B to it.
  await teleport(b, border + 20);
  await teleport(a, border - 230);
  await expect.poll(() => sees(c, bId), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => sees(b, cId), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => sees(c, aId), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => sees(b, aId), { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length, { timeout: 10_000 }).toBe(0);
  expect((await probe(a)).clients).toBe(1);
});

test('a host sends each player only the players within its view', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  const c = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(c)).role, { timeout: 20_000 }).toBe('client');
  const [aId, bId, cId] = [await peerIdOf(a), await peerIdOf(b), await peerIdOf(c)];
  const seen = async (p: Page) => (await probe(p)).remotes.filter(Boolean).length;
  const moveTo = (p: Page, x: number, y: number) =>
    p.evaluate(([x, y]) => void Object.assign((window as any).__ti.self, { x, y }), [x, y] as const);

  // They spawn together, and everyone sees everyone.
  for (const p of [a, b, c]) await expect.poll(() => seen(p), { timeout: 10_000 }).toBe(2);

  // The host walks to the far corner of the zone, still inside it. B and C lose sight of
  // it and it of them; they still see each other, and everyone stays connected.
  const start = (await probe(a)).self;
  const [zx, zy] = (await probe(a)).zone.split(',').map(Number);
  const far = (v: number, z: number) => (v - z * ZONE_TILES > ZONE_TILES / 2 ? z * ZONE_TILES + 4 : (z + 1) * ZONE_TILES - 4);
  await moveTo(a, far(start.x, zx), far(start.y, zy));
  await expect.poll(() => sees(b, aId), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => sees(c, aId), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => seen(a), { timeout: 10_000 }).toBe(0);
  expect(await sees(b, cId)).toBe(true);
  expect(await sees(c, bId)).toBe(true);
  expect((await probe(a)).clients).toBe(2);
  expect((await probe(b)).role).toBe('client');
  // The zone still counts three players for everyone, and B still knows who its host is.
  for (const p of [a, b, c]) expect(await p.evaluate(() => (window as any).__ti.session.playerCount)).toBe(3);
  const aName = await a.evaluate(() => (window as any).__ti.cfg.name as string);
  await expect(b.locator('#debug')).toContainText(`HOST   ${aName}`);

  // Back together, they see each other again.
  await moveTo(a, start.x, start.y);
  for (const p of [a, b, c]) await expect.poll(() => seen(p), { timeout: 10_000 }).toBe(2);
});

// ---- Limits on what a host accepts (M6) ----

test('a host drops messages beyond the budget of a client, and cuts off one that keeps flooding', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  const dropped = () => a.evaluate(() => (window as any).__ti.session.net.dropped as number);
  const flood = (n: number) => b.evaluate((n) => {
    const peer = (window as any).__ti.session.hostPeer;
    for (let i = 0; i < n; i++) peer.sendR({ t: 'chat', from: '', text: 'x' });
  }, n);

  // 150 messages at once: the host reads the first 80 or so (the burst allowance) and drops the rest unread.
  await flood(150);
  await expect.poll(dropped, { timeout: 10_000 }).toBeGreaterThanOrEqual(60);
  expect((await probe(a)).clients).toBe(1);
  expect((await probe(b)).role).toBe('client');

  // Once the budget refills, messages from B count again.
  await b.waitForTimeout(2000);
  const [x, y] = await paintNext(b, 2, PATH);
  await expect.poll(() => editAt(a, x, y), { timeout: 10_000 }).toBe(PATH);

  // A client that keeps flooding is disconnected. It can come back, with a fresh budget.
  const before = await dropped();
  await flood(600);
  await expect.poll(dropped, { timeout: 10_000 }).toBeGreaterThanOrEqual(before + 200);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).not.toBe('client');
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length, { timeout: 10_000 }).toBe(1);
});

test('a client cannot push edits past the reach check through catch-up messages', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(async () => (await probe(a)).remotes.filter(Boolean).length).toBe(1);

  // An edit 40 tiles from where B stands. The host refuses it as a live edit (out of reach),
  // refuses it again when B sends it the way catch-up answers travel (the host never asked),
  // and ignores an attempt by B to start catch-up a second time so as to be asked.
  const [x, y] = await b.evaluate(async (tile) => {
    const ti = (window as any).__ti;
    const x = Math.floor(ti.self.x) + 40, y = Math.floor(ti.self.y);
    const op = await ti.paint(x, y, tile);
    const peer = ti.session.hostPeer;
    peer.sendR({ t: 'edits', ops: [op] });
    peer.sendR({ t: 'sync', d: { [`${Math.floor(x / 32)},${Math.floor(y / 32)}`]: '1:1:x' } });
    peer.sendR({ t: 'edits', ops: [op] });
    return [x, y] as [number, number];
  }, PATH);
  await expect.poll(() => a.evaluate(() => (window as any).__ti.session.stats.opsRefused as number), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(3);
  await b.waitForTimeout(500);
  expect(await editAt(a, x, y)).toBe(null);

  // An edit within reach still goes through.
  const [nx, ny] = await paintNext(b, 2, PATH);
  await expect.poll(() => editAt(a, nx, ny), { timeout: 10_000 }).toBe(PATH);
});

// ---- World edits (M4) ----

const PATH = 8, WALL = 9; // Mirrors Tile.Path / Tile.Wall in packages/shared/src/worldgen.ts.

/** The edited tile at (x, y) on a page, or null if that spot isn't edited there. */
const editAt = (p: Page, x: number, y: number) =>
  p.evaluate(([x, y]) => (window as any).__ti.edits.get(x, y)?.tile ?? null, [x, y] as const);

/**
 * Paint a tile near the page's player, within reach, that nobody has edited yet
 * (players spawn close together, so a fixed offset could land on another
 * player's edit). Tries dx tiles across first. Returns its coordinates.
 */
async function paintNext(p: Page, dx: number, tile: number | null): Promise<[number, number]> {
  return p.evaluate(async ([dx, tile]) => {
    const ti = (window as any).__ti;
    const px = Math.floor(ti.self.x), py = Math.floor(ti.self.y);
    const offsets = [[dx, 0], [dx, 1], [dx, -1], [-dx, 0], [-dx, 1], [-dx, -1], [0, 2], [0, -2], [1, 2], [-1, -2]];
    const [ox, oy] = offsets.find(([ox, oy]) => !ti.edits.get(px + ox, py + oy))!;
    await ti.paint(px + ox, py + oy, tile);
    return [px + ox, py + oy] as [number, number];
  }, [dx, tile] as const);
}

test('edits replicate through the host and survive a reload', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 20_000 }).toBe('client');

  // A client's edit reaches the host; the host's edit reaches the client.
  const [bx, by] = await paintNext(b, 2, PATH);
  await expect.poll(() => editAt(a, bx, by), { timeout: 10_000 }).toBe(PATH);
  const [ax, ay] = await paintNext(a, -2, WALL);
  await expect.poll(() => editAt(b, ax, ay), { timeout: 10_000 }).toBe(WALL);
  // The edited tile is what movement and the host's checks see.
  expect(await a.evaluate(([x, y]) => (window as any).__ti.tiles.get(x, y), [ax, ay] as const)).toBe(WALL);

  // The B key cycles the tile in front of the player (facing south before moving):
  // unedited -> path -> wall -> unedited. It may be a tile already painted above.
  const front = await b.evaluate(() => {
    const ti = (window as any).__ti;
    return [Math.floor(ti.self.x), Math.floor(ti.self.y + 1)] as [number, number];
  });
  const before = await editAt(b, front[0], front[1]);
  const expected = before === null ? PATH : before === PATH ? WALL : null;
  await b.keyboard.press('b');
  await expect.poll(() => editAt(b, front[0], front[1]), { timeout: 10_000 }).toBe(expected);
  await expect.poll(() => editAt(a, front[0], front[1]), { timeout: 10_000 }).toBe(expected);

  // Reloading B loads its edits from IndexedDB before it reconnects.
  await b.reload();
  await b.waitForFunction(() => (window as any).__ti?.edits);
  expect(await editAt(b, bx, by)).toBe(PATH);
  expect(await editAt(b, ax, ay)).toBe(WALL);
});

test('newcomers catch up from the host, and a returning player brings edits back', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  // D paints while cut off from the signal server (an unreachable address), so the
  // edit exists only in D's browser storage: not on any host, and not on the seed.
  const d = await join(browser, world, '&signal=ws://127.0.0.1:9');
  const [dx, dy] = await paintNext(d, 3, PATH);
  const dCtx = d.context();
  await d.close();

  // E arrives to an empty zone and hosts it, knowing nothing of D's edit.
  const e = await join(browser, world);
  await expect.poll(async () => (await probe(e)).role, { timeout: 10_000 }).toBe('host');
  expect(await editAt(e, dx, dy)).toBe(null);

  // D comes back in the same browser: it syncs with E and hands over its edit.
  const d2 = await dCtx.newPage();
  await d2.goto(`/#w=${world}&render=0&debug=1`);
  await d2.waitForFunction(() => (window as any).__ti?.session);
  await expect.poll(async () => (await probe(d2)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(() => editAt(e, dx, dy), { timeout: 10_000 }).toBe(PATH);

  // F, brand new, gets it from the host on joining.
  const f = await join(browser, world);
  await expect.poll(async () => (await probe(f)).role, { timeout: 20_000 }).toBe('client');
  await expect.poll(() => editAt(f, dx, dy), { timeout: 10_000 }).toBe(PATH);

  // A later edit wins everywhere (last writer wins), including reverting to the generated tile.
  // F walks onto the tile first: the host only accepts edits within reach of where it sees F.
  await f.evaluate(([x, y]) => Object.assign((window as any).__ti.self, { x: x + 0.5, y: y + 0.5 }), [dx, dy] as const);
  await f.waitForTimeout(1000);
  await f.evaluate(([x, y]) => (window as any).__ti.paint(x, y, null), [dx, dy] as const);
  await expect.poll(() => editAt(e, dx, dy), { timeout: 10_000 }).toBe(null);
  await expect.poll(() => editAt(d2, dx, dy), { timeout: 10_000 }).toBe(null);
});

// ---- Seed peer (M4b) ----

/** Tiles the seed peer has stored for a world. */
async function seedTiles(world: string): Promise<number> {
  const port = Number(process.env.E2E_SEED_PORT) || 8788; // As in playwright.config.ts.
  const health = await (await fetch(`http://localhost:${port}/health`)).json();
  return health.worlds?.[world] ?? 0;
}

test('edits survive everyone logging off, kept by the seed peer', async ({ browser }) => {
  const world = `e2e${Date.now()}`;
  const a = await join(browser, world);
  await expect.poll(async () => (await probe(a)).role).toBe('host');
  // The seed learns A hosts this zone and links up with it.
  await expect.poll(() => a.evaluate(() => (window as any).__ti.session.seedCount), { timeout: 20_000 }).toBe(1);

  const [px, py] = await paintNext(a, 2, PATH);
  const [wx, wy] = await paintNext(a, -2, WALL);
  await expect.poll(() => seedTiles(world), { timeout: 10_000 }).toBe(2);

  // Everyone leaves, and A's browser storage goes with it.
  await a.context().close();

  // B arrives in a fresh browser to an empty zone, hosts it, and gets the edits from the seed.
  const b = await join(browser, world);
  await expect.poll(async () => (await probe(b)).role, { timeout: 10_000 }).toBe('host');
  await expect.poll(() => editAt(b, px, py), { timeout: 20_000 }).toBe(PATH);
  expect(await editAt(b, wx, wy)).toBe(WALL);

  // New edits keep reaching the seed through the new host.
  await paintNext(b, 3, PATH);
  await expect.poll(() => seedTiles(world), { timeout: 10_000 }).toBe(3);
});
