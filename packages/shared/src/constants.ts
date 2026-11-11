/** Tiles per chunk edge. */
export const CHUNK = 32;
/** Chunks per zone edge. A zone is the unit of hosting authority. */
export const ZONE_CHUNKS = 8;
export const ZONE_TILES = CHUNK * ZONE_CHUNKS;
/** Host simulation / network tick rate. */
export const TICK_HZ = 20;
/** Player walk speed in tiles per second. */
export const PLAYER_SPEED = 6;
/** Speed multiplier in shallow water. */
export const WADE_FACTOR = 0.5;
/** Player collision radius in tiles. */
export const PLAYER_RADIUS = 0.3;
export const DEFAULT_WORLD = 'terra';
