/**
 * Schedule — upcoming events from the calendars connected in the phone app
 * (Google, Outlook, iCloud, CalDAV, calendar links) plus imported crew
 * schedules, grouped by day. Calendar events carry their calendar's colour;
 * flight duties show flight number, route and report time.
 */

import { useMemo } from 'react';
import { ModuleProps } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { useWsEvent } from './useWsEvent';
import { dayKey, daysBetween, pickTimeZone, useNow } from './time';
import {
  addDays,
  calendarColor,
  keyToUtcNoon,
  placeEvents,
  PlacedEvent,
  ScheduleEvent,
} from './scheduleDays';
import './CalendarModule.css';

interface ScheduleAccount {
  id: string;
  label?: string;
  provider?: string;
  status?: 'ok' | 'error' | 'reauth';
}

interface ScheduleResponse {
  count?: number;
  events?: ScheduleEvent[];
  flights?: ScheduleEvent[];
  accounts?: ScheduleAccount[];
  updatedAt?: string;
}

/** Rows that fit without clipping, per size (an event can take two lines). */
const ROW_CAP: Record<string, number> = { medium: 3, tall: 6, large: 7, wide: 6, full: 8 };

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  microsoft: 'Outlook',
  icloud: 'iCloud',
  caldav: 'CalDAV',
  ics: 'Calendar link',
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

interface DayGroup {
  key: string;
  label: string;
  rows: PlacedEvent[];
}

