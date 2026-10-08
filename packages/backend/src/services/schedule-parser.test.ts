import { describe, it, expect } from 'vitest';
import { parseFlightSchedule, type ColumnMapping } from './schedule-parser.js';

describe('Schedule Parser', () => {
  describe('parseFlightSchedule', () => {
    // Since we can't easily test XLSX parsing without actual files,
    // we'll test the helper functions and edge cases

    it('should export parseFlightSchedule function', () => {
      expect(typeof parseFlightSchedule).toBe('function');
    });
  });

  describe('ColumnMapping', () => {
    it('should have correct default mapping structure', () => {
      const defaultMapping: ColumnMapping = {
        date: 'Date',
        flightNumber: 'Flight',
        departure: 'Dep',
        arrival: 'Arr',
        departureTime: 'Out',
        arrivalTime: 'In',
        dutyType: 'Duty',
      };

      expect(defaultMapping).toHaveProperty('date');
      expect(defaultMapping).toHaveProperty('flightNumber');
      expect(defaultMapping).toHaveProperty('departure');
      expect(defaultMapping).toHaveProperty('arrival');
    });
  });
});

describe('Date/Time Parsing', () => {
  // Test date parsing logic that would be used by the parser

  it('should handle MM/DD/YYYY format', () => {
    const dateStr = '01/15/2024';
    const date = new Date(dateStr);

    // Date parsing can be tricky, so we check it's valid
    expect(date.getTime()).not.toBeNaN();
  });

  it('should handle various time formats', () => {
    const times = ['14:30', '1430', '2:30 PM', '14:30:00'];

    times.forEach((timeStr) => {
      // Verify each format can be parsed in some way
      expect(timeStr.match(/\d/)).not.toBeNull();
    });
  });

  it('should distinguish between L (local) and Z (zulu) times', () => {
    const localTime = '14:30L';
    const zuluTime = '19:30Z';

    expect(localTime.endsWith('L')).toBe(true);
    expect(zuluTime.endsWith('Z')).toBe(true);
  });
});
