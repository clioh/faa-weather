/**
 * TAF Parser
 * Parses raw TAF strings into structured data
 *
 * Example TAF:
 * KJFK 151730Z 1518/1624 31010KT P6SM FEW040 SCT250
 *   FM152200 33012G20KT P6SM SCT040 BKN100
 *   TEMPO 1520/1524 4SM -RA BR BKN030
 *   FM160000 36008KT P6SM FEW080
 */

import { calculateFlightRules } from './aviation.js';
import type { FlightRules } from '../types/index.js';

export interface TafPeriod {
  type: 'BASE' | 'FM' | 'TEMPO' | 'BECMG' | 'PROB';
  probability?: number; // For PROB periods (30 or 40)
  startTime: string; // DDHHmm format
  endTime: string; // DDHHmm format
  wind: {
    direction: number | null;
    speed: number;
    gust: number | null;
  } | null;
  visibility: number | null; // statute miles
  weather: string[];
  clouds: Array<{
    coverage: string;
    altitude: number | null;
  }>;
  ceiling: number | null;
  flightRules: FlightRules;
  raw: string;
}

export interface ParsedTaf {
  icao: string;
  issueTime: string; // DDHHMMz
  validFrom: string; // DDHH
  validTo: string; // DDHH
  periods: TafPeriod[];
}

/**
 * Parse wind from TAF
 */
function parseWind(text: string): TafPeriod['wind'] {
  const match = text.match(/(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT/);
  if (!match) return null;

  return {
    direction: match[1] === 'VRB' ? null : parseInt(match[1], 10),
    speed: parseInt(match[2], 10),
    gust: match[4] ? parseInt(match[4], 10) : null,
  };
}

/**
 * Parse visibility from TAF (statute miles).
 *
 * Handles the US forms:
 *   - whole miles:          "3SM", "10SM"
 *   - fractions:            "1/2SM", "3/4SM"
 *   - mixed numbers:        "1 1/2SM", "2 1/4SM" (whole part is a separate token)
 *   - greater than 6 miles: "P6SM" -> 10
 *   - less than:            "M1/4SM" -> 0.25 (reported as the bound itself)
 *
 * Works on whitespace-separated tokens so the fraction in "1 1/2SM" is never
 * read on its own. (metar-parser.ts has a similar but non-exported helper, so
 * it cannot be reused here.)
 */
export function parseVisibility(text: string): number | null {
  const tokens = text.trim().split(/\s+/);

  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/^([PM])?(\d{1,2})(?:\/(\d{1,2}))?SM$/);
    if (!m) continue;

    const prefix = m[1];
    const first = parseInt(m[2], 10);
    const denom = m[3] ? parseInt(m[3], 10) : null;

    if (prefix === 'P') return 10; // P6SM: greater than 6 SM

    let visibility: number;
    if (denom !== null) {
      if (denom === 0) return null;
      visibility = first / denom;
      // Mixed number: preceding token is the whole-mile part ("1 1/2SM")
      const prev = i > 0 ? tokens[i - 1] : '';
      if (!prefix && /^\d$/.test(prev)) {
        visibility += parseInt(prev, 10);
      }
    } else {
      visibility = first;
    }

    return visibility;
  }

  return null;
}

/**
 * Parse weather phenomena from TAF
 */
