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
  // Normalize whitespace but preserve structure
  const normalized = raw.trim().replace(/\s+/g, ' ');

  // Extract header: ICAO DDHHMM Z DDHH/DDHH
  const headerMatch = normalized.match(
    /^(\w{4})\s+(\d{6})Z\s+(\d{4})\/(\d{4})\s+(.+)$/
  );

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
  const periodPattern = /(FM\d{6}|TEMPO\s+\d{4}\/\d{4}|BECMG\s+\d{4}\/\d{4}|PROB\d{2}\s+(?:TEMPO\s+)?\d{4}\/\d{4})/g;

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
        periods.push(
          parsePeriod(periodText, 'TEMPO', tempoMatch[1] + '00', tempoMatch[2] + '00')
        );
      }
    } else if (start.marker.startsWith('BECMG')) {
      // BECMG period: BECMG 1520/1522
      const becmgMatch = periodText.match(/BECMG\s+(\d{4})\/(\d{4})/);
      if (becmgMatch) {
        periods.push(
          parsePeriod(periodText, 'BECMG', becmgMatch[1] + '00', becmgMatch[2] + '00')
        );
      }
    } else if (start.marker.startsWith('PROB')) {
      // PROB period: PROB30 1520/1524 or PROB40 TEMPO 1520/1524
      const probMatch = periodText.match(/PROB(\d{2})\s+(?:TEMPO\s+)?(\d{4})\/(\d{4})/);
      if (probMatch) {
        const probability = parseInt(probMatch[1], 10);
        periods.push(
          parsePeriod(
            periodText,
            'PROB',
            probMatch[2] + '00',
            probMatch[3] + '00',
            probability
          )
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

/**
 * Convert a local time to UTC for TAF comparison
 * @param localTime - Date object representing local time
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns Date object in UTC
 */
export function localToUtc(localTime: Date, _timezone: string): Date {
  // The input Date is already correct - it just needs to be interpreted
  // as UTC for TAF comparison
  return localTime;
}

/**
 * Offset (ms) of `timeZone` from UTC at the given instant: wall-clock - UTC.
 * Independent of the host timezone.
 */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  // Drop sub-second precision from the instant so it lines up with wallAsUtc
  const instantSec = Math.floor(instant.getTime() / 1000) * 1000;
  return wallAsUtc - instantSec;
}

/**
 * Calendar date (Y/M/D) that `flightDate` refers to.
 * - A date-only value such as `new Date('2024-01-15')` is parsed by JS as UTC
 *   midnight, so its UTC calendar fields are the intended date.
 * - Any other instant (e.g. `new Date()`) is interpreted as the calendar day
 *   it falls on in the target timezone.
 * The host timezone is never consulted.
 */
function getFlightCalendarDate(
  flightDate: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const isUtcMidnight =
    flightDate.getUTCHours() === 0 &&
    flightDate.getUTCMinutes() === 0 &&
    flightDate.getUTCSeconds() === 0 &&
    flightDate.getUTCMilliseconds() === 0;

  if (isUtcMidnight) {
    return {
      year: flightDate.getUTCFullYear(),
      month: flightDate.getUTCMonth(),
      day: flightDate.getUTCDate(),
    };
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(flightDate);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

/**
 * Parse a local time string (HH:MM, HHMM, or h:mm AM/PM) on a flight date in
 * the given IANA timezone and return the corresponding UTC instant for TAF
 * comparison. The result does not depend on the server's timezone.
 */
export function parseLocalFlightTime(
  timeStr: string,
  flightDate: Date,
  timezone: string
): Date {
  const input = timeStr.trim();
  let hours: number;
  let minutes: number;

  // Try HH:MM (optionally :SS) format
  const colonMatch = input.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (colonMatch) {
    hours = parseInt(colonMatch[1], 10);
    minutes = parseInt(colonMatch[2], 10);
  } else {
    // Try HHMM format
    const hmMatch = input.match(/^(\d{2})(\d{2})$/);
    if (hmMatch) {
      hours = parseInt(hmMatch[1], 10);
      minutes = parseInt(hmMatch[2], 10);
    } else {
      // Try 12-hour format
      const ampmMatch = input.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/i);
      if (!ampmMatch) {
        throw new Error(`Cannot parse time: ${timeStr}`);
      }
      hours = parseInt(ampmMatch[1], 10);
      minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
      if (hours < 1 || hours > 12) {
        throw new Error(`Cannot parse time: ${timeStr}`);
      }
      if (ampmMatch[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (ampmMatch[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    }
  }

  if (hours > 23 || minutes > 59) {
    throw new Error(`Cannot parse time: ${timeStr}`);
  }
  if (isNaN(flightDate.getTime())) {
    throw new Error('Invalid flight date');
  }

  const { year, month, day } = getFlightCalendarDate(flightDate, timezone);

  // Treat the wall-clock time as if it were UTC, then shift by the zone's
  // offset. Re-check the offset at the candidate instant to handle DST edges.
  const wallAsUtc = Date.UTC(year, month, day, hours, minutes, 0, 0);
  let utcMs = wallAsUtc - getTimeZoneOffsetMs(new Date(wallAsUtc), timezone);
  const offsetAtResult = getTimeZoneOffsetMs(new Date(utcMs), timezone);
  utcMs = wallAsUtc - offsetAtResult;

  return new Date(utcMs);
}

/**
 * Get a summary of conditions for a flight time
 * @param taf - Parsed TAF data
 * @param departureTime - Departure time in UTC (use parseLocalFlightTime to convert)
 */
export function getFlightTimeForecast(
  taf: ParsedTaf,
  departureTime: Date
): {
  period: TafPeriod | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const forecast = getPeriodsForTimeRange(
    taf,
    departureTime,
    new Date(departureTime.getTime() + 2 * 60 * 60 * 1000) // 2 hour window
  );

  // Check for IFR/LIFR in any applicable period
  if (forecast.base?.flightRules === 'IFR' || forecast.base?.flightRules === 'LIFR') {
    warnings.push(`Base forecast: ${forecast.base.flightRules}`);
  }

  for (const tempo of forecast.tempo) {
    if (tempo.flightRules === 'IFR' || tempo.flightRules === 'LIFR') {
      warnings.push(`TEMPO: ${tempo.flightRules} possible`);
    }
  }

  for (const prob of forecast.prob) {
    if (prob.flightRules === 'IFR' || prob.flightRules === 'LIFR') {
      warnings.push(`PROB${prob.probability}: ${prob.flightRules}`);
    }
  }

  // Check for thunderstorms
  const allPeriods = [forecast.base, ...forecast.tempo, ...forecast.prob].filter(Boolean) as TafPeriod[];
  for (const period of allPeriods) {
    if (period.weather.some((w) => w.includes('TS'))) {
      warnings.push(`${period.type}: Thunderstorms forecast`);
    }
  }

  return {
    period: forecast.base,
    warnings,
  };
}
