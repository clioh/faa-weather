/**
 * iCalendar parsing + recurrence expansion (ical.js) for CalDAV and ICS feeds.
 *
 * - VTIMEZONE definitions in the file are used when present (ical.js).
 * - TZIDs without a VTIMEZONE are resolved as IANA names via Intl; floating
 *   times (no TZID) are interpreted in the mirror's timezone.
 * - EXDATE and RECURRENCE-ID overrides are applied; cancelled instances dropped.
 * - All-day (DATE) events keep their floating dates in startDate/endDate.
 */

import ICAL from 'ical.js';
import { addDays, dateToInstant, formatDate, resolveTimeZone, wallClockToInstant } from './time.js';
import type { RawEvent, TimeWindow } from './types.js';

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type IcalEvent = InstanceType<typeof ICAL.Event>;

const MAX_ITERATIONS = 50_000;
const MAX_EVENTS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ParsedCalendar {
  name: string | null;
  color: string | null;
  events: RawEvent[];
}

export class IcsParseError extends Error {
  constructor(message = 'Not a valid calendar file') {
    super(message);
    this.name = 'IcsParseError';
  }
}

/** Parse ICS text into VCALENDAR components (a feed may hold several). */
export function parseCalendars(text: string): Component[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new IcsParseError();
  let jcal: unknown;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new IcsParseError();
  }
  // ICAL.parse returns one jCal array, or an array of them for multiple roots.
  const roots = Array.isArray(jcal) && Array.isArray(jcal[0]) ? (jcal as unknown[]) : [jcal];
  const comps = roots
    .map((j) => new ICAL.Component(j as unknown[]))
    .filter((c) => c.name === 'vcalendar');
  if (comps.length === 0) throw new IcsParseError();
  return comps;
}

function tzHint(comp: Component, prop: string): string | null {
  const p = comp.getFirstProperty(prop);
  const tzid = p?.getParameter('tzid');
  return typeof tzid === 'string' ? tzid : null;
}

/** Epoch ms of a DATE-TIME value. */
function instantOf(t: Time, tzidHint: string | null, fallbackTz: string): number {
  const zoneId = t.zone?.tzid;
  if (zoneId && zoneId !== 'floating') {
    return t.toUnixTime() * 1000;
  }
  const tz = resolveTimeZone(tzidHint) ?? fallbackTz;
  return wallClockToInstant(
    { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second },
    tz
  );
}

function dateOf(t: Time): string {
  return formatDate(t.year, t.month, t.day);
}

function text(comp: Component, prop: string): string | null {
  const v = comp.getFirstPropertyValue(prop);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isCancelled(comp: Component): boolean {
  return String(comp.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

function build(
  comp: Component,
  start: Time,
  end: Time | null,
  key: string,
  fallbackTz: string
): RawEvent {
  const title = text(comp, 'summary') ?? '(No title)';
  const location = text(comp, 'location');
  if (start.isDate) {
    const startDate = dateOf(start);
    let endDate = end ? dateOf(end) : addDays(startDate, 1);
    if (endDate <= startDate) endDate = addDays(startDate, 1);
    return {
      key,
      title,
      location,
      start: dateToInstant(startDate, fallbackTz),
      end: dateToInstant(endDate, fallbackTz),
      allDay: true,
      startDate,
      endDate,
    };
  }
  const s = instantOf(start, tzHint(comp, 'dtstart'), fallbackTz);
  let e = end
    ? instantOf(end, tzHint(comp, comp.hasProperty('dtend') ? 'dtend' : 'dtstart'), fallbackTz)
    : s;
  if (e < s) e = s;
  return { key, title, location, start: s, end: e, allDay: false, startDate: null, endDate: null };
}

function overlaps(ev: RawEvent, w: TimeWindow): boolean {
  if (ev.end === ev.start) return ev.start >= w.start && ev.start < w.end;
  return ev.start < w.end && ev.end > w.start;
}

function occurrenceKey(uid: string, t: Time): string {
  return `${uid}@${t.isDate ? dateOf(t) : t.toString()}`;
}

/**
 * Expand all VEVENTs of the given VCALENDAR components into occurrences
 * overlapping `window`.
 */
export function expandEvents(
  calendars: Component[],
  window: TimeWindow,
  fallbackTz: string
): RawEvent[] {
  const out: RawEvent[] = [];
  const masters = new Map<string, Component>();
  const exceptions = new Map<string, Component[]>();
  let anon = 0;

  for (const cal of calendars) {
    for (const vevent of cal.getAllSubcomponents('vevent')) {
      const uid = text(vevent, 'uid') ?? `anon-${anon++}`;
      if (vevent.hasProperty('recurrence-id')) {
        const list = exceptions.get(uid) ?? [];
        list.push(vevent);
        exceptions.set(uid, list);
      } else if (!masters.has(uid)) {
        masters.set(uid, vevent);
      }
    }
  }

  const push = (ev: RawEvent) => {
    if (out.length < MAX_EVENTS && overlaps(ev, window)) out.push(ev);
  };

  for (const [uid, comp] of masters) {
    try {
      const ev: IcalEvent = new ICAL.Event(comp);
      const related = exceptions.get(uid) ?? [];
      exceptions.delete(uid);
      if (!ev.startDate) continue;

      if (!ev.isRecurring()) {
        if (!isCancelled(comp)) push(build(comp, ev.startDate, ev.endDate, uid, fallbackTz));
        continue;
      }

      for (const ex of related) {
        try {
          ev.relateException(new ICAL.Event(ex));
        } catch {
          // mismatched override; ignore it
        }
      }
      const durationMs = Math.max(0, ev.duration ? ev.duration.toSeconds() * 1000 : 0);
      const startHint = tzHint(comp, 'dtstart');
      const it = ev.iterator();
      let count = 0;
      for (let next = it.next(); next && count < MAX_ITERATIONS; next = it.next(), count++) {
        const occStart = next.isDate
          ? dateToInstant(dateOf(next), fallbackTz)
          : instantOf(next, startHint, fallbackTz);
        if (occStart > window.end + 7 * DAY_MS) break;
        if (occStart + durationMs + 7 * DAY_MS < window.start) continue;
        const details = ev.getOccurrenceDetails(next);
        const itemComp = details.item?.component ?? comp;
        if (isCancelled(itemComp)) continue;
        push(
          build(itemComp, details.startDate, details.endDate, occurrenceKey(uid, next), fallbackTz)
        );
        if (out.length >= MAX_EVENTS) break;
      }
    } catch (error) {
      console.warn(
        '[calendar] skipping unparseable event:',
        error instanceof Error ? error.message : error
      );
    }
  }

  // Overrides whose master is missing (e.g. only the instance was shared)
  for (const [uid, list] of exceptions) {
    for (const comp of list) {
      try {
        if (isCancelled(comp)) continue;
        const ev = new ICAL.Event(comp);
        if (!ev.startDate) continue;
        const rid = ev.recurrenceId ?? ev.startDate;
        push(build(comp, ev.startDate, ev.endDate, occurrenceKey(uid, rid), fallbackTz));
      } catch {
        // ignore
      }
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Parse a full ICS document: calendar name/color + expanded events. */
export function parseIcs(textIn: string, window: TimeWindow, fallbackTz: string): ParsedCalendar {
  const calendars = parseCalendars(textIn);
  const first = calendars[0];
  return {
    name: text(first, 'x-wr-calname'),
    color: text(first, 'x-apple-calendar-color'),
    events: expandEvents(calendars, window, fallbackTz),
  };
}
