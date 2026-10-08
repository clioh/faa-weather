/**
 * Unified Schedule Service
 * Combines Google Calendar events and XLSX flight schedules
 */

import { googleCalendar, CalendarEvent } from './calendar.js';
import { FlightEvent, parseFlightSchedule, ColumnMapping } from './schedule-parser.js';
import { EmailPoller, createEmailPoller } from './email-poller.js';
import { loadConfig } from '../config/index.js';

export type ScheduleEvent = (CalendarEvent | FlightEvent) & {
  isFlightDuty?: boolean;
};

export interface ScheduleConfig {
  googleCalendarIds: string[];
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
    return events;
  }

  /**
   * Get all events from all sources
   */
  async getAllEvents(daysAhead: number = 7): Promise<ScheduleEvent[]> {
    const allEvents: ScheduleEvent[] = [];

    // Get Google Calendar events
    if (googleCalendar.isAvailable() && this.config.googleCalendarIds.length > 0) {
      try {
        const calendarEvents = await googleCalendar.getUpcomingEvents(
          this.config.googleCalendarIds,
          daysAhead
        );
        allEvents.push(...calendarEvents);
      } catch (error) {
        console.error('Failed to fetch Google Calendar events:', error);
      }
    }

    // Add flight events
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const relevantFlights = this.flightEvents.filter(
      (event) => event.startTime >= now && event.startTime <= future
    );

    // Mark flight events
    const markedFlights: ScheduleEvent[] = relevantFlights.map((event) => ({
      ...event,
      isFlightDuty: true,
    }));

    allEvents.push(...markedFlights);

    // Sort by start time
    allEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    return allEvents;
  }

  /**
   * Get today's events
   */
  async getTodaysEvents(): Promise<ScheduleEvent[]> {
    const allEvents = await this.getAllEvents(1);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return allEvents.filter(
      (event) => event.startTime >= startOfDay && event.startTime < endOfDay
    );
  }

  /**
   * Get flight events only
   */
  getFlightEvents(): FlightEvent[] {
    return this.flightEvents;
  }

  /**
   * Get upcoming flights (next 7 days)
   */
  getUpcomingFlights(daysAhead: number = 7): FlightEvent[] {
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    return this.flightEvents.filter(
      (event) => event.startTime >= now && event.startTime <= future
    );
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

  /**
   * Check if Google Calendar is connected
   */
  isGoogleCalendarConnected(): boolean {
    return googleCalendar.isAvailable();
  }
}

// Create and export singleton
let scheduleService: ScheduleService | null = null;

export function initScheduleService(): ScheduleService {
  const config = loadConfig();

  const scheduleConfig: ScheduleConfig = {
    googleCalendarIds: config.calendar?.google?.enabled
      ? config.calendar.google.calendar_ids || ['primary']
      : [],
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
