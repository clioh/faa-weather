/**
 * Google Calendar Service
 * Fetches events from Google Calendar
 */

import { google, calendar_v3 } from 'googleapis';
import { getGoogleAuth } from '../auth/google-oauth.js';

export interface CalendarEvent {
  id: string;
  source: 'google';
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  location?: string;
  calendarId: string;
  calendarName?: string;
}

export class GoogleCalendarService {
  private calendar: calendar_v3.Calendar | null = null;

  /**
   * Initialize the calendar API client
   */
  private getCalendarClient(): calendar_v3.Calendar | null {
    const auth = getGoogleAuth();
    if (!auth || !auth.isAuthenticated()) {
      return null;
    }

    if (!this.calendar) {
      this.calendar = google.calendar({ version: 'v3', auth: auth.getClient() });
    }
    return this.calendar;
  }

  /**
   * Check if calendar service is available
   */
  isAvailable(): boolean {
    const auth = getGoogleAuth();
    return !!(auth && auth.isAuthenticated());
  }

  /**
   * Get list of calendars the user has access to
   */
  async getCalendarList(): Promise<Array<{ id: string; name: string; primary: boolean }>> {
    const calendar = this.getCalendarClient();
    if (!calendar) return [];

    try {
      const response = await calendar.calendarList.list();
      return (response.data.items || []).map((cal) => ({
        id: cal.id || '',
        name: cal.summary || 'Unnamed Calendar',
        primary: cal.primary || false,
      }));
    } catch (error) {
      console.error('Failed to fetch calendar list:', error);
      return [];
    }
  }

  /**
   * Fetch events from a specific calendar
   */
  async getEvents(
    calendarId: string,
    options: {
      timeMin?: Date;
      timeMax?: Date;
      maxResults?: number;
    } = {}
  ): Promise<CalendarEvent[]> {
    const calendar = this.getCalendarClient();
    if (!calendar) return [];

    const {
      timeMin = new Date(),
      timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days ahead
      maxResults = 50,
    } = options;

    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];

      return events.map((event) => {
        const isAllDay = !event.start?.dateTime;
        const startTime = isAllDay
          ? new Date(event.start?.date || '')
          : new Date(event.start?.dateTime || '');
        const endTime = isAllDay
          ? new Date(event.end?.date || '')
          : new Date(event.end?.dateTime || '');

        return {
          id: event.id || '',
          source: 'google' as const,
          title: event.summary || 'Untitled Event',
          description: event.description || undefined,
          startTime,
          endTime,
          allDay: isAllDay,
          location: event.location || undefined,
          calendarId,
        };
      });
    } catch (error) {
      console.error(`Failed to fetch events from ${calendarId}:`, error);
      return [];
    }
  }

  /**
   * Fetch events from multiple calendars
   */
  async getEventsFromMultiple(
    calendarIds: string[],
    options: {
      timeMin?: Date;
      timeMax?: Date;
      maxResults?: number;
    } = {}
  ): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];

    for (const calendarId of calendarIds) {
      const events = await this.getEvents(calendarId, options);
      allEvents.push(...events);
    }

    // Sort by start time
    allEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    return allEvents;
  }

  /**
   * Get today's events
   */
  async getTodaysEvents(calendarIds: string[]): Promise<CalendarEvent[]> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return this.getEventsFromMultiple(calendarIds, {
      timeMin: startOfDay,
      timeMax: endOfDay,
    });
  }

  /**
   * Get upcoming events (next 7 days)
   */
  async getUpcomingEvents(
    calendarIds: string[],
    daysAhead: number = 7
  ): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    return this.getEventsFromMultiple(calendarIds, {
      timeMin: now,
      timeMax: future,
    });
  }
}

// Singleton instance
export const googleCalendar = new GoogleCalendarService();
