import { expect, test } from '@playwright/test';
import { terrainHash, worldSeed } from '../../packages/shared/src/index.ts';

// Every device must compute exactly the same world: hosts check movement against it.
// The same number as GOLDEN_HASH in packages/shared/src/shared.test.ts.
const GOLDEN_HASH = 4034505386;

test('the browser generates the same world as Node', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The terrain overview: it paints a few thousand tiles across and exposes the hash.
  await page.goto('/#map=1&w=golden&scale=8');
  await page.waitForFunction(() => (window as any).__ti?.map?.done, null, { timeout: 50_000 });
  const inPage = (world: string) => page.evaluate((w) => (window as any).__ti.terrainHash(w) as number, world);

  expect(terrainHash(worldSeed('golden'))).toBe(GOLDEN_HASH);
  expect(await inPage('golden')).toBe(GOLDEN_HASH);
  // And a world nobody has computed before.
  const fresh = `e2e${Date.now()}`;
  expect(await inPage(fresh)).toBe(terrainHash(worldSeed(fresh)));

  // The overview painted real terrain: several kinds of tile, land and sea.
  const share = await page.evaluate(() => (window as any).__ti.map.share as Record<string, number>);
  expect(Object.keys(share).length).toBeGreaterThan(5);
  expect(share.DeepWater ?? 0).toBeLessThan(1);
  expect(errors).toEqual([]);
});
