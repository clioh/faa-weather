/**
 * NOTAM Service
 * Fetches NOTAMs from FAA NOTAM API v2
 * API Documentation: https://api.faa.gov/
 */

import { loadConfig } from '../config/index.js';

const NOTAM_API_BASE = 'https://external-api.faa.gov/notamapi/v2';

export interface NotamData {
  id: string;
  icao: string;
  type: string;
  classification: string;
  description: string;
  effectiveStart: Date;
  effectiveEnd: Date | null;
  location: string;
  affectedFir: string;
  schedule: string | null;
  minimumAltitude: string | null;
  maximumAltitude: string | null;
}

interface FaaNotamResponse {
  pageSize: number;
  pageNum: number;
  totalCount: number;
  totalPages: number;
  items: FaaNotamItem[];
}

interface FaaNotamItem {
  id: string;
  key: string;
  type: string;
  effectiveStart: string;
  effectiveEnd: string;
  issueDate: string;
  location: string;
  affectedFir: string;
  classification: string;
  schedule: string | null;
  notamText: string;
  traditionalMessage?: string;
  icaoMessage?: string;
  minimumAltitude?: string;
  maximumAltitude?: string;
}

/**
 * Fetch NOTAMs for an airport
 */
export async function fetchNotams(icao: string): Promise<NotamData[]> {
  const config = loadConfig();
  const apiKey = config.notam_api_key;

  if (!apiKey) {
    console.warn('NOTAM API key not configured - skipping NOTAM fetch');
    return [];
  }

  try {
    const url = `${NOTAM_API_BASE}/notams?icaoLocation=${icao.toUpperCase()}&sortBy=effectiveStartDate&sortOrder=Desc&pageSize=50`;

    const response = await fetch(url, {
      headers: {
        client_id: apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        console.error('NOTAM API: Invalid API key');
      } else if (response.status === 429) {
        console.error('NOTAM API: Rate limit exceeded');
      } else {
        console.error(`NOTAM fetch failed: ${response.status}`);
      }
      return [];
    }

    const data = (await response.json()) as FaaNotamResponse;

    if (!data.items || !Array.isArray(data.items)) {
      return [];
    }

    return data.items.map((item) => ({
      id: item.id || item.key,
      icao: icao.toUpperCase(),
      type: item.type || 'NOTAM',
      classification: item.classification || 'Unknown',
      description: item.traditionalMessage || item.notamText || item.icaoMessage || '',
      effectiveStart: new Date(item.effectiveStart),
      effectiveEnd: item.effectiveEnd ? new Date(item.effectiveEnd) : null,
      location: item.location || icao,
      affectedFir: item.affectedFir || '',
      schedule: item.schedule || null,
      minimumAltitude: item.minimumAltitude || null,
      maximumAltitude: item.maximumAltitude || null,
    }));
  } catch (error) {
    console.error(`Error fetching NOTAMs for ${icao}:`, error);
    return [];
  }
}

/**
 * Filter NOTAMs by category/classification
 * Common classifications: FDC, NOTAM, SAA, GPS
 */
export function filterNotamsByCategory(
  notams: NotamData[],
  categories: string[]
): NotamData[] {
  if (!categories || categories.length === 0) {
    return notams;
  }

  const upperCategories = categories.map((c) => c.toUpperCase());
  return notams.filter((notam) =>
    upperCategories.some(
      (cat) =>
        notam.classification.toUpperCase().includes(cat) ||
        notam.type.toUpperCase().includes(cat)
    )
  );
}

/**
 * Filter to only active NOTAMs (currently in effect)
 */
export function filterActiveNotams(notams: NotamData[]): NotamData[] {
  const now = new Date();
  return notams.filter((notam) => {
    const started = notam.effectiveStart <= now;
    const notEnded = !notam.effectiveEnd || notam.effectiveEnd > now;
    return started && notEnded;
  });
}

/**
 * NOTAM data manager with caching
 */
export class NotamDataManager {
  private cache: Map<string, { notams: NotamData[]; fetchedAt: Date }> =
    new Map();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes

  async getNotams(icao: string, forceRefresh = false): Promise<NotamData[]> {
    const cached = this.cache.get(icao.toUpperCase());
    const now = Date.now();

    if (!forceRefresh && cached) {
      const age = now - cached.fetchedAt.getTime();
      if (age < this.TTL_MS) {
        return cached.notams;
      }
    }

    const notams = await fetchNotams(icao);
    this.cache.set(icao.toUpperCase(), {
      notams,
      fetchedAt: new Date(),
    });

    return notams;
  }

  async getActiveNotams(icao: string): Promise<NotamData[]> {
    const notams = await this.getNotams(icao);
    return filterActiveNotams(notams);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const notamData = new NotamDataManager();
