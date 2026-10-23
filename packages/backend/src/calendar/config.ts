/**
 * Calendar settings from config (config/default.yaml + config/config.yaml).
 * The mirror holds no OAuth app credentials: Google/Outlook client config
 * comes from the SkyGlass service at `skyglass_service` (top-level config key).
 */

import type { Config } from '../config/index.js';
import { skyglassServiceUrl } from '../services/skyglass-service.js';
import { isValidTimeZone, systemTimeZone } from './time.js';

export interface CalendarSettings {
  refreshMinutes: number;
  /** Mirror timezone (config location.timezone): all-day and floating times use it. */
  timezone: string;
  /**
   * Base URL of the SkyGlass sign-in service (no trailing slash), or null when
   * `skyglass_service` is set but invalid (not https, except localhost).
   */
  authService: string | null;
}

export function readCalendarSettings(config: Partial<Config>): CalendarSettings {
  const cal = (config.calendar ?? {}) as Partial<NonNullable<Config['calendar']>>;
  const minutes = Number(cal.refresh_minutes);
  const tz = config.location?.timezone;
  const authService = skyglassServiceUrl(config);
  if (!authService)
    console.warn(
      '[calendar] skyglass_service is not a valid https:// URL; Google/Outlook sign-in disabled'
    );

  return {
    refreshMinutes: Number.isFinite(minutes)
      ? Math.min(1440, Math.max(1, Math.round(minutes)))
      : 10,
    timezone: tz && isValidTimeZone(tz) ? tz : systemTimeZone(),
    authService,
  };
}
