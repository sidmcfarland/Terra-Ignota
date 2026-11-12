import { CHUNK, ZONE_MARGIN, ZONE_TILES } from './constants.ts';
import { hash2 } from './rng.ts';

export type ZoneId = string;

// Hosts look up their own zone for every position they check, so the last answer is kept.
let lastZone: ZoneId = '', lastX = 0, lastY = 0;

export function parseZone(zone: ZoneId): [number, number] {
  if (zone !== lastZone) {
    const [x, y] = zone.split(',').map(Number);
    lastZone = zone;
    lastX = x;
    lastY = y;
  }
  return [lastX, lastY];
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

/** Distance from (x, y) to the nearest point of a zone's square; 0 inside it. */
export function distToZone(x: number, y: number, zone: ZoneId): number {
  const [zx, zy] = parseZone(zone);
  const x0 = zx * ZONE_TILES, y0 = zy * ZONE_TILES;
  const dx = Math.max(x0 - x, 0, x - (x0 + ZONE_TILES));
  const dy = Math.max(y0 - y, 0, y - (y0 + ZONE_TILES));
  return Math.hypot(dx, dy);
}

/** The point of a zone's square, grown by `margin` on every side, that is nearest to (x, y). */
export function clampToZone(x: number, y: number, zone: ZoneId, margin = 0): { x: number; y: number } {
  const [zx, zy] = parseZone(zone);
  const x0 = zx * ZONE_TILES - margin, y0 = zy * ZONE_TILES - margin, span = ZONE_TILES + 2 * margin;
  return { x: Math.min(Math.max(x, x0), x0 + span), y: Math.min(Math.max(y, y0), y0 + span) };
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
