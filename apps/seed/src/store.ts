import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TileEdits, isWellFormed, type TileOp } from '../../../packages/shared/src/index.ts';

const WORLD_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The seed's on-disk copy of each world's edits: one append-only JSON-lines
 * file per world (`<dir>/<world>.jsonl`). Loading replays it into a TileEdits
 * replica; a file with many superseded lines is rewritten with just the winners.
 */
export class DiskStore {
  private readonly dir: string;
  private worlds = new Map<string, TileEdits>();

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  private file(world: string): string {
    if (!WORLD_RE.test(world)) throw new Error(`bad world id: ${world}`);
    return join(this.dir, `${world}.jsonl`);
  }

  /** The world's replica, loaded from disk on first use. */
  world(world: string): TileEdits {
    let edits = this.worlds.get(world);
    if (edits) return edits;
    edits = new TileEdits();
    const file = this.file(world);
    if (existsSync(file)) {
      let lines = 0;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        lines++;
        try {
          const op: unknown = JSON.parse(line);
          if (isWellFormed(op)) edits.merge(op); // Verified before it was written.
        } catch {
          // A torn last line from a crash: skip it.
        }
      }
      if (lines > 2 * edits.size + 100) this.compact(world, edits);
    }
    this.worlds.set(world, edits);
    return edits;
  }

  /** Record an op that changed the world's replica. */
  append(world: string, op: TileOp) {
    appendFileSync(this.file(world), JSON.stringify(op) + '\n');
  }

  /** Worlds loaded so far, with how many tiles each has edited. */
  stats(): Record<string, number> {
    return Object.fromEntries([...this.worlds].map(([w, e]) => [w, e.size]));
  }

  private compact(world: string, edits: TileEdits) {
    const file = this.file(world);
    const ops: TileOp[] = [];
    for (const key of edits.chunkKeys()) ops.push(...edits.chunkOps(key));
    writeFileSync(`${file}.tmp`, ops.map((op) => JSON.stringify(op) + '\n').join(''));
    renameSync(`${file}.tmp`, file);
  }
}
