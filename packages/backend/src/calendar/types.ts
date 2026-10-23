/**
 * Calendar accounts: shared types.
 *
 * `StoredAccount` is what data/calendar-accounts.json holds (including
 * secrets). `CalendarAccount` is the public shape every route returns; it is
 * built by `toPublicAccount` and never carries tokens, passwords or URLs.
 */

export type CalendarProviderId = 'google' | 'microsoft' | 'icloud' | 'caldav' | 'ics';
export type AccountStatus = 'ok' | 'error' | 'reauth';

export interface PublicCalendar {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
}

export interface CalendarAccount {
  id: string;
  provider: CalendarProviderId;
  label: string;
  email: string | null;
  status: AccountStatus;
  error: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  calendars: PublicCalendar[];
}

export interface StoredCalendar extends PublicCalendar {
  /** True when the user changed the color (rediscovery keeps it). */
  colorLocked?: boolean;
  /** Provider's primary/default calendar. */
  primary?: boolean;
  /** CalDAV collection URL (internal; the public id is a hash of it). */
  url?: string;
}

export interface AccountSecrets {
  accessToken?: string;
  refreshToken?: string;
  /** Access token expiry, epoch ms. */
  expiresAt?: number;
  username?: string;
  password?: string;
  serverUrl?: string;
  icsUrl?: string;
}

export interface StoredAccount extends Omit<CalendarAccount, 'calendars'> {
  calendars: StoredCalendar[];
  secrets: AccountSecrets;
  /** Last time the calendar list was rediscovered, epoch ms. */
  discoveredAt?: number;
}

/** A calendar as reported by a provider during discovery. */
export interface DiscoveredCalendar {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  /** Holiday / birthday / contacts style read-only system calendar (default off). */
  system: boolean;
  url?: string;
}

/** One concrete event occurrence fetched from a provider (no account/calendar context). */
export interface RawEvent {
  /** Stable per-occurrence key within its calendar. */
  key: string;
  title: string;
  location: string | null;
  /** Epoch ms. */
  start: number;
  end: number;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface CachedEvent extends RawEvent {
  calendarId: string;
}

export interface TimeWindow {
  start: number;
  end: number;
}

export interface ScheduleEvent {
  id: string;
  source: CalendarProviderId | 'xlsx';
  accountId: string | null;
  calendarId: string | null;
  calendarName: string | null;
  color: string | null;
  title: string;
  location: string | null;
  startTime: string;
  endTime: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  isFlightDuty: boolean;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  aircraftType?: string;
  dutyType?: string;
  reportTime?: string;
  releaseTime?: string;
}

export interface ScheduleAccountSummary {
  id: string;
  label: string;
  provider: CalendarProviderId;
  status: AccountStatus;
}

/** Credentials were rejected or expired: the user must reconnect (status 'reauth'). */
export class CalendarAuthError extends Error {
  constructor(message = 'Sign-in expired. Reconnect this account.') {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

/** Any other sync/provider failure. `message` is human-readable and safe to show. */
export class CalendarError extends Error {
  constructor(
    message: string,
    public readonly status = 502
  ) {
    super(message);
    this.name = 'CalendarError';
  }
}
