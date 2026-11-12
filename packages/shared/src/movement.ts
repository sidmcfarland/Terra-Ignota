import { PLAYER_RADIUS, PLAYER_SPEED, WADE_FACTOR } from './constants.ts';
import { isWading, isWalkable, type Tile } from './worldgen.ts';

export type TileLookup = (x: number, y: number) => Tile;

function blocked(tile: TileLookup, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return (
    !isWalkable(tile(Math.floor(x - r), Math.floor(y - r))) ||
    !isWalkable(tile(Math.floor(x + r), Math.floor(y - r))) ||
    !isWalkable(tile(Math.floor(x - r), Math.floor(y + r))) ||
    !isWalkable(tile(Math.floor(x + r), Math.floor(y + r)))
  );
}

/**
 * Move a player by an input direction for dt seconds, sliding along
 * obstacles. Shared by client prediction and host validation.
 */
export function step(
  tile: TileLookup,
  pos: { x: number; y: number },
  dir: { x: number; y: number },
  dt: number,
): { x: number; y: number } {
  // Not Math.hypot: engines may round it differently, and this is a rule both sides compute.
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
  if (len === 0) return pos;
  const k = Math.min(1, len) / len;
  const speed = PLAYER_SPEED * (isWading(tile(Math.floor(pos.x), Math.floor(pos.y))) ? WADE_FACTOR : 1);
  let { x, y } = pos;
  const nx = x + dir.x * k * speed * dt;
  if (!blocked(tile, nx, y)) x = nx;
  const ny = y + dir.y * k * speed * dt;
  if (!blocked(tile, x, ny)) y = ny;
  return { x, y };
}
