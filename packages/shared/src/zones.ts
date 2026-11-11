import { CHUNK, ZONE_MARGIN, ZONE_TILES } from './constants.ts';

export type ZoneId = string;

export function zoneOf(x: number, y: number): ZoneId {
  return `${Math.floor(x / ZONE_TILES)},${Math.floor(y / ZONE_TILES)}`;
}

export function chunkOf(x: number, y: number): [number, number] {
  return [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
}

/**
 * The zone a player at (x, y) should belong to, given the zone they're in now.
 * Each axis only changes once the player is more than `margin` tiles past the
 * current zone's edge, so standing on a border doesn't flip between hosts.
 */
export function nextZone(current: ZoneId, x: number, y: number, margin = ZONE_MARGIN): ZoneId {
  const [cx, cy] = current.split(',').map(Number);
  const zx = axisZone(cx, x, margin);
  const zy = axisZone(cy, y, margin);
  return zx === cx && zy === cy ? current : `${zx},${zy}`;
}

function axisZone(z: number, v: number, margin: number): number {
  const lo = z * ZONE_TILES;
  if (v >= lo - margin && v < lo + ZONE_TILES + margin) return z;
  return Math.floor(v / ZONE_TILES);
}
