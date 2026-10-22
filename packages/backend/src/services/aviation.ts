/**
 * Aviation Data Service
 * Fetches METAR, TAF, and TFR data from official sources
 */

import { parseMetar, type ParsedMetar } from './metar-parser.js';
import { parseTaf, type ParsedTaf } from './taf-parser.js';
import type { FlightRules } from '../types/index.js';
import { TFR_GEO_URL, parseTfrGeometry, distanceToTfr, type TfrGeometry } from './tfr-geo.js';

const AVIATION_WEATHER_API = 'https://aviationweather.gov/api/data';
// The FAA retired tfr2/list.json (it now redirects to the tfr3 web app).
// This is the JSON feed that app reads.
const TFR_API = 'https://tfr.faa.gov/tfrapi/getTfrList';

// Fetch timeout in milliseconds
const FETCH_TIMEOUT = 15000;

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = FETCH_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface MetarResponse {
  raw: string;
  parsed: ParsedMetar;
  flightRules: FlightRules;
  fetchedAt: Date;
}

export interface TafResponse {
  raw: string;
  parsed: ParsedTaf;
  fetchedAt: Date;
}

export interface TfrData {
  id: string;
  type: string;
  facility: string;
  state: string;
  description: string;
  effectiveStart: string;
  effectiveEnd: string;
  lastModified: string;
  /** Centre of the TFR's bounding box (from the FAA GeoServer layer), null when no shape is published. */
  latitude: number | null;
  longitude: number | null;
}

/**
 * Calculate flight rules based on ceiling and visibility
 * VFR: Ceiling > 3000ft AND visibility > 5sm
 * MVFR: Ceiling 1000-3000ft OR visibility 3-5sm
 * IFR: Ceiling 500-1000ft OR visibility 1-3sm
 * LIFR: Ceiling < 500ft OR visibility < 1sm
 */
export function calculateFlightRules(
  ceilingFeet: number | null,
  visibilityMiles: number | null
): FlightRules {
  // Default to null values meaning unlimited
  const ceiling = ceilingFeet ?? 99999;
  const visibility = visibilityMiles ?? 99;

  // Check LIFR first (most restrictive)
  if (ceiling < 500 || visibility < 1) {
    return 'LIFR';
  }

  // Check IFR
  if (ceiling < 1000 || visibility < 3) {
    return 'IFR';
  }

  // Check MVFR
  if (ceiling <= 3000 || visibility <= 5) {
    return 'MVFR';
  }

  // VFR
  return 'VFR';
}

/**
 * Fetch METAR for an airport
 */
export async function fetchMetar(icao: string): Promise<MetarResponse | null> {
  try {
    const url = `${AVIATION_WEATHER_API}/metar?ids=${encodeURIComponent(icao.toUpperCase())}&format=raw`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.error(`METAR fetch failed: ${response.status}`);
      return null;
    }

    const raw = (await response.text()).trim();
    if (!raw || raw.includes('No METAR')) {
      console.error(`No METAR data for ${icao}`);
      return null;
    }

    const parsed = parseMetar(raw);
    const flightRules = calculateFlightRules(parsed.ceiling, parsed.visibility);

    return {
      raw,
      parsed,
      flightRules,
      fetchedAt: new Date(),
    };
  } catch (error) {
    console.error(`Error fetching METAR for ${icao}:`, error);
    return null;
  }
}

/**
 * Fetch TAF for an airport
 */
export async function fetchTaf(icao: string): Promise<TafResponse | null> {
  try {
    const url = `${AVIATION_WEATHER_API}/taf?ids=${encodeURIComponent(icao.toUpperCase())}&format=raw`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.error(`TAF fetch failed: ${response.status}`);
      return null;
    }

    const raw = (await response.text()).trim();
    if (!raw || raw.includes('No TAF')) {
      console.error(`No TAF data for ${icao}`);
      return null;
    }

    const parsed = parseTaf(raw);

    return {
      raw,
      parsed,
      fetchedAt: new Date(),
    };
  } catch (error) {
    console.error(`Error fetching TAF for ${icao}:`, error);
    return null;
  }
}

