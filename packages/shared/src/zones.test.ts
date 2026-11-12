import { describe, expect, it } from 'vitest';
import { BORDER_VIEW, MAX_VIEW_RADIUS, VIEW_HYSTERESIS, ZONE_MARGIN, ZONE_TILES } from './constants.ts';
import { clampToZone, distToZone, parseZone } from './zones.ts';

describe('zone geometry', () => {
  it('parses zone ids, including after a different zone was parsed', () => {
    expect(parseZone('3,-2')).toEqual([3, -2]);
    expect(parseZone('0,0')).toEqual([0, 0]);
    expect(parseZone('3,-2')).toEqual([3, -2]);
    const a = parseZone('5,6');
    a[0] = 99; // A caller changing its copy doesn't affect later answers.
    expect(parseZone('5,6')).toEqual([5, 6]);
  });

  it('measures distance to the nearest point of a zone', () => {
    expect(distToZone(10, 10, '0,0')).toBe(0);
    expect(distToZone(ZONE_TILES + 30, 10, '0,0')).toBe(30);
    expect(distToZone(-5, 100, '0,0')).toBe(5);
    expect(distToZone(ZONE_TILES + 3, ZONE_TILES + 4, '0,0')).toBe(5); // Past a corner.
    expect(distToZone(10, 10, '1,0')).toBe(ZONE_TILES - 10);
    expect(distToZone(-10, -10, '-1,-1')).toBe(0);
  });

  it('clamps a point into a zone and its margin', () => {
    expect(clampToZone(10, 20, '0,0')).toEqual({ x: 10, y: 20 });
    expect(clampToZone(-50, 300, '0,0')).toEqual({ x: 0, y: ZONE_TILES });
    expect(clampToZone(-50, 300, '0,0', ZONE_MARGIN)).toEqual({ x: -ZONE_MARGIN, y: ZONE_TILES + ZONE_MARGIN });
    expect(clampToZone(1e9, -1e9, '2,3', ZONE_MARGIN)).toEqual({ x: 3 * ZONE_TILES + ZONE_MARGIN, y: 3 * ZONE_TILES - ZONE_MARGIN });
  });

  it('shares players across a border far enough for any viewer on the other side', () => {
    // A viewer can stand ZONE_MARGIN outside its own zone and see MAX_VIEW_RADIUS (plus hysteresis)
    // from there, so its host must hear of players that far from the zone.
    expect(BORDER_VIEW).toBeGreaterThanOrEqual(MAX_VIEW_RADIUS + VIEW_HYSTERESIS + ZONE_MARGIN);
    // And never so far that a zone two over could matter.
    expect(BORDER_VIEW).toBeLessThan(ZONE_TILES - ZONE_MARGIN);
  });
});
