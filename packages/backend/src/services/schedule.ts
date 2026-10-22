/**
 * Flight schedule service: airline XLSX schedules (uploaded through
 * POST /api/schedule/upload). Calendar accounts live in src/calendar/; GET /api/schedule
 * merges both into the ScheduleEvent shape.
 */

import { FlightEvent, parseFlightSchedule, ColumnMapping, ScheduleParseError } from './schedule-parser.js';
import type { ScheduleEvent, TimeWindow } from '../calendar/types.js';
import { compareScheduleEvents } from '../calendar/service.js';
import { startOfToday } from '../calendar/time.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` query (1..30, default 7) → [start of today in the mirror timezone, now + days]. */
export function scheduleWindow(daysParam: unknown, timezone: string, now = Date.now()): TimeWindow {
  const raw = Array.isArray(daysParam) ? daysParam[0] : daysParam;
  const n = Number.parseInt(String(raw ?? ''), 10);
  const days = Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : 7;
  return { start: startOfToday(timezone, now), end: now + days * DAY_MS };
}

/** XLSX flight duty → the shared ScheduleEvent shape. */
export function flightToScheduleEvent(f: FlightEvent): ScheduleEvent {
  const event: ScheduleEvent = {
    id: `xlsx:${f.id}`,
    source: 'xlsx',
    accountId: null,
    calendarId: null,
    calendarName: null,
    color: null,
    title: f.title,
    location: null,
    startTime: f.startTime.toISOString(),
    endTime: f.endTime.toISOString(),
    allDay: false,
    startDate: null,
    endDate: null,
    isFlightDuty: true,
  };
  if (f.flightNumber) event.flightNumber = f.flightNumber;
  if (f.departure) event.departure = f.departure;
  if (f.arrival) event.arrival = f.arrival;
  if (f.aircraftType) event.aircraftType = f.aircraftType;
  if (f.dutyType) event.dutyType = f.dutyType;
  if (f.reportTime) event.reportTime = f.reportTime.toISOString();
  if (f.releaseTime) event.releaseTime = f.releaseTime.toISOString();
  return event;
}

/** Merge calendar and flight events into one list sorted by start (all-day first on ties). */
export function mergeScheduleEvents(...lists: ScheduleEvent[][]): ScheduleEvent[] {
  return lists.flat().sort(compareScheduleEvents);
}

export interface ScheduleConfig {
  columnMapping: Partial<ColumnMapping>;
}

export class ScheduleService {
  private flightEvents: FlightEvent[] = [];
  private config: ScheduleConfig;
  /** Called whenever the flight schedule is replaced (XLSX upload). */
  onChange: (() => void) | null = null;

  constructor(config: ScheduleConfig) {
    this.config = config;
  }

  /**
   * Replace the schedule with one from an XLSX buffer. Throws ScheduleParseError
   * (and keeps the current schedule) if the file is unreadable or has no flights.
   */
  async loadScheduleFromBuffer(buffer: Buffer, mapping?: Partial<ColumnMapping>): Promise<FlightEvent[]> {
    const events = await parseFlightSchedule(buffer, mapping || this.config.columnMapping);
    if (events.length === 0) throw new ScheduleParseError('No flights found in the file');
    this.flightEvents = events;
    this.onChange?.();
    return events;
  }

  /** Flight duties overlapping `window` (epoch ms), as ScheduleEvents. */
  getFlightsInWindow(window: TimeWindow): ScheduleEvent[] {
    return this.flightEvents
      .filter((f) => {
        const start = f.startTime.getTime();
        const end = Math.max(start, f.endTime.getTime());
        return end === start ? start >= window.start && start < window.end : start < window.end && end > window.start;
      })
      .map(flightToScheduleEvent)
      .sort(compareScheduleEvents);
  }

  /**
   * Get flight events only
   */
  getFlightEvents(): FlightEvent[] {
    return this.flightEvents;
  }

  /**
   * Get the next flight
   */
  getNextFlight(): FlightEvent | null {
    const now = new Date();
    const upcoming = this.flightEvents
      .filter((event) => event.startTime >= now)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    return upcoming[0] || null;
  }
}

// Create and export singleton
let scheduleService: ScheduleService | null = null;

export function initScheduleService(): ScheduleService {
  scheduleService = new ScheduleService({ columnMapping: {} });
  return scheduleService;
}

export function getScheduleService(): ScheduleService | null {
  return scheduleService;
}