/** One row of the FAA tfrapi/getTfrList feed (fields observed Oct 2026). */
export interface FaaTfrListItem {
  notam_id?: string;
  facility?: string;
  state?: string;
  type?: string;
  description?: string;
  mod_date?: string; // "10/15/2026 03:47:00"
  mod_abs_time?: string; // "202610150347" (UTC)
  is_new?: string;
  gid?: string;
}

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

// "Thursday, October 15, 2026"
const LONG_DATE =
  /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),\s+([a-z]+)\s+(\d{1,2}),\s+(\d{4})/i;

// Trailing date clause the FAA appends to the location:
// ", Thursday, October 15, 2026 through Monday, October 19, 2026 UTC"
// ", Saturday, October 17, 2026 UTC"
const DATE_CLAUSE = new RegExp(
  `,?\\s*(${LONG_DATE.source})(?:\\s+through\\s+(${LONG_DATE.source}))?\\s*(UTC|Local)?\\s*$`,
  'i'
);

function toIsoDate(longDate: string): string {
  const m = LONG_DATE.exec(longDate);
  if (!m) return '';
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return '';
  return `${m[3]}-${month}-${m[2].padStart(2, '0')}`;
}

/**
 * Split an FAA TFR description into its location and the day range it names.
 * The feed gives no structured effective times; the description ends with
 * "<date>[ through <date>] (UTC|Local)" when the TFR has fixed dates, and with
 * nothing when it is standing (e.g. "WASHINGTON, DC., USA").
 * Dates come back as YYYY-MM-DD (day precision only).
 */
export function parseTfrDescription(description: string): {
  location: string;
  effectiveStart: string;
  effectiveEnd: string;
} {
  const text = description.trim();
  const m = DATE_CLAUSE.exec(text);
  if (!m) {
    return { location: text, effectiveStart: '', effectiveEnd: '' };
  }
  const effectiveStart = toIsoDate(m[1]);
  const effectiveEnd = m[5] ? toIsoDate(m[5]) : effectiveStart;
  const location = text.slice(0, m.index).replace(/,\s*$/, '').trim();
  return { location, effectiveStart, effectiveEnd };
}

/** "202610150347" -> "2026-10-15T03:47:00Z" */
function absTimeToIso(absTime: string | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(absTime || '');
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
}

/** Map one FAA feed row to our TfrData shape. */
export function parseTfrListItem(tfr: FaaTfrListItem): TfrData {
  const { location, effectiveStart, effectiveEnd } = parseTfrDescription(
    String(tfr.description || '')
  );
  return {
    id: String(tfr.notam_id || tfr.gid || ''),
    type: String(tfr.type || 'Unknown'),
    facility: String(tfr.facility || ''),
    state: String(tfr.state || ''),
    description: location,
    effectiveStart,
    effectiveEnd,
    lastModified: absTimeToIso(tfr.mod_abs_time),
    latitude: null,
    longitude: null,
  };
}

/**
 * Fetch TFRs (Temporary Flight Restrictions)
 * Note: The FAA feed returns every currently listed TFR nationwide.
 */
export async function fetchTfrs(): Promise<TfrData[]> {
  try {
    const response = await fetchWithTimeout(TFR_API, { headers: { Accept: 'application/json' } });

    if (!response.ok) {
      console.error(`TFR fetch failed: ${response.status}`);
      return [];
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      console.error(
        `TFR fetch returned ${contentType || 'unknown content type'} instead of JSON (endpoint moved?)`
      );
      return [];
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      console.error('Unexpected TFR response format');
      return [];
    }

    return data.map((tfr) => parseTfrListItem(tfr as FaaTfrListItem));
  } catch (error) {
    console.error('Error fetching TFRs:', error);
    return [];
  }
}

/**
 * Fetch TFR shapes keyed by NOTAM id. Returns an empty map on failure so the
 * list still works without coordinates.
 */
export async function fetchTfrGeometry(): Promise<Map<string, TfrGeometry>> {
  try {
    const response = await fetchWithTimeout(TFR_GEO_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      console.error(`TFR geometry fetch failed: ${response.status}`);
      return new Map();
    }
    return parseTfrGeometry(await response.json());
  } catch (error) {
    console.error('Error fetching TFR geometry:', error instanceof Error ? error.message : error);
    return new Map();
  }
}

