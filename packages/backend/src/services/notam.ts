/**
 * NOTAM Service
 *
 * NOTAMs come from the SkyGlass cloud service (config `skyglass_service`,
 * default https://skyglass.dev): GET /api/data/notams?icao=KSAN. The service
 * holds the FAA NOTAM API credentials and CDN-caches responses, so the mirror
 * holds no key. When the service can't be reached or has no FAA credentials,
 * the mirror shows no NOTAMs (logged with the reason). Category
 * classification and active/category filtering stay on the mirror.
 * See docs/CLOUD_SERVICE.md.
 */

import { loadConfig } from '../config/index.js';
import { getSkyglassJson, skyglassServiceUrl, type ServiceFailure } from './skyglass-service.js';

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

export const ICAO_RE = /^[A-Z0-9]{3,4}$/;

/** Human-readable reason NOTAMs are unavailable (logged). */
export function notamUnavailableMessage(reason: ServiceFailure | 'invalid_icao'): string {
  switch (reason) {
    case 'invalid_config':
      return 'skyglass_service is not a valid https:// URL; NOTAMs are disabled. See docs/CLOUD_SERVICE.md.';
    case 'not_configured':
      return "The SkyGlass service has no FAA NOTAM credentials configured; NOTAMs aren't available right now.";
    case 'rate_limited':
      return 'The SkyGlass service is rate limiting NOTAM requests; showing no NOTAMs for now.';
    case 'invalid_icao':
      return 'Airport code is not a valid ICAO identifier; no NOTAMs requested.';
    case 'rejected':
      return 'The SkyGlass service rejected the NOTAM request.';
    case 'bad_response':
      return 'The SkyGlass service returned an unusable NOTAM response.';
    default:
      return "Can't reach the SkyGlass service for NOTAMs. Check the mirror's internet connection.";
  }
}

export type NotamFetchResult =
  | { ok: true; notams: NotamData[] }
  | { ok: false; reason: ServiceFailure | 'invalid_icao'; message: string };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function date(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Map the cloud body ({ version: 1, notams: [...] }) to NotamData; null if malformed. */
export function parseCloudNotams(json: unknown, icao: string): NotamData[] | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as { version?: unknown; notams?: unknown };
  if (body.version !== 1 || !Array.isArray(body.notams)) return null;
  const out: NotamData[] = [];
  for (const raw of body.notams as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    const id = str(n.id);
    const effectiveStart = date(n.effectiveStart);
    if (!id || !effectiveStart) continue;
    out.push({
      id,
      icao,
      type: str(n.type) ?? 'NOTAM',
      classification: str(n.classification) ?? 'Unknown',
      description: typeof n.text === 'string' ? n.text : '',
      effectiveStart,
      effectiveEnd: date(n.effectiveEnd),
      location: str(n.location) ?? icao,
      affectedFir: str(n.affectedFir) ?? '',
      schedule: str(n.schedule),
      minimumAltitude: str(n.minimumAltitude),
      maximumAltitude: str(n.maximumAltitude),
    });
  }
  return out;
}

/** Fetch NOTAMs for an airport from the SkyGlass service. Never throws. */
export async function fetchNotamsResult(icaoRaw: string, base?: string | null): Promise<NotamFetchResult> {
  const icao = (icaoRaw || '').trim().toUpperCase();
  if (!ICAO_RE.test(icao)) return { ok: false, reason: 'invalid_icao', message: notamUnavailableMessage('invalid_icao') };
  let serviceBase = base;
  if (serviceBase === undefined) {
    try {
      serviceBase = skyglassServiceUrl(loadConfig());
    } catch {
      serviceBase = null;
    }
  }
  const res = await getSkyglassJson(serviceBase, `/api/data/notams?icao=${icao}`, { maxBytes: 1024 * 1024 });
  if (!res.ok) return { ok: false, reason: res.reason, message: notamUnavailableMessage(res.reason) };
  const notams = parseCloudNotams(res.json, icao);
  if (!notams) return { ok: false, reason: 'bad_response', message: notamUnavailableMessage('bad_response') };
  return { ok: true, notams };
}

/** NOTAMs for an airport, or [] when unavailable (reason logged). */
export async function fetchNotams(icao: string): Promise<NotamData[]> {
  const r = await fetchNotamsResult(icao);
  if (r.ok) return r.notams;
  console.warn(`[notam] ${r.message}`);
  return [];
}

export const NOTAM_CATEGORIES = ['runway', 'taxiway', 'obstacle', 'airspace', 'navaid', 'approach', 'other'] as const;
export type NotamCategory = (typeof NOTAM_CATEGORIES)[number];

