/**
 * Presentation details for calendar providers and account status, shared by
 * the Calendars screen, the add flow and the widget summary.
 */

import type { Ionicons } from '@expo/vector-icons';
import { ApiError, type CalendarAccount, type CalendarProviderId } from '@/lib/api';
import { colors } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface ProviderMeta {
  /** Fallback when the mirror's provider list hasn't loaded. */
  name: string;
  icon: IconName;
  /** One line under the name in the provider picker. */
  blurb: string;
}

export const PROVIDER_META: Record<CalendarProviderId, ProviderMeta> = {
  google: {
    name: 'Google Calendar',
    icon: 'logo-google',
    blurb: 'Sign in with your Google account',
  },
  microsoft: {
    name: 'Outlook / Microsoft 365',
    icon: 'logo-microsoft',
    blurb: 'Outlook.com, Hotmail and work or school accounts',
  },
  icloud: {
    name: 'iCloud',
    icon: 'logo-apple',
    blurb: 'Uses an app-specific password from Apple',
  },
  caldav: {
    name: 'Other CalDAV',
    icon: 'server-outline',
    blurb: 'Nextcloud, Fastmail, Radicale and other servers',
  },
  ics: {
    name: 'Calendar link',
    icon: 'link-outline',
    blurb: 'Subscribe with a webcal or .ics link, including crew scheduling apps',
  },
};

/** Colours a calendar can be given on the mirror (matches the backend palette). */
export const CALENDAR_PALETTE = [
  '#7ad7ff',
  '#ffb86b',
  '#c3a6ff',
  '#7ee0a1',
  '#ff8fa3',
  '#f5d76e',
  '#8fb3ff',
  '#5fd4c4',
] as const;

const COLOR_NAMES: Record<string, string> = {
  '#7ad7ff': 'Sky blue',
  '#ffb86b': 'Orange',
  '#c3a6ff': 'Lavender',
  '#7ee0a1': 'Green',
  '#ff8fa3': 'Pink',
  '#f5d76e': 'Yellow',
  '#8fb3ff': 'Blue',
  '#5fd4c4': 'Teal',
};

export function colorName(hex: string): string {
  return COLOR_NAMES[hex.toLowerCase()] ?? 'Custom color';
}

export interface StatusInfo {
  label: string;
  color: string;
  icon: IconName;
  /** Longer explanation, when there is something to say. */
  detail: string | null;
}

export function accountStatus(account: CalendarAccount): StatusInfo {
  if (account.status === 'reauth') {
    return {
      label: 'Reconnect',
      color: colors.warning,
      icon: 'key-outline',
      detail:
        account.error ??
        'The mirror can no longer sign in to this account. Reconnect it to keep events showing.',
    };
  }
  if (account.status === 'error') {
    return {
      label: 'Sync problem',
      color: colors.warning,
      icon: 'warning-outline',
      detail:
        account.error ??
        'The last sync didn’t finish. The mirror keeps showing the events it already has.',
    };
  }
  return {
    label: account.lastSyncAt
      ? `Synced ${relativeTime(account.lastSyncAt)}`
      : 'Waiting for first sync',
    color: colors.success,
    icon: 'checkmark',
    detail: null,
  };
}

/** "just now", "5 min ago", "3 h ago", "yesterday", or a date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'a while ago';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `on ${new Date(then).toLocaleDateString()}`;
}

/**
 * Message for a failed calendar request. A 404 from the calendar routes means
 * the mirror runs software from before calendar accounts existed.
 */
export function calendarErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 404) {
    return 'This mirror’s software doesn’t support calendar accounts yet. Install the latest update on the mirror, then try again.';
  }
  return e instanceof Error && e.message ? e.message : fallback;
}
