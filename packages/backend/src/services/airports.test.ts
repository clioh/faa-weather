import { describe, it, expect } from 'vitest';
import {
  searchAirports,
  getAirport,
  loadAirports,
  nearbyAirports,
  distanceNm,
} from './airports.js';

describe('airports dataset', () => {
  it('loads thousands of METAR-reporting airports', () => {
    const all = loadAirports();
    expect(all.length).toBeGreaterThan(5000);
    for (const a of all.slice(0, 200)) {
      expect(a.icao).toMatch(/^[A-Z]{4}$/);
      expect(typeof a.lat).toBe('number');
    }
  });
});

describe('searchAirports', () => {
  it('finds military fields by ICAO', () => {
    const [first] = searchAirports('KNKX');
    expect(first.icao).toBe('KNKX');
    expect(first.city).toBe('San Diego, CA');
    expect(first.taf).toBe(true);
  });

  it('matches OurAirports keywords', () => {
    expect(searchAirports('miramar').map((a) => a.icao)).toContain('KNKX');
  });

  it('puts an exact IATA match first', () => {
    expect(searchAirports('SAN')[0].icao).toBe('KSAN');
  });

  it('ranks by station significance within the same match quality', () => {
    const icaos = searchAirports('san diego').map((a) => a.icao);
    expect(icaos[0]).toBe('KSAN');
    expect(icaos).toContain('KNKX');
  });

  it('matches ICAO prefixes and caps results', () => {
    const results = searchAirports('KS', 5);
    expect(results).toHaveLength(5);
    expect(results.every((a) => a.icao.startsWith('KS'))).toBe(true);
  });

  it('is case and whitespace insensitive', () => {
    expect(searchAirports('  half moon  bay ')[0].icao).toBe('KHAF');
  });

  it('returns nothing for short or unmatched queries', () => {
    expect(searchAirports('K')).toEqual([]);
    expect(searchAirports('zzzzqq')).toEqual([]);
  });

  it('does not treat regex characters specially', () => {
    expect(() => searchAirports('(sfo')).not.toThrow();
  });
});

describe('getAirport', () => {
  it('looks up by ICAO regardless of case', () => {
    expect(getAirport('knkx')?.iata).toBe('NKX');
    expect(getAirport('XXXX')).toBeNull();
  });
});

describe('nearbyAirports', () => {
  it('computes great-circle distance in nautical miles', () => {
    // KSFO -> KLAX is about 293 NM
    expect(distanceNm(37.619, -122.375, 33.942, -118.408)).toBeCloseTo(293, -1);
    expect(distanceNm(10, 20, 10, 20)).toBe(0);
  });

  it('lists the closest fields first with distances', () => {
    // A point in Mission Valley, San Diego
    const results = nearbyAirports(32.77, -117.15, 5);
    expect(results).toHaveLength(5);
    expect(results[0].distanceNm).toBeLessThan(results[4].distanceNm!);
    expect(results.map((a) => a.icao)).toEqual(expect.arrayContaining(['KSAN', 'KNKX', 'KMYF']));
    expect(results[0].distanceNm).toBeLessThan(10);
  });

  it('rejects invalid coordinates', () => {
    expect(nearbyAirports(NaN, 0)).toEqual([]);
    expect(nearbyAirports(91, 0)).toEqual([]);
  });
});
