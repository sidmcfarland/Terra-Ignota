import { computeRegion, installRegion, type Region } from '@terra/shared';
import { ChunkBuilder, buffersOf } from './render/chunk-data.ts';
import type { ChunkAnswer, ChunkAsk } from './render/terrain.ts';

// The work on terrain that is too slow for the middle of a frame, done off the main thread. One script,
// started twice by the game: once by RegionLoader for drainage regions (rivers and lakes, see shared
// hydro.ts), once by the renderer's Terrain for chunk meshes (render/chunk-data.ts).
//
//   { seed, rx, ry }          → the region, its arrays handed over, not copied.
//   { kind: 'hold', region }  → nothing. A region computed elsewhere, kept so chunks here need not compute it again.
//   { kind: 'chunk', ... }    → the chunk's mesh data, its arrays handed over.
//
// A chunk whose region is not held computes it on the spot: slower, never wrong.
type Ask = { kind?: undefined; seed: number; rx: number; ry: number } | { kind: 'hold'; region: Region } | ChunkAsk;

const scope = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void };
let builder: ChunkBuilder | null = null;

addEventListener('message', (e: MessageEvent<Ask>) => {
  const m = e.data;
  if (m.kind === 'hold') {
    installRegion(m.region);
  } else if (m.kind === 'chunk') {
    if (builder?.seed !== m.seed) builder = new ChunkBuilder(m.seed, m.east, m.west);
    const t = performance.now();
    const data = builder.build(m.cx, m.cy, m.tiles);
    const answer: ChunkAnswer = { ...data, version: m.version, ms: performance.now() - t };
    scope.postMessage(answer, buffersOf(data));
  } else {
    const r = computeRegion(m.seed, m.rx, m.ry);
    scope.postMessage(r, [r.level.buffer, r.lake.buffer, r.flow.buffer, r.kind.buffer, r.rain.buffer]);
  }
});
