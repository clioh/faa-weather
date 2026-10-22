import { describe, it, expect } from 'vitest';
import { decodeWindGroup, parseFbProduct, resolveDayHourZ, nearestStation, distanceNm } from './winds-aloft.js';
import { FB_STATIONS } from './winds-aloft-stations.js';

// Excerpt of a real FBUS31 product (column layout preserved), with a
// synthetic DEN line exercising 9900 and >100 kt encodings.
const PRODUCT = `000
FBUS31 KWNO 150801
FD1US1
DATA BASED ON 150600Z
VALID 151200Z   FOR USE 0800-1500Z. TEMPS NEG ABV 24000

FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
ABI      2127+17 2221+13 2024+08 2232-06 2134-17 214331 214240 214651
ABR 2809 3217+05 3018+01 2824-03 2541-15 2358-26 237742 720246 731849
ATL 2909 2705+17 9900+13 9900+09 0712-06 9900-16 110529 990039 251050
DEN              2725-02 2840-07 7307-16 7520-27 780545 781049 289955
2XG 9900 0709+17 0911+14 0809+09 9900-06 1113-15 113129 082339 062750
`;

const HAWAII = `FBHW31 KWNO 150801
VALID 151200Z   FOR USE 0800-1500Z. TEMPS NEG ABV 24000

FT  1000 1500 2000 3000    6000    9000   12000   15000   18000   24000
LNY           0817 0817 0914+13 1009+09 0808+08 9900+04 3109-03 3219-16
`;

describe('decodeWindGroup', () => {
  it('decodes plain wind without temperature', () => {
    expect(decodeWindGroup('2809', 3000)).toEqual({ altitude: 3000, direction: 280, speed: 9, temperature: null });
  });

  it('decodes signed temperatures', () => {
    expect(decodeWindGroup('3217+05', 6000)).toEqual({ altitude: 6000, direction: 320, speed: 17, temperature: 5 });
    expect(decodeWindGroup('2541-15', 18000)?.temperature).toBe(-15);
  });

  it('treats 9900 as light and variable', () => {
    expect(decodeWindGroup('9900+13', 9000)).toEqual({ altitude: 9000, direction: null, speed: 0, temperature: 13 });
    expect(decodeWindGroup('990039', 34000)).toEqual({ altitude: 34000, direction: null, speed: 0, temperature: -39 });
  });

  it('decodes >100 kt winds (direction + 50)', () => {
    expect(decodeWindGroup('7307-16', 18000)).toEqual({ altitude: 18000, direction: 230, speed: 107, temperature: -16 });
    expect(decodeWindGroup('720246', 34000)).toEqual({ altitude: 34000, direction: 220, speed: 102, temperature: -46 });
    expect(decodeWindGroup('7799', 39000)).toMatchObject({ direction: 270, speed: 199 });
  });

  it('makes unsigned temps negative above FL240', () => {
    expect(decodeWindGroup('237742', 30000)).toEqual({ altitude: 30000, direction: 230, speed: 77, temperature: -42 });
  });

  it('reports north as 360 and rejects garbage', () => {
    expect(decodeWindGroup('0010+05', 6000)?.direction).toBe(360);
    expect(decodeWindGroup('', 3000)).toBeNull();
    expect(decodeWindGroup('4510', 3000)).toBeNull();
    expect(decodeWindGroup('abcd', 3000)).toBeNull();
  });
});

describe('parseFbProduct', () => {
  const now = new Date('2026-10-15T09:00:00Z');
  const p = parseFbProduct(PRODUCT, now);

  it('reads header metadata', () => {
    expect(p.validAt).toBe('2026-10-15T12:00:00.000Z');
    expect(p.forUse).toBe('0800-1500Z');
    expect(p.altitudes).toEqual([3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000]);
  });

  it('skips blank low levels using fixed columns', () => {
    expect(p.stations.ABI.map((l) => l.altitude)).toEqual([6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000]);
    expect(p.stations.ABI[0]).toEqual({ altitude: 6000, direction: 210, speed: 27, temperature: 17 });
    expect(p.stations.DEN[0].altitude).toBe(9000);
  });

  it('parses 9900, >100 kt and FL300 groups in context', () => {
    const atl = p.stations.ATL;
    expect(atl.find((l) => l.altitude === 9000)).toMatchObject({ direction: null, speed: 0, temperature: 13 });
    const den = p.stations.DEN;
    expect(den.find((l) => l.altitude === 18000)).toEqual({ altitude: 18000, direction: 230, speed: 107, temperature: -16 });
    expect(den.find((l) => l.altitude === 30000)).toEqual({ altitude: 30000, direction: 280, speed: 105, temperature: -45 });
    expect(p.stations.ABR.find((l) => l.altitude === 30000)).toEqual({
      altitude: 30000,
      direction: 230,
      speed: 77,
      temperature: -42,
    });
  });

  it('handles station ids starting with a digit', () => {
    expect(p.stations['2XG'][0]).toEqual({ altitude: 3000, direction: null, speed: 0, temperature: null });
  });

  it('follows a different header layout (Hawaii)', () => {
    const hi = parseFbProduct(HAWAII, now);
    expect(hi.altitudes[0]).toBe(1000);
    expect(hi.stations.LNY.map((l) => l.altitude)).toEqual([2000, 3000, 6000, 9000, 12000, 15000, 18000, 24000]);
    expect(hi.stations.LNY[2]).toEqual({ altitude: 6000, direction: 90, speed: 14, temperature: 13 });
  });

  it('throws on non-FB text', () => {
    expect(() => parseFbProduct('<html>error</html>')).toThrow();
  });
});

describe('resolveDayHourZ', () => {
  it('rolls back to the previous month near month start', () => {
    expect(resolveDayHourZ('311800Z', new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-31T18:00:00.000Z');
  });
  it('rejects malformed tokens', () => {
    expect(resolveDayHourZ('991200Z')).toBeNull();
  });
});

describe('station table', () => {
  it('has at least 170 stations with valid coordinates and unique ids', () => {
    expect(FB_STATIONS.length).toBeGreaterThanOrEqual(170);
    expect(new Set(FB_STATIONS.map((s) => s.id)).size).toBe(FB_STATIONS.length);
    for (const s of FB_STATIONS) {
      expect(Math.abs(s.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(s.lon)).toBeLessThanOrEqual(180);
    }
  });

  it('finds the nearest station', () => {
    expect(nearestStation(40.64, -73.78).id).toBe('JFK');
    expect(nearestStation(61.2, -149.9).id).toBe('ANC');
    expect(nearestStation(21.3, -157.9).id).toBe('HNL');
  });

  it('computes great-circle distance in nm', () => {
    // JFK to LAX ≈ 2150 nm
    expect(distanceNm(40.64, -73.78, 33.94, -118.41)).toBeGreaterThan(2100);
    expect(distanceNm(40.64, -73.78, 33.94, -118.41)).toBeLessThan(2200);
  });
});
