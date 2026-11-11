import { CHUNK, ZONE_TILES } from './constants.ts';

export type ZoneId = string;

export function zoneOf(x: number, y: number): ZoneId {
  return `${Math.floor(x / ZONE_TILES)},${Math.floor(y / ZONE_TILES)}`;
}

export function chunkOf(x: number, y: number): [number, number] {
  return [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
}
