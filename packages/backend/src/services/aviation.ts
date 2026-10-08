/**
 * Aviation Data Service
 * Fetches METAR, TAF, and TFR data from official sources
 */

import { parseMetar, type ParsedMetar } from './metar-parser.js';
import { parseTaf, type ParsedTaf } from './taf-parser.js';
import type { FlightRules } from '../types/index.js';

const AVIATION_WEATHER_API = 'https://aviationweather.gov/api/data';
const TFR_API = 'https://tfr.faa.gov/tfr2/list.json';

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

/**
 * Fetch TFRs (Temporary Flight Restrictions)
 * Note: The FAA TFR API returns a list of active TFRs
 */
export async function fetchTfrs(): Promise<TfrData[]> {
  try {
    // The FAA TFR list endpoint
    const response = await fetchWithTimeout(TFR_API);

    if (!response.ok) {
      console.error(`TFR fetch failed: ${response.status}`);
      return [];
    }

    const data = await response.json();

    // The API returns an array of TFR objects
    if (!Array.isArray(data)) {
      console.error('Unexpected TFR response format');
      return [];
    }

    return data.map((tfr: Record<string, unknown>) => ({
      id: String(tfr.NOTAM || tfr.notamNumber || ''),
      type: String(tfr.type || tfr.TYPE || 'Unknown'),
      facility: String(tfr.facility || tfr.FACILITY || ''),
      state: String(tfr.state || tfr.STATE || ''),
      description: String(tfr.description || tfr.DESCRIPTION || ''),
      effectiveStart: String(tfr.effectiveStart || tfr.EFFECTIVE_START || ''),
      effectiveEnd: String(tfr.effectiveEnd || tfr.EFFECTIVE_END || ''),
      lastModified: String(tfr.lastModified || tfr.LAST_MODIFIED || ''),
    }));
  } catch (error) {
    console.error('Error fetching TFRs:', error);
    return [];
  }
}

/**
 * Filter TFRs by distance from a point
 */
export function filterTfrsByDistance(
  tfrs: TfrData[],
  _lat: number,
  _lon: number,
  _radiusNm: number
): TfrData[] {
  // For now, return all TFRs since the basic API doesn't include coordinates
  // In a full implementation, we'd parse the NOTAM text or use a different API
  // that includes geographic data
  return tfrs;
}

/**
 * Aviation data manager - handles caching and periodic updates
 */
export class AviationDataManager {
  private metarCache: Map<string, MetarResponse> = new Map();
  private tafCache: Map<string, TafResponse> = new Map();
  private tfrCache: TfrData[] = [];
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

    const tfrs = await fetchTfrs();
    this.tfrCache = tfrs;
    this.lastTfrFetch = new Date();
    return tfrs;
  }

  clearCache(): void {
    this.metarCache.clear();
    this.tafCache.clear();
    this.tfrCache = [];
    this.lastTfrFetch = null;
  }
}

// Export singleton instance
export const aviationData = new AviationDataManager();
