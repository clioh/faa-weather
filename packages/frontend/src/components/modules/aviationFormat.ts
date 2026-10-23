/**
 * Formatting helpers shared by the aviation and weather widgets.
 *
 * Pure functions (plus a tiny clock hook) so the widgets stay focused on
 * layout. Aviation values are formatted the way they read on a briefing:
 * "270° 12G18 kt", "BKN035", "30.12", "1435Z".
 */

import { useEffect, useState } from 'react';

/* ------------------------------------------------------------ API shapes */

export interface Wind {
  direction: number | null;
  speed: number;
  gust: number | null;
  variable?: { from: number; to: number };
}

export interface CloudLayer {
  coverage: string;
  altitude: number | null;
  type?: string;
}

/** GET /api/aviation/metar/:icao */
export interface MetarResponse {
  icao: string;
  raw: string;
  flightRules: string | null;
  parsed?: {
    observationTime?: string;
    wind: Wind | null;
    visibility: number | null;
    weather?: string[];
    clouds?: CloudLayer[];
    ceiling: number | null;
    temperature: number | null;
    dewpoint: number | null;
    altimeter: number | null;
  };
  fetchedAt?: string;
}

/* ------------------------------------------------------------- Numbers */

const pad = (n: number, width = 2) => String(Math.round(n)).padStart(width, '0');

/* ---------------------------------------------------------------- Wind */

/** Split a wind into value + unit so Metric can style the unit. */
export function windParts(wind: Wind | null | undefined): { value: string; unit: string } {
  if (!wind || wind.speed === 0) return { value: 'Calm', unit: '' };
  const dir = wind.direction === null ? 'VRB' : `${pad(wind.direction, 3)}°`;
  const gust = wind.gust ? `G${wind.gust}` : '';
  return { value: `${dir} ${pad(wind.speed)}${gust}`, unit: 'kt' };
}

