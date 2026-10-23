/**
 * Winds & Temperatures Aloft (FB) Service
 *
 * Fetches the AWC FB text product, parses its fixed-width table and returns
 * the levels for the FB station nearest to the requested coordinates.
 *
 * Encoding (per FAA AIM 7-1-5 / AC 00-45):
 *   DDSS      direction (tens of degrees) + speed (kt), no temp (e.g. 3000 ft)
 *   DDSS+TT   with temperature (°C, explicit sign)
 *   DDSSTT    above 24,000 ft: temperature is always negative, sign omitted
 *   9900      light and variable (< 5 kt)  → direction null, speed 0
 *   DD ≥ 51   speed ≥ 100 kt: direction = (DD − 50) × 10, speed = SS + 100
 *             ("7799" = 270° at 199 kt or more)
 *   blank     level is below station elevation (or within 1,500 ft for 3000 ft)
 */

import { FB_STATIONS, type FbRegion, type FbStation } from './winds-aloft-stations.js';
import { TtlCache, UpstreamError, fetchText } from './upstream.js';

export const WINDS_CACHE_TTL_MS = 30 * 60 * 1000;
const AWC_WINDTEMP = 'https://aviationweather.gov/api/data/windtemp';

export interface WindLevel {
  altitude: number;
  direction: number | null;
  speed: number;
  temperature: number | null;
}

export interface FbProduct {
  validAt: string | null;
  forUse: string | null;
  altitudes: number[];
  stations: Record<string, WindLevel[]>;
}

/**
 * Decode one FB group. `altitude` decides whether an unsigned temperature is
 * negative (> 24,000 ft). Returns null for blank/unparseable groups.
 */
export function decodeWindGroup(raw: string, altitude: number): WindLevel | null {
  const g = raw.trim();
  const m = g.match(/^(\d{2})(\d{2})(?:([+-])?(\d{2}))?$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const ss = Number(m[2]);
  let temperature: number | null = null;
  if (m[4] !== undefined) {
    const t = Number(m[4]);
    if (m[3] === '+') temperature = t;
    else if (m[3] === '-') temperature = -t;
    else temperature = altitude > 24000 ? -t : t;
  }

  if (dd === 99 && ss === 0) {
    return { altitude, direction: null, speed: 0, temperature };
  }
  let direction = dd * 10;
  let speed = ss;
  if (dd >= 51 && dd <= 86) {
    direction = (dd - 50) * 10;
    speed = ss + 100;
  } else if (dd > 36) {
    return null;
  }
  if (direction === 0) direction = 360;
  return { altitude, direction, speed, temperature };
}

/** Resolve "DDHHMMZ" to an ISO timestamp near `now` (handles month rollover). */
export function resolveDayHourZ(token: string, now = new Date()): string | null {
  const m = token.match(/^(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const [day, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const candidates = [-1, 0, 1].map((offset) => {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, hour, minute)
    );
    return d;
  });
  const valid = candidates.filter((d) => d.getUTCDate() === day);
  if (valid.length === 0) return null;
  valid.sort(
    (a, b) => Math.abs(a.getTime() - now.getTime()) - Math.abs(b.getTime() - now.getTime())
  );
  return valid[0].toISOString();
}

/**
 * Parse an FB product. Column boundaries come from the "FT" header line:
 * each value is right-aligned to the end of its altitude label.
 */
export function parseFbProduct(text: string, now = new Date()): FbProduct {
  const lines = text.replace(/\r/g, '').split('\n');
  const headerIdx = lines.findIndex((l) => /^FT\s+\d/.test(l));
  if (headerIdx < 0) throw new UpstreamError('Unexpected winds aloft format');

  const header = lines[headerIdx];
  const columns: Array<{ altitude: number; start: number; end: number }> = [];
  const re = /\d+/g;
  let match: RegExpExecArray | null;
  let prevEnd = 3; // station id occupies columns 0-2
  while ((match = re.exec(header)) !== null) {
    const end = match.index + match[0].length;
    columns.push({ altitude: Number(match[0]), start: prevEnd, end });
    prevEnd = end;
  }

  let validAt: string | null = null;
  let forUse: string | null = null;
  for (const line of lines.slice(0, headerIdx)) {
    const v = line.match(/VALID\s+(\d{6}Z)/);
    if (v) validAt = resolveDayHourZ(v[1], now);
    const f = line.match(/FOR USE\s+(\d{4}-\d{4}Z)/);
    if (f) forUse = f[1];
  }

  const stations: Record<string, WindLevel[]> = {};
  for (const line of lines.slice(headerIdx + 1)) {
    const id = line.slice(0, 3);
    if (!/^[A-Z0-9]{3}$/.test(id) || (line.length > 3 && line[3] !== ' ')) continue;
    const levels: WindLevel[] = [];
    for (const col of columns) {
      const cell = line.slice(col.start, col.end);
      const level = decodeWindGroup(cell, col.altitude);
      if (level) levels.push(level);
    }
    stations[id] = levels;
  }

  return { validAt, forUse, altitudes: columns.map((c) => c.altitude), stations };
}

export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function nearestStation(
  lat: number,
  lon: number,
  stations: FbStation[] = FB_STATIONS
): FbStation {
  let best = stations[0];
  let bestDist = Infinity;
  for (const s of stations) {
    const d = distanceNm(lat, lon, s.lat, s.lon);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

const AWC_REGION: Record<FbRegion, string> = { us: 'all', alaska: 'alaska', hawaii: 'hawaii' };

const productCache = new TtlCache<string>(WINDS_CACHE_TTL_MS);

async function getProduct(
  region: FbRegion,
  level: 'low' | 'high'
): Promise<{ text: string; storedAt: number }> {
  const key = `${region}|${level}`;
  const result = await productCache.get(key, async () => {
    const url = `${AWC_WINDTEMP}?region=${AWC_REGION[region]}&level=${level}&fcst=06`;
    const text = await fetchText(url, { timeoutMs: 10_000, maxBytes: 512 * 1024 });
    if (!/^FT\s+\d/m.test(text)) throw new UpstreamError('Winds aloft product unavailable');
    return text;
  });
  return { text: result.value, storedAt: result.storedAt };
}

export interface WindsAloftResult {
  station: string;
  stationName: string | null;
  validAt: string | null;
  forUse: string | null;
  levels: WindLevel[];
  fetchedAt: string;
}

export async function getWindsAloft(
  lat: number,
  lon: number,
  maxAltitude: number
): Promise<WindsAloftResult> {
  const station = nearestStation(lat, lon);
  const low = await getProduct(station.region, 'low');
  const lowParsed = parseFbProduct(low.text);
  let levels = lowParsed.stations[station.id] ?? [];

  const lowTop = Math.max(...lowParsed.altitudes);
  if (maxAltitude > lowTop && station.region === 'us') {
    try {
      const high = await getProduct(station.region, 'high');
      const highLevels = parseFbProduct(high.text).stations[station.id] ?? [];
      levels = [...levels, ...highLevels.filter((l) => l.altitude > lowTop)];
    } catch {
      // High-level product is optional; keep low levels.
    }
  }

  return {
    station: station.id,
    stationName: station.name ? `${station.name}, ${station.state}`.replace(/, $/, '') : null,
    validAt: lowParsed.validAt,
    forUse: lowParsed.forUse,
    levels: levels.filter((l) => l.altitude <= maxAltitude).sort((a, b) => a.altitude - b.altitude),
    fetchedAt: new Date(low.storedAt).toISOString(),
  };
}
