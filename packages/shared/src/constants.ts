/** Tiles per chunk edge. */
export const CHUNK = 32;
/** Chunks per zone edge. A zone is the unit of hosting authority. */
export const ZONE_CHUNKS = 8;
export const ZONE_TILES = CHUNK * ZONE_CHUNKS;
/** How far past a zone border (in tiles) a player goes before switching zones. */
export const ZONE_MARGIN = CHUNK;
/**
 * How far a player sees other players, in tiles: a host sends each client only
 * the players within that client's view radius. A client asks for the radius
 * its screen needs; the host holds the request within these bounds.
 */
export const VIEW_RADIUS = 3 * CHUNK;
export const MIN_VIEW_RADIUS = 48;
export const MAX_VIEW_RADIUS = 4 * CHUNK;
/** A player already in view stays in view until this much further away, so one at the edge doesn't flicker. */
export const VIEW_HYSTERESIS = 8;
/**
 * A host shares its players with a neighbouring zone's host when they're within
 * this many tiles of that zone: far enough that any of the neighbour's players
 * (who may stand up to ZONE_MARGIN outside their zone) can be shown everyone in view.
 */
export const BORDER_VIEW = MAX_VIEW_RADIUS + VIEW_HYSTERESIS + ZONE_MARGIN;
/** A host ignores positions more than this far outside its zone's margin: a player there belongs to another zone. */
export const ZONE_SLACK = 16;
/** Host simulation / network tick rate. */
export const TICK_HZ = 20;
/** Player walk speed in tiles per second. */
export const PLAYER_SPEED = 6;
/** Speed multiplier in shallow water. */
export const WADE_FACTOR = 0.5;
/** Player collision radius in tiles. */
export const PLAYER_RADIUS = 0.3;
export const DEFAULT_WORLD = 'terra';
