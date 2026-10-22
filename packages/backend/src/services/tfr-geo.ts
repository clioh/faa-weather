/**
 * TFR geometry from the FAA TFR GeoServer WFS (the layer the tfr.faa.gov
 * map uses). The getTfrList feed has no coordinates, so shapes are joined
 * to list rows by NOTAM id ("6/9169-1-FDC-F" → "6/9169").
 */

import { distanceNm } from './winds-aloft.js';

export const TFR_GEO_URL =
  'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature' +
  '&typeName=TFR:V_TFR_LOC&outputFormat=application/json&srsname=EPSG:4326';

/** [lon, lat] pairs, GeoJSON order. */
type Ring = Array<[number, number]>;

export interface TfrGeometry {
  latitude: number;
  longitude: number;
  /** Outer rings of every area of the TFR. */
  rings: Ring[];
}

interface GeoFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: { NOTAM_KEY?: unknown } | null;
}

function isPair(p: unknown): p is [number, number] {
  return Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number';
}

function outerRings(geometry: GeoFeature['geometry']): Ring[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const c = geometry.coordinates as unknown[];
  if (geometry.type === 'Polygon') {
    const ring = (c[0] as unknown[] | undefined)?.filter(isPair) ?? [];
    return ring.length ? [ring] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return c
      .map((poly) => ((poly as unknown[])?.[0] as unknown[] | undefined)?.filter(isPair) ?? [])
      .filter((r) => r.length > 0);
  }
  if (geometry.type === 'Point' && isPair(c)) return [[c as [number, number]]];
  return [];
}

/** NOTAM key → list id: "6/9169-1-FDC-F" → "6/9169". */
export function notamIdFromKey(key: string): string {
  return key.split('-')[0].trim();
}

/** Group WFS features by NOTAM id and compute a bounding-box centre for each. */
export function parseTfrGeometry(body: unknown): Map<string, TfrGeometry> {
  const out = new Map<string, TfrGeometry>();
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return out;
  const grouped = new Map<string, Ring[]>();
  for (const f of features as GeoFeature[]) {
    const key = f?.properties?.NOTAM_KEY;
    if (typeof key !== 'string') continue;
    const rings = outerRings(f.geometry);
    if (!rings.length) continue;
    const id = notamIdFromKey(key);
    grouped.set(id, [...(grouped.get(id) ?? []), ...rings]);
  }
  for (const [id, rings] of grouped) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
      }
    }
    out.set(id, {
      latitude: Math.round(((minLat + maxLat) / 2) * 1e5) / 1e5,
      longitude: Math.round(((minLon + maxLon) / 2) * 1e5) / 1e5,
      rings,
    });
  }
  return out;
}

function pointInRing(lat: number, lon: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Distance (nm) from a point to a TFR: 0 when inside any area, otherwise the
 * distance to the nearest vertex (shapes are densely sampled circles/polygons).
 */
export function distanceToTfr(lat: number, lon: number, geo: TfrGeometry): number {
  let best = distanceNm(lat, lon, geo.latitude, geo.longitude);
  for (const ring of geo.rings) {
    if (ring.length >= 3 && pointInRing(lat, lon, ring)) return 0;
    for (const [vLon, vLat] of ring) {
      best = Math.min(best, distanceNm(lat, lon, vLat, vLon));
    }
  }
  return Math.round(best * 10) / 10;
}
