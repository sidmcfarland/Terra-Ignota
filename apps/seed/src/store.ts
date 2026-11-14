import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpStore, asOp, type Layer, type Op } from '../../../packages/shared/src/index.ts';

const WORLD_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface World {
  ops: OpStore;
  /** Lines in the world's file. */
  lines: number;
}

/**
 * The seed's on-disk copy of each world's edits, every layer in one
 * append-only JSON-lines file per world (`<dir>/<world>.jsonl`). Loading
 * replays it into an OpStore replica. A file dominated by lines that no longer
 * count (superseded or expired ops) is rewritten with just the ops that stand.
 */
export class DiskStore {
  private readonly dir: string;
  private readonly now: (() => number) | undefined;
  private worlds = new Map<string, World>();

  /** @param now The clock ops expire by, in unix seconds. Default: the machine's. */
  constructor(dir: string, now?: () => number) {
    this.dir = dir;
    this.now = now;
    mkdirSync(dir, { recursive: true });
  }

  private file(world: string): string {
    if (!WORLD_RE.test(world)) throw new Error(`bad world id: ${world}`);
    return join(this.dir, `${world}.jsonl`);
  }

  /** Whether anything is stored for a world, loaded or not. */
  has(world: string): boolean {
    return this.worlds.has(world) || (WORLD_RE.test(world) && existsSync(this.file(world)));
  }

  private load(world: string): World {
    let w = this.worlds.get(world);
    if (w) return w;
    w = { ops: new OpStore(this.now), lines: 0 };
    const file = this.file(world);
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        w.lines++;
        try {
          const op = asOp(JSON.parse(line));
          if (op) w.ops.merge(op); // Verified before it was written. An expired op doesn't merge.
        } catch {
          // A torn last line from a crash: skip it.
        }
      }
      this.tidy(world, w);
    }
    this.worlds.set(world, w);
    return w;
  }

  /** The world's replica, loaded from disk on first use. */
  world(world: string): OpStore {
    return this.load(world).ops;
  }

  /** Record an op that changed the world's replica. */
  append(world: string, op: Op) {
    appendFileSync(this.file(world), JSON.stringify(op) + '\n');
    this.load(world).lines++;
  }

  /** Drop expired ops from every loaded world, and rewrite any file they now dominate. */
  sweep() {
    for (const [world, w] of this.worlds) {
      w.ops.expire();
      this.tidy(world, w);
    }
  }

  /** Worlds loaded so far, with how many ops each holds. */
  stats(): Record<string, number> {
    return Object.fromEntries([...this.worlds].map(([w, e]) => [w, e.ops.size]));
  }

  /** How many ops a world holds in each layer that has any. */
  layers(world: string): Partial<Record<Layer, number>> {
    const counts: Partial<Record<Layer, number>> = {};
    for (const op of this.world(world).ops()) counts[op.l] = (counts[op.l] ?? 0) + 1;
    return counts;
  }

  /** Rewrite a world's file with just the ops that stand, once most of its lines no longer count. */
  private tidy(world: string, w: World) {
    if (w.lines <= 2 * w.ops.size + 100) return;
    const file = this.file(world);
    const ops = w.ops.ops();
    writeFileSync(`${file}.tmp`, ops.map((op) => JSON.stringify(op) + '\n').join(''));
    renameSync(`${file}.tmp`, file);
    w.lines = ops.length;
  }
}
