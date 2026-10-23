/**
 * Astronomical Service
 * Calculates sun/moon times for pilot currency awareness
 */

import SunCalc from 'suncalc';

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
  civilDawn: Date; // Civil twilight begin
  civilDusk: Date; // Civil twilight end
  nauticalDawn: Date;
  nauticalDusk: Date;
  astronomicalDawn: Date;
  astronomicalDusk: Date;
  goldenHourStart: Date; // Evening golden hour
  goldenHourEnd: Date; // Morning golden hour end
}

export interface MoonData {
  phase: number; // 0-1, 0=new, 0.5=full
  phaseName: string;
  illumination: number; // 0-100%
  moonrise: Date | null;
  moonset: Date | null;
}

export interface AstroData {
  date: string; // ISO date string
  sun: SunTimes;
  moon: MoonData;
  location: {
    latitude: number;
    longitude: number;
  };
}

/**
 * Get moon phase name from phase value
 */
function getMoonPhaseName(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return 'New Moon';
  if (phase < 0.22) return 'Waxing Crescent';
  if (phase < 0.28) return 'First Quarter';
  if (phase < 0.47) return 'Waxing Gibbous';
  if (phase < 0.53) return 'Full Moon';
  if (phase < 0.72) return 'Waning Gibbous';
  if (phase < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}

/**
 * Calculate sun and moon data for a given location and date
 */
export function calculateAstroData(
  latitude: number,
  longitude: number,
  date: Date = new Date()
): AstroData {
  // Get sun times
  const sunTimes = SunCalc.getTimes(date, latitude, longitude);

  // Get moon illumination
  const moonIllum = SunCalc.getMoonIllumination(date);

  // Get moon times
  const moonTimes = SunCalc.getMoonTimes(date, latitude, longitude);

  const sun: SunTimes = {
    sunrise: sunTimes.sunrise,
    sunset: sunTimes.sunset,
    solarNoon: sunTimes.solarNoon,
    civilDawn: sunTimes.dawn,
    civilDusk: sunTimes.dusk,
    nauticalDawn: sunTimes.nauticalDawn,
    nauticalDusk: sunTimes.nauticalDusk,
    astronomicalDawn: sunTimes.nightEnd,
    astronomicalDusk: sunTimes.night,
    goldenHourStart: sunTimes.goldenHour,
    goldenHourEnd: sunTimes.goldenHourEnd,
  };

  const moon: MoonData = {
    phase: moonIllum.phase,
    phaseName: getMoonPhaseName(moonIllum.phase),
    illumination: Math.round(moonIllum.fraction * 100),
    moonrise: moonTimes.rise || null,
    moonset: moonTimes.set || null,
  };

  return {
    date: date.toISOString().split('T')[0],
    sun,
    moon,
    location: { latitude, longitude },
  };
}

/**
 * Format time for display in local timezone
 */
export function formatTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: true,
  });
}

/**
 * Format time as Zulu
 */
export function formatZulu(date: Date): string {
  return (
    date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      // hour12: false renders midnight as "24:00" in some ICU builds (Linux Node).
      hourCycle: 'h23',
    }) + 'Z'
  );
}

/**
 * Check if current time is during night (for VFR currency)
 * FAR 61.57(b): Night is defined as the time between the end of evening civil twilight
 * and the beginning of morning civil twilight
 */
export function isNightTime(astro: AstroData, now: Date = new Date()): boolean {
  return now < astro.sun.civilDawn || now > astro.sun.civilDusk;
}

/**
 * Check if current time is during day VFR hours
 */
export function isDayVfr(astro: AstroData, now: Date = new Date()): boolean {
  return now >= astro.sun.sunrise && now <= astro.sun.sunset;
}

/**
 * Get time until next significant event
 */
export function getUpcomingEvent(
  astro: AstroData,
  now: Date = new Date()
): { event: string; time: Date; minutesUntil: number } | null {
  const events: Array<{ event: string; time: Date }> = [
    { event: 'Civil Dawn', time: astro.sun.civilDawn },
    { event: 'Sunrise', time: astro.sun.sunrise },
    { event: 'Sunset', time: astro.sun.sunset },
    { event: 'Civil Dusk', time: astro.sun.civilDusk },
  ];

  // Find the next event after now
  for (const e of events) {
    if (e.time > now) {
      const minutesUntil = Math.round((e.time.getTime() - now.getTime()) / 60000);
      return { ...e, minutesUntil };
    }
  }

  // All events have passed for today - return tomorrow's civil dawn
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowAstro = calculateAstroData(
    astro.location.latitude,
    astro.location.longitude,
    tomorrow
  );

  const minutesUntil = Math.round((tomorrowAstro.sun.civilDawn.getTime() - now.getTime()) / 60000);

  return {
    event: 'Civil Dawn',
    time: tomorrowAstro.sun.civilDawn,
    minutesUntil,
  };
}

/**
 * Astro data manager with caching
 */
export class AstroDataManager {
  private cache: Map<string, AstroData> = new Map();
  private latitude: number;
  private longitude: number;

  constructor(latitude: number, longitude: number) {
    this.latitude = latitude;
    this.longitude = longitude;
  }

  /**
   * Get astro data for a date (cached)
   */
  getForDate(date: Date = new Date()): AstroData {
    const dateKey = date.toISOString().split('T')[0];

    if (this.cache.has(dateKey)) {
      return this.cache.get(dateKey)!;
    }

    const astro = calculateAstroData(this.latitude, this.longitude, date);
    this.cache.set(dateKey, astro);

    // Clean old cache entries (keep last 7 days)
    if (this.cache.size > 7) {
      const keys = Array.from(this.cache.keys()).sort();
      while (this.cache.size > 7) {
        this.cache.delete(keys.shift()!);
      }
    }

    return astro;
  }

  /**
   * Get today's astro data
   */
  getToday(): AstroData {
    return this.getForDate(new Date());
  }

  /**
   * Update location
   */
  setLocation(latitude: number, longitude: number): void {
    if (this.latitude !== latitude || this.longitude !== longitude) {
      this.latitude = latitude;
      this.longitude = longitude;
      this.cache.clear();
    }
  }
}
