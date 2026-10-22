/**
 * Day placement for the Schedule widget, kept free of React so the rules
 * (floating all-day dates, multi-day spans, the evening roll-over) are easy
 * to reason about and test.
 *
 * All-day events carry `startDate` / `endDate` as floating 'YYYY-MM-DD'
 * dates (endDate exclusive), so they are compared as strings and never
 * converted through a timezone. Timed events use their ISO instants, read in
 * the mirror's zone.
 */

import { dayKey, zonedParts } from './time';

export interface ScheduleEvent {
  id: string;
  source?: string;
  accountId?: string | null;
  calendarId?: string | null;
  calendarName?: string | null;
  color?: string | null;
  title?: string | null;
  location?: string | null;
  startTime: string;
  endTime?: string | null;
  allDay?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  isFlightDuty?: boolean;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  aircraftType?: string;
  dutyType?: string;
  reportTime?: string;
  releaseTime?: string;
}

export interface PlacedEvent {
  event: ScheduleEvent;
  /** Day the row is filed under (today for anything already under way). */
  day: string;
  /** Last day an all-day event covers (inclusive); null for timed events. */
  lastDay: string | null;
  /** Start instant for ordering timed rows within a day. */
  startMs: number;
}

/**
 * After this hour, if nothing timed is left today, all-day entries that end
 * tonight are dropped (and ones that carry on move to tomorrow) so the list
 * leads with tomorrow — what a pilot checking the mirror before bed wants.
 */
export const EVENING_HOUR = 20;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" shifted by `n` days. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Noon UTC on a day key; format it with `timeZone: 'UTC'` to label the day. */
export function keyToUtcNoon(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** First and last (inclusive) days an all-day event covers, or null if unreadable. */
export function allDaySpan(event: ScheduleEvent, tz?: string): { first: string; last: string } | null {
  if (event.startDate && DATE_RE.test(event.startDate)) {
    const first = event.startDate;
    const end = event.endDate && DATE_RE.test(event.endDate) ? event.endDate : null;
    const last = end && end > first ? addDays(end, -1) : first;
    return { first, last };
  }
  // Fallback for sources that only sent instants.
  const start = Date.parse(event.startTime);
  if (!Number.isFinite(start)) return null;
  const first = dayKey(new Date(start), tz);
  const end = event.endTime ? Date.parse(event.endTime) : NaN;
  const lastRaw = Number.isFinite(end) && end > start ? dayKey(new Date(end - 1), tz) : first;
  return { first, last: lastRaw < first ? first : lastRaw };
}

/** File each upcoming event under a day, drop finished ones, and sort. */
export function placeEvents(events: ScheduleEvent[], now: Date, tz?: string): PlacedEvent[] {
  const todayKey = dayKey(now, tz);
  const nowMs = now.getTime();
  const placed: PlacedEvent[] = [];

  for (const event of events) {
    if (!event || typeof event.startTime !== 'string') continue;
    if (event.allDay) {
      const span = allDaySpan(event, tz);
      if (!span || span.last < todayKey) continue;
      placed.push({
        event,
        day: span.first < todayKey ? todayKey : span.first,
        lastDay: span.last,
        startMs: 0,
      });
    } else {
      const start = Date.parse(event.startTime);
      if (!Number.isFinite(start)) continue;
      const endParsed = event.endTime ? Date.parse(event.endTime) : NaN;
      const end = Number.isFinite(endParsed) ? endParsed : start;
      if (end <= nowMs && start <= nowMs) continue;
      const startKey = dayKey(new Date(start), tz);
      placed.push({
        event,
        day: startKey < todayKey ? todayKey : startKey,
        lastDay: null,
        startMs: start,
      });
    }
  }

  let visible = placed;
  const isEvening = zonedParts(now, tz).hour >= EVENING_HOUR;
  const timedLeftToday = placed.some((p) => p.lastDay === null && p.day === todayKey);
  if (isEvening && !timedLeftToday) {
    const tomorrow = addDays(todayKey, 1);
    visible = [];
    for (const p of placed) {
      if (p.lastDay !== null && p.day === todayKey) {
        if (p.lastDay === todayKey) continue;
        visible.push({ ...p, day: tomorrow });
      } else {
        visible.push(p);
      }
    }
  }

  return visible.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    const aAllDay = a.lastDay !== null;
    const bAllDay = b.lastDay !== null;
    if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return (a.event.title ?? '').localeCompare(b.event.title ?? '');
  });
}

/** A usable `#rrggbb` calendar colour, or null. */
export function calendarColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}