/** "Google needs reconnecting in the app" / "Google and Work need …". */
function reauthNotice(accounts: ScheduleAccount[] | undefined): string | null {
  if (!Array.isArray(accounts)) return null;
  const names = [
    ...new Set(
      accounts
        .filter((a) => a?.status === 'reauth')
        .map((a) => a.label?.trim() || PROVIDER_NAMES[a.provider ?? ''] || 'A calendar')
    ),
  ];
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} needs reconnecting in the app`;
  if (names.length === 2) return `${names[0]} and ${names[1]} need reconnecting in the app`;
  return `${names.length} calendars need reconnecting in the app`;
}

export function CalendarModule({ config, size, timezone }: ModuleProps) {
  const flightsOnly = config.mode === 'flights';
  const showLocation = config.showLocation !== false && size !== 'medium';
  const daysAhead = clampNumber(config.daysAhead, 7, 1, 30);
  const maxEvents = Math.min(clampNumber(config.maxEvents, 8, 1, 20), ROW_CAP[size] ?? 6);
  const tz = pickTimeZone(timezone);

  const url = flightsOnly
    ? `/api/schedule/flights?days=${daysAhead}`
    : `/api/schedule?days=${daysAhead}`;
  const { data, loading, error, isStale, lastUpdated, refresh } =
    useModuleData<ScheduleResponse>(url, { refreshMs: 5 * 60_000 });

  // The backend broadcasts `calendar` when accounts change or a sync lands.
  useWsEvent('calendar', () => {
    void refresh();
  });

  // Minute ticks drop finished events and roll "Tomorrow" over at midnight.
  const now = useNow(60_000);

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }),
    [tz]
  );
  // Day keys are floating dates: label them in UTC from noon UTC.
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short' }),
    []
  );
  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }),
    []
  );

  const todayKey = dayKey(now, tz);
  const allEvents = useMemo(() => {
    const list = data?.events ?? data?.flights;
    return Array.isArray(list) ? list : [];
  }, [data]);

  const groups = useMemo<DayGroup[]>(() => {
    const placed = placeEvents(allEvents, now, tz).slice(0, maxEvents);
    const byDay = new Map<string, PlacedEvent[]>();
    for (const row of placed) {
      const list = byDay.get(row.day) ?? [];
      list.push(row);
      byDay.set(row.day, list);
    }
    return [...byDay.entries()].map(([key, rows]) => {
      const offset = daysBetween(todayKey, key);
      let label: string;
      if (offset === 0) label = 'Today';
      else if (offset === 1) label = 'Tomorrow';
      else {
        const [, , d] = key.split('-').map(Number);
        label = `${weekdayFormatter.format(keyToUtcNoon(key))} ${d}`;
      }
      return { key, label, rows };
    });
  }, [allEvents, now, tz, todayKey, maxEvents, weekdayFormatter]);

  const formatTime = (iso: string | null | undefined) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? timeFormatter.format(t) : null;
  };

  /** "through Thu" for an all-day event that runs past the day it's filed under. */
  const throughLabel = (row: PlacedEvent): string | null => {
    if (!row.lastDay || row.lastDay <= row.day) return null;
    const offset = daysBetween(todayKey, row.lastDay);
    if (offset === 1) return 'through tomorrow';
    // A bare weekday is ambiguous a week or more out.
    const date = keyToUtcNoon(row.lastDay);
    return `through ${offset < 7 ? weekdayFormatter.format(date) : shortDateFormatter.format(date)}`;
  };

  const accounts = flightsOnly ? undefined : data?.accounts;
  const notConnected =
    Array.isArray(accounts) && accounts.length === 0 && !allEvents.some((e) => e?.isFlightDuty);
  const reauth = reauthNotice(accounts);

  const title = flightsOnly ? 'Flights' : 'Schedule';
  const meta = <Age at={lastUpdated} stale={isStale} />;

  let body;
  if (loading) {
    body = <ModuleLoading />;
  } else if (!data && error) {
    body = <ModuleError title="Schedule unavailable" hint="Will retry shortly" />;
  } else if (notConnected) {
    body = (
      <ModuleEmpty
        title="No calendars connected"
        hint="Add one in the SkyGlass app under Calendars"
      />
    );
  } else if (groups.length === 0) {
    const through = addDays(todayKey, daysAhead - 1);
    body = (
      <ModuleEmpty
        title={flightsOnly ? 'No flights scheduled' : 'Nothing scheduled'}
        hint={`through ${shortDateFormatter.format(keyToUtcNoon(through))}`}
      />
    );
  } else {
    const wide = size === 'wide';
    // Wide is two rows tall: show days side by side, two events each.
    const shown = wide
      ? groups.slice(0, 3).map((g) => ({ ...g, rows: g.rows.slice(0, 2) }))
      : groups;
    body = (
      <div className={`cal-days${wide ? ' cal-days-row' : ''}`}>
        {shown.map((group) => (
          <section key={group.key} className="cal-day">
            <div className={`cal-day-label${group.label === 'Today' ? ' today' : ''}`}>
              {group.label}
            </div>
            {group.rows.map((row) => {
              const event = row.event;
              const isFlight = Boolean(event.isFlightDuty && (event.flightNumber || event.departure));
              const report = isFlight ? formatTime(event.reportTime) : null;
              const color = isFlight ? null : calendarColor(event.color);
              const through = throughLabel(row);
              const location =
                showLocation && !isFlight && typeof event.location === 'string'
                  ? event.location.trim()
                  : '';
              const sub = isFlight
                ? report && `Report ${report}`
                : [through, location].filter(Boolean).join(' · ');
              return (
                <div
                  key={`${event.id}-${event.startTime}`}
                  className={`cal-event${isFlight ? ' flight' : ''}`}
                >
                  <span
                    className={`cal-mark${color ? ' colored' : ''}`}
                    style={color ? { backgroundColor: color } : undefined}
                    title={event.calendarName ?? undefined}
                    aria-hidden="true"
                  />
                  <span className="cal-time">
                    {event.allDay ? 'All day' : formatTime(event.startTime)}
                  </span>
                  <span className="cal-detail">
                    {isFlight ? (
                      <span className="cal-title">
                        {event.flightNumber && <span className="cal-flight">{event.flightNumber}</span>}
                        {event.departure && event.arrival && (
                          <span className="cal-route">
                            {event.departure} → {event.arrival}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="cal-title cal-title-text">{event.title || 'Busy'}</span>
                    )}
                    {sub && <span className="cal-sub">{sub}</span>}
                  </span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  const footer = reauth && !loading ? <span className="cal-notice">{reauth}</span> : undefined;

  return (
    <ModuleFrame title={title} meta={meta} className="cal" footer={footer}>
      {body}
    </ModuleFrame>
  );
}
