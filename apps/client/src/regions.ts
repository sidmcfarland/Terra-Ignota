import { getRegion, hasRegion, installRegion, regionOf, type Region } from '@terra/shared';

/**
 * Gets drainage regions ready ahead of need. Rivers and lakes come from a simulation per region
 * (shared hydro.ts) that takes a fraction of a second: too long for the middle of a frame. Workers
 * compute the regions asked for here and hand them to the shared cache. A region nobody asked for in
 * time is still computed on the spot when a tile in it is first read, so this only ever saves a stall.
 */
export class RegionLoader {
  private readonly seed: number;
  private readonly idle: Worker[] = [];
  private workers = 0;
  private readonly waiting: Array<[number, number]> = [];
  /** Regions asked for and not yet installed. */
  private readonly asked = new Map<string, { promise: Promise<void>; done: () => void }>();
  /** Who else wants each region a worker computes (the chunk-mesh worker), and the last few that were computed. */
  private readonly listeners: Array<(r: Region) => void> = [];
  private readonly delivered: Array<[number, number]> = [];

  constructor(seed: number, workers = 1) {
    this.seed = seed;
    for (let i = 0; i < workers; i++) {
      try {
        const w = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<Region>) => {
          installRegion(e.data);
          this.delivered.push([e.data.rx, e.data.ry]);
          if (this.delivered.length > 32) this.delivered.shift();
          for (const fn of this.listeners) fn(e.data);
          this.settle(e.data.rx, e.data.ry);
          this.idle.push(w);
          this.pump();
        };
        // A worker that fails is dropped; whatever it was computing is computed on the spot when needed.
        w.onerror = () => {
          this.workers--;
          for (const key of [...this.asked.keys()]) if (!this.waiting.some(([x, y]) => `${x},${y}` === key)) this.asked.get(key)!.done();
          this.pump();
        };
        this.idle.push(w);
        this.workers++;
      } catch {
        // No workers here: regions are computed on the spot.
      }
    }
  }

  /**
   * Call `fn` with every region a worker computes from now on, and first with the ones already computed
   * that are still held. For handing regions on to another worker, so it need not compute them again.
   */
  onRegion(fn: (r: Region) => void) {
    this.listeners.push(fn);
    for (const [rx, ry] of this.delivered) if (hasRegion(this.seed, rx, ry)) fn(getRegion(this.seed, rx, ry));
  }

  /** Resolves once the region is in the shared cache. */
  ensure(rx: number, ry: number): Promise<void> {
    if (hasRegion(this.seed, rx, ry)) return Promise.resolve();
    const key = `${rx},${ry}`;
    let a = this.asked.get(key);
    if (!a) {
      let done = () => {};
      const promise = new Promise<void>((resolve) => (done = resolve));
      a = { promise, done: () => (this.asked.delete(key), done()) };
      this.asked.set(key, a);
      this.waiting.push([rx, ry]);
      this.pump();
    }
    return a.promise;
  }

  /** Every region within `reach` tiles of a point. */
  around(x: number, y: number, reach: number): Promise<void> {
    const all: Array<Promise<void>> = [];
    for (let ry = regionOf(y - reach); ry <= regionOf(y + reach); ry++) {
      for (let rx = regionOf(x - reach); rx <= regionOf(x + reach); rx++) all.push(this.ensure(rx, ry));
    }
    return Promise.all(all).then(() => {});
  }

  private settle(rx: number, ry: number) {
    this.asked.get(`${rx},${ry}`)?.done();
  }

  private pump() {
    while (this.waiting.length && (this.idle.length || this.workers <= 0)) {
      const [rx, ry] = this.waiting.shift()!;
      const w = this.idle.pop();
      if (w) w.postMessage({ seed: this.seed, rx, ry });
      else {
        getRegion(this.seed, rx, ry);
        this.settle(rx, ry);
      }
    }
  }
}
