/**
 * Curated IANA time zones for the time-zone picker.
 *
 * Bundled rather than read from Intl.supportedValuesOf because Hermes does
 * not reliably ship that API, and the full list (~420 zones) is mostly noise
 * for picking a clock. Free-text entry covers anything missing here.
 */

export interface TimezoneOption {
  id: string;
  city: string;
  region: string;
}

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { id: 'UTC', city: 'UTC / Zulu', region: 'Universal' },

  // North America
  { id: 'America/New_York', city: 'New York', region: 'North America' },
  { id: 'America/Detroit', city: 'Detroit', region: 'North America' },
  { id: 'America/Chicago', city: 'Chicago', region: 'North America' },
  { id: 'America/Denver', city: 'Denver', region: 'North America' },
  { id: 'America/Phoenix', city: 'Phoenix', region: 'North America' },
  { id: 'America/Los_Angeles', city: 'Los Angeles', region: 'North America' },
  { id: 'America/Anchorage', city: 'Anchorage', region: 'North America' },
  { id: 'Pacific/Honolulu', city: 'Honolulu', region: 'North America' },
  { id: 'America/Puerto_Rico', city: 'San Juan', region: 'North America' },
  { id: 'America/Halifax', city: 'Halifax', region: 'North America' },
  { id: 'America/St_Johns', city: 'St. John’s', region: 'North America' },
  { id: 'America/Toronto', city: 'Toronto', region: 'North America' },
  { id: 'America/Winnipeg', city: 'Winnipeg', region: 'North America' },
  { id: 'America/Edmonton', city: 'Edmonton', region: 'North America' },
  { id: 'America/Vancouver', city: 'Vancouver', region: 'North America' },
  { id: 'America/Mexico_City', city: 'Mexico City', region: 'North America' },
  { id: 'America/Cancun', city: 'Cancún', region: 'North America' },

  // Central & South America
  { id: 'America/Panama', city: 'Panama City', region: 'Latin America' },
  { id: 'America/Bogota', city: 'Bogotá', region: 'Latin America' },
  { id: 'America/Lima', city: 'Lima', region: 'Latin America' },
  { id: 'America/Santiago', city: 'Santiago', region: 'Latin America' },
  { id: 'America/Sao_Paulo', city: 'São Paulo', region: 'Latin America' },
  { id: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires', region: 'Latin America' },

  // Europe
  { id: 'Europe/London', city: 'London', region: 'Europe' },
  { id: 'Europe/Dublin', city: 'Dublin', region: 'Europe' },
  { id: 'Europe/Lisbon', city: 'Lisbon', region: 'Europe' },
  { id: 'Atlantic/Reykjavik', city: 'Reykjavík', region: 'Europe' },
  { id: 'Europe/Paris', city: 'Paris', region: 'Europe' },
  { id: 'Europe/Amsterdam', city: 'Amsterdam', region: 'Europe' },
  { id: 'Europe/Brussels', city: 'Brussels', region: 'Europe' },
  { id: 'Europe/Berlin', city: 'Berlin', region: 'Europe' },
  { id: 'Europe/Frankfurt', city: 'Frankfurt', region: 'Europe' },
  { id: 'Europe/Zurich', city: 'Zurich', region: 'Europe' },
  { id: 'Europe/Madrid', city: 'Madrid', region: 'Europe' },
  { id: 'Europe/Rome', city: 'Rome', region: 'Europe' },
  { id: 'Europe/Vienna', city: 'Vienna', region: 'Europe' },
  { id: 'Europe/Prague', city: 'Prague', region: 'Europe' },
  { id: 'Europe/Copenhagen', city: 'Copenhagen', region: 'Europe' },
  { id: 'Europe/Stockholm', city: 'Stockholm', region: 'Europe' },
  { id: 'Europe/Oslo', city: 'Oslo', region: 'Europe' },
  { id: 'Europe/Helsinki', city: 'Helsinki', region: 'Europe' },
  { id: 'Europe/Warsaw', city: 'Warsaw', region: 'Europe' },
  { id: 'Europe/Athens', city: 'Athens', region: 'Europe' },
  { id: 'Europe/Istanbul', city: 'Istanbul', region: 'Europe' },
  { id: 'Europe/Kyiv', city: 'Kyiv', region: 'Europe' },
  { id: 'Europe/Moscow', city: 'Moscow', region: 'Europe' },

  // Middle East & Africa
  { id: 'Asia/Dubai', city: 'Dubai', region: 'Middle East & Africa' },
  { id: 'Asia/Qatar', city: 'Doha', region: 'Middle East & Africa' },
  { id: 'Asia/Riyadh', city: 'Riyadh', region: 'Middle East & Africa' },
  { id: 'Asia/Jerusalem', city: 'Tel Aviv', region: 'Middle East & Africa' },
  { id: 'Africa/Cairo', city: 'Cairo', region: 'Middle East & Africa' },
  { id: 'Africa/Casablanca', city: 'Casablanca', region: 'Middle East & Africa' },
  { id: 'Africa/Lagos', city: 'Lagos', region: 'Middle East & Africa' },
  { id: 'Africa/Nairobi', city: 'Nairobi', region: 'Middle East & Africa' },
  { id: 'Africa/Johannesburg', city: 'Johannesburg', region: 'Middle East & Africa' },

  // Asia
  { id: 'Asia/Karachi', city: 'Karachi', region: 'Asia' },
  { id: 'Asia/Kolkata', city: 'Mumbai / Delhi', region: 'Asia' },
  { id: 'Asia/Kathmandu', city: 'Kathmandu', region: 'Asia' },
  { id: 'Asia/Dhaka', city: 'Dhaka', region: 'Asia' },
  { id: 'Asia/Bangkok', city: 'Bangkok', region: 'Asia' },
  { id: 'Asia/Jakarta', city: 'Jakarta', region: 'Asia' },
  { id: 'Asia/Singapore', city: 'Singapore', region: 'Asia' },
  { id: 'Asia/Kuala_Lumpur', city: 'Kuala Lumpur', region: 'Asia' },
  { id: 'Asia/Manila', city: 'Manila', region: 'Asia' },
  { id: 'Asia/Hong_Kong', city: 'Hong Kong', region: 'Asia' },
  { id: 'Asia/Shanghai', city: 'Shanghai / Beijing', region: 'Asia' },
  { id: 'Asia/Taipei', city: 'Taipei', region: 'Asia' },
  { id: 'Asia/Seoul', city: 'Seoul', region: 'Asia' },
  { id: 'Asia/Tokyo', city: 'Tokyo', region: 'Asia' },

  // Oceania
  { id: 'Australia/Perth', city: 'Perth', region: 'Oceania' },
  { id: 'Australia/Adelaide', city: 'Adelaide', region: 'Oceania' },
  { id: 'Australia/Brisbane', city: 'Brisbane', region: 'Oceania' },
  { id: 'Australia/Sydney', city: 'Sydney', region: 'Oceania' },
  { id: 'Australia/Melbourne', city: 'Melbourne', region: 'Oceania' },
  { id: 'Pacific/Auckland', city: 'Auckland', region: 'Oceania' },
  { id: 'Pacific/Guam', city: 'Guam', region: 'Oceania' },
];