const CATEGORY_KEYWORDS: Array<[Exclude<NotamCategory, 'other'>, string[]]> = [
  ['runway', ['RWY', 'RUNWAY', 'RUNWAYS']],
  ['taxiway', ['TWY', 'TAXIWAY', 'TAXIWAYS']],
  ['obstacle', ['OBST', 'OBSTACLE', 'OBSTACLES', 'CRANE', 'CRANES', 'TOWER', 'TOWERS']],
  ['airspace', ['AIRSPACE', 'TFR', 'PJE']],
  ['navaid', ['NAV', 'NAVAID', 'VOR', 'VORTAC', 'VOR/DME', 'ILS', 'LOC', 'GS', 'DME', 'NDB', 'TACAN']],
  ['approach', ['APCH', 'APPROACH', 'IAP', 'SID', 'STAR', 'ODP']],
];

const KEYWORD_PATTERNS = CATEGORY_KEYWORDS.map(([category, words]) => ({
  category,
  re: new RegExp(`(?<![A-Z0-9])(?:${words.map((w) => w.replace('/', '\\/')).join('|')})(?![A-Z0-9])`, 'g'),
}));

/**
 * Classify a NOTAM by keywords in its text. NOTAMs lead with their subject
 * keyword ("RWY 04L/22R CLSD", "IAP JFK ILS RWY 22L ..."), so the category
 * whose keyword appears earliest wins; text without any keyword is 'other'.
 */
export function classifyNotam(text: string): NotamCategory {
  const upper = (text || '').toUpperCase();
  let best: { category: NotamCategory; index: number } = { category: 'other', index: Infinity };
  for (const { category, re } of KEYWORD_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(upper);
    if (m && m.index < best.index) best = { category, index: m.index };
  }
  return best.category;
}

/**
 * Filter NOTAMs by derived category (runway, taxiway, obstacle, airspace,
 * navaid, approach, other). Values that are not a known category fall back
 * to matching the FAA classification/type codes (e.g. "FDC").
 */
export function filterNotamsByCategory(
  notams: NotamData[],
  categories: string[]
): NotamData[] {
  const wanted = categories.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) {
    return notams;
  }
  const known = new Set<string>(NOTAM_CATEGORIES);
  const derived = wanted.filter((c) => known.has(c));
  const codes = wanted.filter((c) => !known.has(c)).map((c) => c.toUpperCase());
  return notams.filter(
    (notam) =>
      derived.includes(classifyNotam(notam.description)) ||
      codes.some(
        (code) =>
          notam.classification.toUpperCase().includes(code) || notam.type.toUpperCase().includes(code)
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
 * NOTAM data manager with caching. Successful lists are cached 30 minutes.
 * A failed fetch keeps serving the last good list for that airport (up to 6 h;
 * otherwise []) and is retried after 5 minutes. The unavailable reason is
 * logged once per change, not on every request.
 */
export class NotamDataManager {
  private cache: Map<string, { notams: NotamData[]; fetchedAt: number; ok: boolean; goodAt: number | null }> = new Map();
  private lastWarning = new Map<string, string>();
  readonly TTL_MS = 30 * 60 * 1000;
  readonly FAILURE_TTL_MS = 5 * 60 * 1000;
  /** The last good list is served through failures for at most this long. */
  readonly MAX_STALE_MS = 6 * 60 * 60 * 1000;

  constructor(
    private readonly fetcher: (icao: string) => Promise<NotamFetchResult> = (icao) => fetchNotamsResult(icao),
    private readonly now: () => number = Date.now,
  ) {}

  async getNotams(icao: string, forceRefresh = false): Promise<NotamData[]> {
    const key = (icao || '').trim().toUpperCase();
    const cached = this.cache.get(key);
    if (!forceRefresh && cached) {
      const ttl = cached.ok ? this.TTL_MS : this.FAILURE_TTL_MS;
      if (this.now() - cached.fetchedAt < ttl) return cached.notams;
    }

    const result = await this.fetcher(key);
    if (result.ok) {
      this.cache.set(key, { notams: result.notams, fetchedAt: this.now(), ok: true, goodAt: this.now() });
      this.lastWarning.delete(key);
      return result.notams;
    }
    if (this.lastWarning.get(key) !== result.reason) {
      console.warn(`[notam] ${key}: ${result.message}`);
      this.lastWarning.set(key, result.reason);
    }
    const goodAt = cached?.goodAt ?? null;
    const fresh = goodAt !== null && this.now() - goodAt < this.MAX_STALE_MS;
    const fallback = fresh ? cached!.notams : [];
    this.cache.set(key, { notams: fallback, fetchedAt: this.now(), ok: false, goodAt: fresh ? goodAt : null });
    return fallback;
  }

  async getActiveNotams(icao: string): Promise<NotamData[]> {
    const notams = await this.getNotams(icao);
    return filterActiveNotams(notams);
  }

  clearCache(): void {
    this.cache.clear();
    this.lastWarning.clear();
  }
}

// Export singleton instance
export const notamData = new NotamDataManager();
