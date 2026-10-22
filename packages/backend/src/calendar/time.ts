/**
 * Timezone helpers built on Intl (no tz database dependency).
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a TZID (IANA, or a vendor-prefixed one like /mozilla.org/.../America/New_York) to an IANA zone. */
export function resolveTimeZone(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  if (isValidTimeZone(tzid)) return tzid;
  const m = tzid.match(/([A-Za-z]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/);
  if (m && isValidTimeZone(m[1])) return m[1];
  return null;
}

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock fields of `ts` in `tz`. */
export function wallClockAt(ts: number, tz: string): WallClock {
  const parts = formatter(tz).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

function offsetAt(ts: number, tz: string): number {
  const w = wallClockAt(ts, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Instant (epoch ms) at which the wall clock in `tz` shows the given fields. */
export function wallClockToInstant(w: WallClock, tz: string): number {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const o1 = offsetAt(guess - 0, tz);
  let t = guess - o1;
  const o2 = offsetAt(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}

/** 'YYYY-MM-DD' → instant of local midnight in `tz`. */
export function dateToInstant(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return wallClockToInstant({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0 }, tz);
}

/** 'YYYY-MM-DD' plus `days`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today's date ('YYYY-MM-DD') in `tz`. */
export function todayIn(tz: string, now = Date.now()): string {
  const w = wallClockAt(now, tz);
  return formatDate(w.year, w.month, w.day);
}

/** Instant of the start of today in `tz`. */
export function startOfToday(tz: string, now = Date.now()): number {
  return dateToInstant(todayIn(tz, now), tz);
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
