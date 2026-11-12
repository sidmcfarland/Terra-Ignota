import { describe, expect, it } from 'vitest';
import { airAt } from './air.ts';
import { lightAt } from './day.ts';
import { WEATHERS, seasonAt } from './weather.ts';

const spring = seasonAt(0.3), summer = seasonAt(1.3), autumn = seasonAt(2.3), winter = seasonAt(3.3);
const at = (hour: number, weather = WEATHERS.clear, season = summer, wind = 0.2) =>
  airAt(hour, lightAt(hour).lamp, weather, season, wind);

describe('the air', () => {
  it('keeps every amount between 0 and 1, whatever the hour, weather, season and wind', () => {
    let low = 1, high = 0;
    for (const season of [spring, summer, autumn, winter]) for (const weather of Object.values(WEATHERS)) {
      for (const wind of [0.05, 0.4, 1]) for (let hour = 0; hour < 24; hour += 0.25) {
        for (const v of Object.values(at(hour, weather, season, wind))) {
          low = Math.min(low, v);
          high = Math.max(high, v);
        }
      }
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(0.9);
  });

  it('has fireflies on warm, dry evenings only', () => {
    expect(at(21.5).fireflies).toBeGreaterThan(0.8);
    expect(at(12).fireflies).toBe(0);
    expect(at(4).fireflies).toBe(0);
    expect(at(21.5, WEATHERS.clear, winter).fireflies).toBe(0);
    expect(at(21.5, WEATHERS.storm).fireflies).toBe(0);
    expect(at(21.5, WEATHERS.clear, summer, 0.9).fireflies).toBeLessThan(at(21.5).fireflies);
  });

  it('has dust in sunlight, most when the sun is low, and leaves in its place in autumn', () => {
    expect(at(16.8).dust).toBeGreaterThan(at(12).dust);
    expect(at(22).dust).toBe(0);
    expect(at(16.8, WEATHERS.rain).dust).toBeLessThan(0.3 * at(16.8).dust);
    expect(at(16.8).leaves).toBe(0);
    const fall = at(16.8, WEATHERS.clear, autumn, 0.5);
    expect(fall.leaves).toBeGreaterThan(fall.dust);
  });

  it('shows stars in the water on clear, calm nights only', () => {
    expect(at(23, WEATHERS.clear, summer, 0.1).stars).toBeGreaterThan(0.9);
    expect(at(23, WEATHERS.overcast, summer, 0.1).stars).toBe(0);
    expect(at(23, WEATHERS.fog, summer, 0.1).stars).toBe(0);
    expect(at(13).stars).toBe(0);
  });

  it('gathers mist at dawn and burns it off by mid-morning', () => {
    expect(at(6.8, WEATHERS.clear, autumn, 0.1).mist).toBeGreaterThan(0.4);
    expect(at(6.8, WEATHERS.clear, summer, 0.1).mist).toBeLessThan(at(6.8, WEATHERS.clear, autumn, 0.1).mist);
    expect(at(9).mist).toBe(0);
    expect(at(4.5).mist).toBe(0);
    expect(at(16).mist).toBe(0);
  });
});