/** "270° 12G18 kt", "VRB 04 kt", "Calm" */
export function formatWind(wind: Wind | null | undefined): string {
  const { value, unit } = windParts(wind);
  return unit ? `${value} ${unit}` : value;
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** 315 → "NW" */
export function compassPoint(degrees: number | null | undefined): string {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return '';
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * Counts of pennants (50 kt), full barbs (10 kt) and half barbs (5 kt) for a
 * wind barb, after rounding to the nearest 5 kt as plotted charts do.
 */
export function barbComponents(speed: number): { pennants: number; fulls: number; halves: number } {
  let rest = Math.round(Math.max(0, speed) / 5) * 5;
  const pennants = Math.floor(rest / 50);
  rest -= pennants * 50;
  const fulls = Math.floor(rest / 10);
  rest -= fulls * 10;
  return { pennants, fulls, halves: rest >= 5 ? 1 : 0 };
}

/** Winds-aloft cell: "270/25", or "LV" for light and variable. */
export function formatWindsAloft(direction: number | null, speed: number): string {
  if (direction === null) return 'LV';
  return `${pad(direction, 3)}/${pad(speed)}`;
}

/* ---------------------------------------------------------- Visibility */

const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

/** Statute miles → "10+", "3", "1½", "¾" (unit SM is added by the caller). */
export function formatVisibilityValue(sm: number | null | undefined, plusAt = 10): string | null {
  if (sm === null || sm === undefined || !Number.isFinite(sm)) return null;
  if (sm >= plusAt) return `${plusAt}+`;
  const whole = Math.floor(sm);
  const frac = FRACTIONS[String(Math.round((sm - whole) * 100) / 100)];
  if (frac) return whole > 0 ? `${whole}${frac}` : frac;
  return String(Math.round(sm * 10) / 10);
}

/** "10+ SM"; TAFs top out at P6SM so pass plusAt=6 for them. */
export function formatVisibility(sm: number | null | undefined, plusAt = 10): string | null {
  const value = formatVisibilityValue(sm, plusAt);
  return value === null ? null : `${value} SM`;
}

/* -------------------------------------------------------------- Clouds */

/** One layer in METAR notation: "BKN035", "OVC008CB", "CLR". */
function cloudLayerCode(layer: CloudLayer): string {
  if (layer.altitude === null || layer.coverage === 'CLR' || layer.coverage === 'SKC') {
    return layer.coverage;
  }
  return `${layer.coverage}${pad(layer.altitude / 100, 3)}${layer.type ?? ''}`;
}

/**
 * The layer a pilot cares about first: the ceiling (lowest BKN/OVC/VV) when
 * there is one, otherwise the lowest reported layer, otherwise "CLR".
 */
export function formatCeiling(
  clouds: CloudLayer[] | undefined,
  ceiling: number | null | undefined
): string {
  const layers = clouds ?? [];
  if (ceiling !== null && ceiling !== undefined) {
    const layer = layers.find(
      (l) => l.altitude === ceiling && ['BKN', 'OVC', 'VV'].includes(l.coverage)
    );
    return layer ? cloudLayerCode(layer) : `CIG${pad(ceiling / 100, 3)}`;
  }
  const lowest = layers.find((l) => l.altitude !== null) ?? layers[0];
  return lowest ? cloudLayerCode(lowest) : 'CLR';
}

/* ------------------------------------------------- Temperature / pressure */

/** Signed whole degrees for METAR temps: "12", "M04" reads oddly, so use "−4". */
export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const n = Math.round(value);
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

/** "30.12" (inHg) */
export function formatAltimeter(inHg: number | null | undefined): string | null {
  if (inHg === null || inHg === undefined || !Number.isFinite(inHg)) return null;
  return inHg.toFixed(2);
}

/* ---------------------------------------------------------------- Time */

/** "1435Z" */
export function formatZulu(date: Date | number | string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
}

/** "15/1435Z" — day-of-month prefix for times that may cross midnight. */
export function formatZuluDay(date: Date | number | string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getUTCDate())}/${formatZulu(d)}`;
}

/** Local clock time in a time zone: "6:52 AM" or "06:52" depending on locale. */
export function formatLocalTime(date: Date | number | string, timeZone?: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    // An unknown zone name throws; the mirror's own zone is the best fallback.
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

/**
 * Resolve a TAF/METAR "DDHH" or "DDHHmm" stamp to a Date. Reports only carry
 * the day of month, so pick the month that puts it closest to `reference`.
 * "24" as an hour means midnight at the end of that day.
 */
export function parseDayTime(stamp: string, reference: Date = new Date()): Date | null {
  const m = /^(\d{2})(\d{2})(\d{2})?/.exec(stamp);
  if (!m) return null;
  const day = Number(m[1]);
  const hour = Number(m[2]);
  const minute = Number(m[3] ?? '0');
  if (day < 1 || day > 31 || hour > 24 || minute > 59) return null;

  const candidates = [-1, 0, 1].map(
    (offset) =>
      new Date(
        Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + offset, day, hour, minute)
      )
  );
  let best = candidates[1];
  for (const c of candidates) {
    if (
      Math.abs(c.getTime() - reference.getTime()) < Math.abs(best.getTime() - reference.getTime())
    ) {
      best = c;
    }
  }
  return best;
}

/** TAF period range: "15/18–16/00Z" (day/hour, Zulu). */
export function formatTafRange(start: Date, end: Date): string {
  const s = `${pad(start.getUTCDate())}/${pad(start.getUTCHours())}`;
  const e = `${pad(end.getUTCDate())}/${pad(end.getUTCHours())}`;
  return `${s}–${e}Z`;
}

/** 72 → "1h 12m", 45 → "45m", 120 → "2h" */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** Altitude label for winds aloft: "3,000" below the flight levels, "FL240" above. */
export function formatAltitudeLabel(feet: number): string {
  if (feet >= 18000) return `FL${pad(feet / 100, 3)}`;
  return feet.toLocaleString('en-US');
}

/** Re-render on a fixed period so countdowns and "now" markers move. */
export function useNow(periodMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), periodMs);
    return () => window.clearInterval(id);
  }, [periodMs]);
  return now;
}

/* ------------------------------------------------------------ Geometry */

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* -------------------------------------------------------------- NOTAMs */

export interface NotamCategory {
  /** Chip text */
  label: string;
  /** Sort rank: runway/taxiway first */
  rank: number;
}

// Keyword → category, in rank order. Matched against the NOTAM text after
// the "!JFK 10/045 JFK" prefix, where the subject keyword leads.
const NOTAM_CATEGORIES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'RWY', pattern: /\bRWY\b|\bRUNWAY\b/ },
  { label: 'TWY', pattern: /\bTWY\b|\bTAXIWAY\b/ },
  { label: 'APRON', pattern: /\bAPRON\b|\bRAMP\b/ },
  { label: 'AD', pattern: /^AD\b|\bAERODROME\b|\bAIRPORT\b/ },
  { label: 'IAP', pattern: /\bIAP\b|\bRNAV\b|\bILS\b|\bLOC\b|\bAPCH\b|\bAPPROACH\b|\bGPS\b/ },
  { label: 'PROC', pattern: /\bSID\b|\bSTAR\b|\bODP\b|\bDP\b|\bPROC\b/ },
  { label: 'NAV', pattern: /\bNAV\b|\bVOR\b|\bNDB\b|\bDME\b|\bTACAN\b/ },
  { label: 'COM', pattern: /^COM\b|\bATIS\b|\bFREQ\b/ },
  { label: 'AIRSPACE', pattern: /\bAIRSPACE\b|\bTFR\b|\bUAS\b/ },
  { label: 'OBST', pattern: /\bOBST\b|\bCRANE\b|\bTOWER\b/ },
  { label: 'SVC', pattern: /^SVC\b|\bSVC\b/ },
];

/** Strip the "!JFK 10/045 JFK " header and trailing validity stamps. */
export function cleanNotamText(text: string): string {
  return text
    .replace(/^!\S+\s+\S+\/\S+\s+\S+\s+/, '')
    .replace(/\s+\d{10}(?:-\d{10}(?:EST)?|-PERM)?\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function notamCategory(text: string, classification?: string): NotamCategory {
  const body = cleanNotamText(text).toUpperCase();
  const index = NOTAM_CATEGORIES.findIndex((c) => c.pattern.test(body));
  if (index >= 0) return { label: NOTAM_CATEGORIES[index].label, rank: index };
  const fallback = (classification || 'NOTAM').toUpperCase();
  return {
    label: fallback === 'UNKNOWN' ? 'NOTAM' : fallback.slice(0, 8),
    rank: NOTAM_CATEGORIES.length,
  };
}

/* -------------------------------------------------------------- Errors */

/** Turn a useFetch error ("HTTP 404: Not Found") into a short tile hint. */
export function fetchErrorHint(error: string | null, notFound: string): string {
  if (error && /HTTP 404/.test(error)) return notFound;
  return 'Retrying automatically';
}
