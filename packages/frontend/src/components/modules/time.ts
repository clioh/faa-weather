/**
 * Time helpers shared by the clock, schedule, countdown and news widgets.
 * Everything is Intl-based so a widget can show any IANA zone regardless of
 * the zone the kiosk browser runs in.
 */

import { useEffect, useState } from 'react';

/** The zone if the browser knows it, else undefined (→ browser local). */
export function validTimeZone(tz: unknown): string | undefined {
  if (typeof tz !== 'string' || !tz.trim()) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return undefined;
  }
}

/** First valid zone of the candidates (widget setting, then mirror default). */
export function pickTimeZone(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const tz = validTimeZone(c);
    if (tz) return tz;
  }
  return undefined;
}

/** "America/Los_Angeles" → "Los Angeles". */
export function cityFromZone(tz: string): string {
  const last = tz.split('/').pop() || tz;
  return last.replace(/_/g, ' ');
}

/**
 * Current time, re-rendering on each `stepMs` boundary (1 s or 60 s), so a
 * minute clock flips exactly when the minute changes instead of drifting.
 */
export function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      // +25 ms lands safely past the boundary despite timer jitter.
      const delay = stepMs - (Date.now() % stepMs) + 25;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    setNow(new Date());
    schedule();
    return () => window.clearTimeout(timer);
  }, [stepMs]);
  return now;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number; // 0–23
  minute: number;
  second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock fields of `date` in `tz` (browser local when undefined). */
export function zonedParts(date: Date, tz?: string): ZonedParts {
  const key = tz ?? '';
  let fmt = partsFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    partsFormatters.set(key, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    // Some engines still report midnight as 24 under h23.
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

/** Minutes `tz` is ahead of UTC at `date`. */
export function zoneOffsetMinutes(date: Date, tz?: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Calendar day of `date` in `tz` as a sortable "YYYY-MM-DD" key. */
export function dayKey(date: Date, tz?: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Whole days between two day keys (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** "now" / "5m" / "3h" / "2d" since an ISO time; null when unknown. */
export function relativeAge(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.max(0, Math.round((now - t) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
