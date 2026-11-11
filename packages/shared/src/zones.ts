import { CHUNK, ZONE_MARGIN, ZONE_TILES } from './constants.ts';
import { hash2 } from './rng.ts';

export type ZoneId = string;

export function parseZone(zone: ZoneId): [number, number] {
  const [x, y] = zone.split(',').map(Number);
  return [x, y];
}

const ZONE_ADJ = [
  'Amber', 'Ashen', 'Briar', 'Bright', 'Cinder', 'Cold', 'Copper', 'Dusk', 'Ember', 'Fallow', 'Fern', 'Frost',
  'Gilded', 'Grey', 'Iron', 'Ivy', 'Low', 'Misty', 'Moss', 'Pale', 'Quiet', 'Raven', 'Red', 'Salt', 'Silver',
  'Stone', 'Thorn', 'Umber', 'Velvet', 'Wild', 'Willow', 'Wind',
];
const ZONE_NOUN = [
  'Barrow', 'Bluff', 'Brook', 'Cairn', 'Combe', 'Crag', 'Dale', 'Dell', 'Downs', 'Fell', 'Fen', 'Ford', 'Glen',
  'Heath', 'Hollow', 'Holt', 'Knoll', 'Marsh', 'Mere', 'Moor', 'Reach', 'Ridge', 'Rise', 'Scar', 'Shaw', 'Strand',
  'Tarn', 'Vale', 'Wash', 'Weald', 'Wold', 'Wood',
];

/** A readable name for a zone, the same for every peer in a world (e.g. "Amber Fen"). */
export function zoneName(seed: number, zone: ZoneId): string {
  const [x, y] = parseZone(zone);
  const h = hash2(seed ^ 0x5a17e, x, y);
  return `${ZONE_ADJ[h % ZONE_ADJ.length]} ${ZONE_NOUN[(h >>> 8) % ZONE_NOUN.length]}`;
}

/**
 * Every zone whose border band (its area plus `margin` on each side) contains
 * (x, y): one zone in the open, two near an edge, up to four near a corner.
 * A player in any of these zones would stay in it (see nextZone).
 */
export function zonesNear(x: number, y: number, margin = ZONE_MARGIN): ZoneId[] {
  const out: ZoneId[] = [];
  for (const zx of axisNear(x, margin)) for (const zy of axisNear(y, margin)) out.push(`${zx},${zy}`);
  return out;
}

function axisNear(v: number, margin: number): number[] {
  const z = Math.floor(v / ZONE_TILES);
  const out = [z];
  if (v - z * ZONE_TILES < margin) out.push(z - 1);
  if ((z + 1) * ZONE_TILES - v <= margin) out.push(z + 1);
  return out;
}

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
  const [cx, cy] = parseZone(current);
  const zx = axisZone(cx, x, margin);
  const zy = axisZone(cy, y, margin);
  return zx === cx && zy === cy ? current : `${zx},${zy}`;
}

function axisZone(z: number, v: number, margin: number): number {
  const lo = z * ZONE_TILES;
  if (v >= lo - margin && v < lo + ZONE_TILES + margin) return z;
  return Math.floor(v / ZONE_TILES);
}
