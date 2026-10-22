/**
 * Flight schedule service: airline XLSX schedules (manual upload or IMAP
 * email polling). Calendar accounts live in src/calendar/; GET /api/schedule
 * merges both into the ScheduleEvent shape.
 */

import { FlightEvent, parseFlightSchedule, ColumnMapping } from './schedule-parser.js';
import { EmailPoller, createEmailPoller } from './email-poller.js';
import { loadConfig } from '../config/index.js';
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
  emailPolling: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password: string;
    folder: string;
    senderFilter?: string;
    pollInterval: number;
  };
  columnMapping: Partial<ColumnMapping>;
}

export class ScheduleService {
  private emailPoller: EmailPoller | null = null;
  private flightEvents: FlightEvent[] = [];
  private config: ScheduleConfig;
  private pollInterval: NodeJS.Timeout | null = null;
  /** Called whenever the flight schedule is replaced (upload or email). */
  onChange: (() => void) | null = null;

  constructor(config: ScheduleConfig) {
    this.config = config;

    // Initialize email poller if enabled
    if (config.emailPolling.enabled && config.emailPolling.username) {
      this.emailPoller = createEmailPoller(
        {
          imap_host: config.emailPolling.host,
          imap_port: config.emailPolling.port,
          username: config.emailPolling.username,
          password: config.emailPolling.password,
          folder: config.emailPolling.folder,
          sender_filter: config.emailPolling.senderFilter,
        },
        config.columnMapping
      );
    }
  }

  /**
   * Start periodic email polling
   */
  startEmailPolling(): void {
    if (!this.emailPoller || this.pollInterval) return;

    const pollIntervalMs = this.config.emailPolling.pollInterval * 1000;

    console.log(`Starting email polling every ${this.config.emailPolling.pollInterval}s`);

    // Initial poll
    this.pollEmails();

    // Set up periodic polling
    this.pollInterval = setInterval(() => {
      this.pollEmails();
    }, pollIntervalMs);
  }

  /**
   * Stop email polling
   */
  stopEmailPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Poll for new schedule emails
   */
  async pollEmails(): Promise<void> {
    if (!this.emailPoller) return;

    console.log('Polling for schedule emails...');
    const result = await this.emailPoller.poll();

    if (result.success && result.newSchedule) {
      this.flightEvents = result.events;
      console.log(`Updated flight schedule: ${result.events.length} events`);
      this.onChange?.();
    } else if (!result.success) {
      console.error('Email polling failed:', result.error);
    }
  }

  /**
   * Manually load a schedule from XLSX buffer
   */
  async loadScheduleFromBuffer(buffer: Buffer, mapping?: Partial<ColumnMapping>): Promise<FlightEvent[]> {
    const events = await parseFlightSchedule(buffer, mapping || this.config.columnMapping);
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
  const config = loadConfig();

  const scheduleConfig: ScheduleConfig = {
    emailPolling: {
      enabled: config.schedule?.email?.enabled || false,
      host: config.schedule?.email?.imap_host || 'imap.gmail.com',
      port: config.schedule?.email?.imap_port || 993,
      username: config.schedule?.email?.username || '',
      password: config.schedule?.email?.password || '',
      folder: config.schedule?.email?.folder || 'INBOX',
      senderFilter: config.schedule?.email?.sender_filter,
      pollInterval: config.schedule?.email?.poll_interval || 300,
    },
    columnMapping: {},
  };

  scheduleService = new ScheduleService(scheduleConfig);

  // Start email polling if configured
  if (scheduleConfig.emailPolling.enabled) {
    scheduleService.startEmailPolling();
  }

  return scheduleService;
}

export function getScheduleService(): ScheduleService | null {
  return scheduleService;
}
