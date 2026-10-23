import { describe, it, expect, beforeEach } from 'vitest';
import {
  AstroDataManager,
  formatTime,
  formatZulu,
  isNightTime,
  isDayVfr,
  getUpcomingEvent,
} from './astro.js';

describe('Astro Service', () => {
  describe('formatTime', () => {
    it('should format time in specified timezone', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const formatted = formatTime(date, 'America/New_York');

      // Should be 9:30 AM EST (UTC-5)
      expect(formatted).toMatch(/9:30/);
      expect(formatted).toMatch(/AM/i);
    });

    it('should handle different timezones', () => {
      const date = new Date('2024-01-15T12:00:00Z');

      const nyTime = formatTime(date, 'America/New_York');
      const laTime = formatTime(date, 'America/Los_Angeles');

      // NY is UTC-5, LA is UTC-8, so LA should be 3 hours earlier
      expect(nyTime).not.toBe(laTime);
    });
  });

  describe('formatZulu', () => {
    it('should format time in Zulu/UTC', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const formatted = formatZulu(date);

      // Actual format includes colon: "14:30Z"
      expect(formatted).toMatch(/14:30.*Z/);
    });

    it('should pad hours and minutes', () => {
      const date = new Date('2024-01-15T08:05:00Z');
      const formatted = formatZulu(date);

      expect(formatted).toMatch(/08:05.*Z/);
    });

    it('should handle midnight', () => {
      const date = new Date('2024-01-15T00:00:00Z');
      const formatted = formatZulu(date);

      expect(formatted).toMatch(/00:00.*Z/);
    });
  });

  describe('AstroDataManager', () => {
    let manager: AstroDataManager;

    beforeEach(() => {
      // Use JFK coordinates
      manager = new AstroDataManager(40.6413, -73.7781);
    });

    describe('getToday', () => {
      it('should return astro data for today', () => {
        const data = manager.getToday();

        expect(data).toHaveProperty('date');
        expect(data).toHaveProperty('sun');
        expect(data).toHaveProperty('moon');
        expect(data).toHaveProperty('location');
      });

      it('should include sun times', () => {
        const data = manager.getToday();

        expect(data.sun).toHaveProperty('sunrise');
        expect(data.sun).toHaveProperty('sunset');
        expect(data.sun).toHaveProperty('civilDawn');
        expect(data.sun).toHaveProperty('civilDusk');
        expect(data.sun).toHaveProperty('nauticalDawn');
        expect(data.sun).toHaveProperty('nauticalDusk');
        expect(data.sun).toHaveProperty('solarNoon');
      });

      it('should include moon data', () => {
        const data = manager.getToday();

        expect(data.moon).toHaveProperty('phase');
        expect(data.moon).toHaveProperty('phaseName');
        expect(data.moon).toHaveProperty('illumination');

        expect(data.moon.phase).toBeGreaterThanOrEqual(0);
        expect(data.moon.phase).toBeLessThanOrEqual(1);
        // Illumination is in percentage (0-100)
        expect(data.moon.illumination).toBeGreaterThanOrEqual(0);
        expect(data.moon.illumination).toBeLessThanOrEqual(100);
      });

      it('should have sunrise before sunset', () => {
        const data = manager.getToday();

        expect(data.sun.sunrise.getTime()).toBeLessThan(data.sun.sunset.getTime());
      });

      it('should have civil dawn before sunrise', () => {
        const data = manager.getToday();

        expect(data.sun.civilDawn.getTime()).toBeLessThan(data.sun.sunrise.getTime());
      });

      it('should have civil dusk after sunset', () => {
        const data = manager.getToday();

        expect(data.sun.civilDusk.getTime()).toBeGreaterThan(data.sun.sunset.getTime());
      });
    });

    describe('getForDate', () => {
      it('should return data for a specific date', () => {
        const date = new Date('2024-06-21'); // Summer solstice
        const data = manager.getForDate(date);

        expect(data.date).toBe('2024-06-21');
      });

      it('should return different times for different dates', () => {
        const winter = manager.getForDate(new Date('2024-12-21'));
        const summer = manager.getForDate(new Date('2024-06-21'));

        // Summer days are longer (sunrise earlier, sunset later)
        const winterDayLength = winter.sun.sunset.getTime() - winter.sun.sunrise.getTime();
        const summerDayLength = summer.sun.sunset.getTime() - summer.sun.sunrise.getTime();

        expect(summerDayLength).toBeGreaterThan(winterDayLength);
      });
    });

    describe('caching', () => {
      it('should return same object for same date', () => {
        const data1 = manager.getToday();
        const data2 = manager.getToday();

        // Should be referentially equal due to caching
        expect(data1).toBe(data2);
      });
    });
  });

  describe('isNightTime', () => {
    it('should return true before civil dawn', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to 2 hours before civil dawn
      const nightTime = new Date(astro.sun.civilDawn.getTime() - 2 * 60 * 60 * 1000);

      expect(isNightTime(astro, nightTime)).toBe(true);
    });

    it('should return true after civil dusk', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to 2 hours after civil dusk
      const nightTime = new Date(astro.sun.civilDusk.getTime() + 2 * 60 * 60 * 1000);

      expect(isNightTime(astro, nightTime)).toBe(true);
    });

    it('should return false during the day', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to solar noon
      expect(isNightTime(astro, astro.sun.solarNoon)).toBe(false);
    });
  });

  describe('isDayVfr', () => {
    it('should return true after sunrise', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to 1 hour after sunrise
      const dayTime = new Date(astro.sun.sunrise.getTime() + 60 * 60 * 1000);

      expect(isDayVfr(astro, dayTime)).toBe(true);
    });

    it('should return false before sunrise', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to 1 hour before sunrise
      const nightTime = new Date(astro.sun.sunrise.getTime() - 60 * 60 * 1000);

      expect(isDayVfr(astro, nightTime)).toBe(false);
    });

    it('should return false after sunset', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to 1 hour after sunset
      const nightTime = new Date(astro.sun.sunset.getTime() + 60 * 60 * 1000);

      expect(isDayVfr(astro, nightTime)).toBe(false);
    });
  });

  describe('getUpcomingEvent', () => {
    it('should return an upcoming event during night', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to 1 hour before sunrise
      const time = new Date(astro.sun.sunrise.getTime() - 60 * 60 * 1000);

      const upcoming = getUpcomingEvent(astro, time);

      expect(upcoming).not.toBeNull();
      // Could be Civil Dawn or Sunrise depending on exact time
      expect(['Sunrise', 'Civil Dawn']).toContain(upcoming?.event);
    });

    it('should return an upcoming event during day', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();

      // Set time to solar noon
      const upcoming = getUpcomingEvent(astro, astro.sun.solarNoon);

      expect(upcoming).not.toBeNull();
      // Could be any afternoon event
      expect(upcoming?.event).toBeDefined();
    });

    it('should include minutes until event', () => {
      const astro = new AstroDataManager(40.6413, -73.7781).getToday();
      const upcoming = getUpcomingEvent(astro, new Date());

      if (upcoming) {
        expect(typeof upcoming.minutesUntil).toBe('number');
        expect(upcoming.minutesUntil).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