/** Attach centre coordinates from the geometry map to list rows. */
export function attachTfrCoordinates(tfrs: TfrData[], geo: Map<string, TfrGeometry>): TfrData[] {
  return tfrs.map((t) => {
    const g = geo.get(t.id);
    return { ...t, latitude: g?.latitude ?? null, longitude: g?.longitude ?? null };
  });
}

export type TfrWithDistance = TfrData & { distanceNm: number | null };

/**
 * Filter TFRs to those within `radiusNm` of a point (great-circle distance to
 * the nearest edge; 0 when the point is inside). TFRs without a published
 * shape are kept with `distanceNm: null`. Sorted nearest first.
 */
export function filterTfrsByDistance(
  tfrs: TfrData[],
  lat: number,
  lon: number,
  radiusNm: number,
  geo: Map<string, TfrGeometry> = new Map(),
): TfrWithDistance[] {
  return tfrs
    .map((t): TfrWithDistance => {
      const g = geo.get(t.id);
      return { ...t, distanceNm: g ? distanceToTfr(lat, lon, g) : null };
    })
    .filter((t) => t.distanceNm === null || t.distanceNm <= radiusNm)
    .sort((a, b) => (a.distanceNm ?? Infinity) - (b.distanceNm ?? Infinity));
}

/**
 * Aviation data manager - handles caching and periodic updates
 */
export class AviationDataManager {
  private metarCache: Map<string, MetarResponse> = new Map();
  private tafCache: Map<string, TafResponse> = new Map();
  private tfrCache: TfrData[] = [];
  private tfrGeometry: Map<string, TfrGeometry> = new Map();
  private lastTfrFetch: Date | null = null;

  private readonly METAR_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly TAF_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly TFR_TTL_MS = 15 * 60 * 1000; // 15 minutes

  async getMetar(icao: string, forceRefresh = false): Promise<MetarResponse | null> {
    const cached = this.metarCache.get(icao.toUpperCase());
    const now = Date.now();

    if (!forceRefresh && cached) {
      const age = now - cached.fetchedAt.getTime();
      if (age < this.METAR_TTL_MS) {
        return cached;
      }
    }

    const metar = await fetchMetar(icao);
    if (metar) {
      this.metarCache.set(icao.toUpperCase(), metar);
    }
    return metar;
  }

  async getTaf(icao: string, forceRefresh = false): Promise<TafResponse | null> {
    const cached = this.tafCache.get(icao.toUpperCase());
    const now = Date.now();

    if (!forceRefresh && cached) {
      const age = now - cached.fetchedAt.getTime();
      if (age < this.TAF_TTL_MS) {
        return cached;
      }
    }

    const taf = await fetchTaf(icao);
    if (taf) {
      this.tafCache.set(icao.toUpperCase(), taf);
    }
    return taf;
  }

  async getTfrs(forceRefresh = false): Promise<TfrData[]> {
    const now = Date.now();

    if (!forceRefresh && this.lastTfrFetch) {
      const age = now - this.lastTfrFetch.getTime();
      if (age < this.TFR_TTL_MS) {
        return this.tfrCache;
      }
    }

    const [list, geo] = await Promise.all([fetchTfrs(), fetchTfrGeometry()]);
    if (geo.size > 0) this.tfrGeometry = geo;
    const tfrs = attachTfrCoordinates(list, this.tfrGeometry);
    this.tfrCache = tfrs;
    this.lastTfrFetch = new Date();
    return tfrs;
  }

  /** Shapes from the last TFR refresh (for distance filtering). */
  getTfrGeometry(): Map<string, TfrGeometry> {
    return this.tfrGeometry;
  }

  clearCache(): void {
    this.metarCache.clear();
    this.tafCache.clear();
    this.tfrCache = [];
    this.tfrGeometry = new Map();
    this.lastTfrFetch = null;
  }
}

// Export singleton instance
export const aviationData = new AviationDataManager();
