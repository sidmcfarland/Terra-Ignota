import { computeRegion } from '@terra/shared';

// Computes drainage regions (rivers and lakes, see shared hydro.ts) off the main thread.
// One message in: which region. One message out: the region, its arrays handed over, not copied.
const scope = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void };

addEventListener('message', (e: MessageEvent<{ seed: number; rx: number; ry: number }>) => {
  const r = computeRegion(e.data.seed, e.data.rx, e.data.ry);
  scope.postMessage(r, [r.level.buffer, r.lake.buffer, r.flow.buffer, r.kind.buffer, r.rain.buffer]);
});