/** Friendly name for an IANA id: curated city when known, else the last path segment. */
export function timezoneCity(id: string): string {
  const known = COMMON_TIMEZONES.find((tz) => tz.id === id);
  if (known) return known.city;
  const last = id.split('/').pop() ?? id;
  return last.replace(/_/g, ' ');
}

let intlTimeZonesWork: boolean | null = null;

/**
 * Whether `id` is a time zone the JS engine accepts. If this engine's Intl
 * has no time-zone data at all (UTC itself throws) we cannot tell, so accept
 * anything shaped like an IANA name and let the mirror's Node runtime decide.
 */
export function isValidTimezone(id: string): boolean {
  const trimmed = id.trim();
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(trimmed)) return false;
  if (intlTimeZonesWork === null) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });
      intlTimeZonesWork = true;
    } catch {
      intlTimeZonesWork = false;
    }
  }
  if (!intlTimeZonesWork) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * "GMT-5" style offset for display; empty string when Intl can't provide it.
 * Derived from the zone's wall-clock parts rather than timeZoneName:
 * 'shortOffset', which Hermes does not reliably support.
 */
export function timezoneOffsetLabel(id: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: id,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    // Some engines render midnight as hour 24 with hour12: false.
    const hour = get('hour') % 24;
    const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'));
    if (!Number.isFinite(wallAsUtc)) return '';
    const utcMinute = Math.floor(at.getTime() / 60000) * 60000;
    const offsetMin = Math.round((wallAsUtc - utcMinute) / 60000);
    if (offsetMin === 0) return 'GMT+0';
    const sign = offsetMin > 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
  } catch {
    return '';
  }
}
