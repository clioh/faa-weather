import { describe, it, expect } from 'vitest';
import { parseTfrGeometry, notamIdFromKey, distanceToTfr } from './tfr-geo.js';
import { attachTfrCoordinates, filterTfrsByDistance, parseTfrListItem } from './aviation.js';

/** Square approx. 1.2 nm across around (35.795, -78.711), like a small stadium TFR. */
const square = [
  [-78.73, 35.78],
  [-78.69, 35.78],
  [-78.69, 35.81],
  [-78.73, 35.81],
  [-78.73, 35.78],
];

// Shape of https://tfr.faa.gov/geoserver/TFR/ows?...typeName=TFR:V_TFR_LOC (Oct 2026)
const WFS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [square] },
      properties: { NOTAM_KEY: '6/9169-1-FDC-F', TITLE: 'RALEIGH, NC', STATE: 'NC' },
    },
    // Second area of a multi-area TFR
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-100, 40], [-99, 40], [-99, 41], [-100, 40]]] },
      properties: { NOTAM_KEY: '6/1000-1-FDC-F' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-98, 40], [-97, 40], [-97, 41], [-98, 40]]] },
      properties: { NOTAM_KEY: '6/1000-2-FDC-F' },
    },
    { type: 'Feature', geometry: null, properties: { NOTAM_KEY: '6/2000-1-FDC-F' } },
  ],
};

const row = (id: string) =>
  parseTfrListItem({ notam_id: id, type: 'SECURITY', description: 'SOMEWHERE, Saturday, October 17, 2026 UTC' });

describe('TFR geometry', () => {
  const geo = parseTfrGeometry(WFS);

  it('maps NOTAM keys to list ids', () => {
    expect(notamIdFromKey('6/9169-1-FDC-F')).toBe('6/9169');
  });

  it('computes a centre per TFR, merging multiple areas', () => {
    expect(geo.get('6/9169')).toMatchObject({ latitude: 35.795, longitude: -78.71 });
    expect(geo.get('6/1000')).toMatchObject({ latitude: 40.5, longitude: -98.5 });
    expect(geo.get('6/1000')?.rings).toHaveLength(2);
    expect(geo.has('6/2000')).toBe(false);
  });

  it('ignores malformed bodies', () => {
    expect(parseTfrGeometry(null).size).toBe(0);
    expect(parseTfrGeometry({ features: 'x' }).size).toBe(0);
  });

  it('measures distance to the nearest edge, 0 inside', () => {
    const g = geo.get('6/9169')!;
    expect(distanceToTfr(35.795, -78.71, g)).toBe(0);
    // ~60 nm north of the square
    const d = distanceToTfr(36.81, -78.71, g);
    expect(d).toBeGreaterThan(59);
    expect(d).toBeLessThan(61);
  });

  it('attaches coordinates and filters by radius, keeping unlocated TFRs', () => {
    const tfrs = attachTfrCoordinates([row('6/9169'), row('6/1000'), row('6/2000')], geo);
    expect(tfrs[0]).toMatchObject({ latitude: 35.795, longitude: -78.71 });
    expect(tfrs[2]).toMatchObject({ latitude: null, longitude: null });

    const near = filterTfrsByDistance(tfrs, 35.9, -78.8, 50, geo);
    expect(near.map((t) => t.id)).toEqual(['6/9169', '6/2000']);
    expect(near[0].distanceNm).toBeGreaterThan(0);
    expect(near[1].distanceNm).toBeNull();

    const all = filterTfrsByDistance(tfrs, 35.9, -78.8, Infinity, geo);
    expect(all).toHaveLength(3);
  });
});