function parseWeather(text: string): string[] {
  const weather: string[] = [];
  const weatherPattern =
    /([+-]|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+/g;

  let match;
  while ((match = weatherPattern.exec(text)) !== null) {
    weather.push(match[0]);
  }

  return weather;
}

/**
 * Parse cloud layers from TAF
 */
function parseClouds(text: string): {
  clouds: TafPeriod['clouds'];
  ceiling: number | null;
} {
  const clouds: TafPeriod['clouds'] = [];
  let ceiling: number | null = null;

  const cloudPattern = /(SKC|CLR|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?/g;

  let match;
  while ((match = cloudPattern.exec(text)) !== null) {
    const coverage = match[1];
    const altitude = match[2] ? parseInt(match[2], 10) * 100 : null;

    clouds.push({ coverage, altitude });

    // Ceiling is lowest BKN, OVC, or VV
    if (
      (coverage === 'BKN' || coverage === 'OVC' || coverage === 'VV') &&
      altitude !== null &&
      (ceiling === null || altitude < ceiling)
    ) {
      ceiling = altitude;
    }
  }

  return { clouds, ceiling };
}

/**
 * Parse a single TAF period
 */
function parsePeriod(
  text: string,
  type: TafPeriod['type'],
  startTime: string,
  endTime: string,
  probability?: number
): TafPeriod {
  const wind = parseWind(text);
  const visibility = parseVisibility(text);
  const weather = parseWeather(text);
  const { clouds, ceiling } = parseClouds(text);
  const flightRules = calculateFlightRules(ceiling, visibility);

  return {
    type,
    probability,
    startTime,
    endTime,
    wind,
    visibility,
    weather,
    clouds,
    ceiling,
    flightRules,
    raw: text.trim(),
  };
}

/**
 * Main TAF parser
 */
export function parseTaf(raw: string): ParsedTaf {
  // Normalize whitespace. aviationweather.gov's raw format prefixes the report
  // type ("TAF KSFO ...", "TAF AMD KSFO ...", "TAF COR KSFO ..."); drop it so
  // the header regex below sees the station ID first.
  const normalized = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^TAF\s+(?:(?:AMD|COR)\s+)?/, '');

  // Extract header: ICAO DDHHMM Z DDHH/DDHH
  const headerMatch = normalized.match(/^(\w{4})\s+(\d{6})Z\s+(\d{4})\/(\d{4})\s+(.+)$/);

  if (!headerMatch) {
    // Try alternate format without space after Z
    const altMatch = normalized.match(/^(\w{4})\s+(\d{6})Z\s*(\d{4})\/(\d{4})\s+(.+)$/);
    if (!altMatch) {
      return {
        icao: '',
        issueTime: '',
        validFrom: '',
        validTo: '',
        periods: [],
      };
    }
  }

  const match = headerMatch || normalized.match(/^(\w{4})\s+(\d{6})Z\s*(\d{4})\/(\d{4})\s+(.+)$/)!;

  const icao = match[1];
  const issueTime = match[2];
  const validFrom = match[3];
  const validTo = match[4];
  const body = match[5];

  const periods: TafPeriod[] = [];

  // Split body into period sections
  // FM, TEMPO, BECMG, PROB are period markers
  const periodPattern =
    /(FM\d{6}|TEMPO\s+\d{4}\/\d{4}|BECMG\s+\d{4}\/\d{4}|PROB\d{2}\s+(?:TEMPO\s+)?\d{4}\/\d{4})/g;

  const periodStarts: Array<{ index: number; marker: string }> = [];
  let periodMatch;

  while ((periodMatch = periodPattern.exec(body)) !== null) {
    periodStarts.push({ index: periodMatch.index, marker: periodMatch[1] });
  }

  // Parse base period (before first FM/TEMPO/etc)
  const firstMarkerIndex = periodStarts.length > 0 ? periodStarts[0].index : body.length;
  const basePeriodText = body.slice(0, firstMarkerIndex).trim();

  if (basePeriodText) {
    periods.push(parsePeriod(basePeriodText, 'BASE', validFrom, validTo));
  }

  // Parse each subsequent period
  for (let i = 0; i < periodStarts.length; i++) {
    const start = periodStarts[i];
    const endIndex = i + 1 < periodStarts.length ? periodStarts[i + 1].index : body.length;
    const periodText = body.slice(start.index, endIndex).trim();

    if (start.marker.startsWith('FM')) {
      // FM period: FM152200
      const fmMatch = start.marker.match(/FM(\d{2})(\d{2})(\d{2})/);
      if (fmMatch) {
        const startTime = `${fmMatch[1]}${fmMatch[2]}${fmMatch[3]}`;
        // End time is either next FM or TAF end
        let endTime = validTo + '00';
        if (i + 1 < periodStarts.length) {
          const nextMarker = periodStarts[i + 1].marker;
          const nextFm = nextMarker.match(/FM(\d{6})/);
          if (nextFm) endTime = nextFm[1];
        }
        periods.push(parsePeriod(periodText, 'FM', startTime, endTime));
      }
    } else if (start.marker.startsWith('TEMPO')) {
      // TEMPO period: TEMPO 1520/1524
      const tempoMatch = periodText.match(/TEMPO\s+(\d{4})\/(\d{4})/);
      if (tempoMatch) {
        periods.push(parsePeriod(periodText, 'TEMPO', tempoMatch[1] + '00', tempoMatch[2] + '00'));
      }
    } else if (start.marker.startsWith('BECMG')) {
      // BECMG period: BECMG 1520/1522
      const becmgMatch = periodText.match(/BECMG\s+(\d{4})\/(\d{4})/);
      if (becmgMatch) {
        periods.push(parsePeriod(periodText, 'BECMG', becmgMatch[1] + '00', becmgMatch[2] + '00'));
      }
    } else if (start.marker.startsWith('PROB')) {
      // PROB period: PROB30 1520/1524 or PROB40 TEMPO 1520/1524
      const probMatch = periodText.match(/PROB(\d{2})\s+(?:TEMPO\s+)?(\d{4})\/(\d{4})/);
      if (probMatch) {
        const probability = parseInt(probMatch[1], 10);
        periods.push(
          parsePeriod(periodText, 'PROB', probMatch[2] + '00', probMatch[3] + '00', probability)
        );
      }
    }
  }

  return {
    icao,
    issueTime,
    validFrom,
    validTo,
    periods,
  };
}

/**
 * Format a TAF period for display
 */
export function formatPeriodTime(time: string): string {
  // Time is in DDHHmm or DDHH format
  if (time.length === 6) {
    const day = time.slice(0, 2);
    const hour = time.slice(2, 4);
    const min = time.slice(4, 6);
    return `Day ${day} ${hour}:${min}Z`;
  } else if (time.length === 4) {
    const day = time.slice(0, 2);
    const hour = time.slice(2, 4);
    return `Day ${day} ${hour}:00Z`;
  }
  return time;
}

/**
 * Convert a Date to TAF time format for comparison
 */
function dateToTafTime(date: Date): number {
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const min = date.getUTCMinutes();
  return day * 10000 + hour * 100 + min;
}

/**
 * Parse TAF time string to comparable number
 */
function parseTafTime(time: string): number {
  const day = parseInt(time.slice(0, 2), 10);
  const hour = parseInt(time.slice(2, 4), 10);
  const min = parseInt(time.slice(4, 6) || '0', 10);
  return day * 10000 + hour * 100 + min;
}

/**
 * Get the current/next applicable TAF period
 */
export function getCurrentPeriod(taf: ParsedTaf): TafPeriod | null {
  return getPeriodForTime(taf, new Date());
}

/**
 * Get the TAF period applicable for a specific time
 * Useful for showing forecast conditions during scheduled flight times
 */
export function getPeriodForTime(taf: ParsedTaf, time: Date): TafPeriod | null {
  if (taf.periods.length === 0) return null;

  const targetTime = dateToTafTime(time);

  // Find the most applicable period
  // Start with base period, then overlay FM periods
  let applicablePeriod = taf.periods[0];

  for (const period of taf.periods) {
    if (period.type === 'FM' || period.type === 'BASE') {
      const periodStart = parseTafTime(period.startTime);

      if (periodStart <= targetTime) {
        applicablePeriod = period;
      }
    }
  }

  // Also check for TEMPO/PROB periods that might be in effect
  const tempoProb: TafPeriod[] = [];
  for (const period of taf.periods) {
    if (period.type === 'TEMPO' || period.type === 'PROB') {
      const periodStart = parseTafTime(period.startTime);
      const periodEnd = parseTafTime(period.endTime);

      if (targetTime >= periodStart && targetTime <= periodEnd) {
        tempoProb.push(period);
      }
    }
  }

  return applicablePeriod;
}

/**
 * Get all periods that may affect a time range (for flight planning)
 * Returns the base forecast plus any TEMPO/PROB periods
 */
export function getPeriodsForTimeRange(
  taf: ParsedTaf,
  startTime: Date,
  endTime: Date
): {
  base: TafPeriod | null;
  tempo: TafPeriod[];
  prob: TafPeriod[];
} {
  const startTafTime = dateToTafTime(startTime);
  const endTafTime = dateToTafTime(endTime);

  // Find base period at start of range
  let basePeriod: TafPeriod | null = null;
  const allFmPeriods: TafPeriod[] = [];

  for (const period of taf.periods) {
    if (period.type === 'FM' || period.type === 'BASE') {
      const periodStart = parseTafTime(period.startTime);
      if (periodStart <= startTafTime) {
        basePeriod = period;
      }
      // Also collect FM periods that START during our range
      if (periodStart >= startTafTime && periodStart <= endTafTime) {
        allFmPeriods.push(period);
      }
    }
  }

  // Find TEMPO and PROB periods that overlap with our range
  const tempo: TafPeriod[] = [];
  const prob: TafPeriod[] = [];

  for (const period of taf.periods) {
    const periodStart = parseTafTime(period.startTime);
    const periodEnd = parseTafTime(period.endTime);

    // Check for overlap
    const overlaps = periodStart <= endTafTime && periodEnd >= startTafTime;

    if (overlaps) {
      if (period.type === 'TEMPO') {
        tempo.push(period);
      } else if (period.type === 'PROB') {
        prob.push(period);
      }
    }
  }

  return { base: basePeriod, tempo, prob };
}
