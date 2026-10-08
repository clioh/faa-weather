import { describe, it, expect } from 'vitest';
import {
  parseTaf,
  formatPeriodTime,
  getPeriodForTime,
  getPeriodsForTimeRange,
  parseLocalFlightTime,
  getFlightTimeForecast,
  parseVisibility,
} from './taf-parser.js';

describe('TAF Parser', () => {
  describe('parseTaf', () => {
    it('should parse a simple TAF', () => {
      const raw = 'KJFK 151730Z 1518/1624 31010KT P6SM FEW040 SCT250';
      const result = parseTaf(raw);

      expect(result.icao).toBe('KJFK');
      expect(result.issueTime).toBe('151730');
      expect(result.validFrom).toBe('1518');
      expect(result.validTo).toBe('1624');
      expect(result.periods).toHaveLength(1);
      expect(result.periods[0].type).toBe('BASE');
    });

    it('should parse TAF with FM period', () => {
      const raw =
        'KJFK 151730Z 1518/1624 31010KT P6SM FEW040 FM152200 33012G20KT P6SM SCT040';
      const result = parseTaf(raw);

      expect(result.periods).toHaveLength(2);
      expect(result.periods[0].type).toBe('BASE');
      expect(result.periods[1].type).toBe('FM');
      expect(result.periods[1].startTime).toBe('152200');
    });

    it('should parse TAF with TEMPO period', () => {
      const raw =
        'KJFK 151730Z 1518/1624 31010KT P6SM FEW040 TEMPO 1520/1524 4SM -RA BR BKN030';
      const result = parseTaf(raw);

      const tempoPeriod = result.periods.find((p) => p.type === 'TEMPO');
      expect(tempoPeriod).toBeDefined();
      expect(tempoPeriod?.startTime).toBe('152000');
      expect(tempoPeriod?.endTime).toBe('152400');
      expect(tempoPeriod?.visibility).toBe(4);
      expect(tempoPeriod?.weather).toContain('-RA');
      expect(tempoPeriod?.weather).toContain('BR');
    });

    it('should parse TAF with BECMG period', () => {
      const raw = 'KJFK 151730Z 1518/1624 31010KT P6SM FEW040 BECMG 1520/1522 27015KT';
      const result = parseTaf(raw);

      const becmgPeriod = result.periods.find((p) => p.type === 'BECMG');
      expect(becmgPeriod).toBeDefined();
      expect(becmgPeriod?.wind?.direction).toBe(270);
      expect(becmgPeriod?.wind?.speed).toBe(15);
    });

    it('should parse TAF with PROB period', () => {
      const raw =
        'KJFK 151730Z 1518/1624 31010KT P6SM FEW040 PROB30 1520/1524 2SM TSRA BKN020CB';
      const result = parseTaf(raw);

      const probPeriod = result.periods.find((p) => p.type === 'PROB');
      expect(probPeriod).toBeDefined();
      expect(probPeriod?.probability).toBe(30);
      expect(probPeriod?.visibility).toBe(2);
      expect(probPeriod?.weather).toContain('TSRA');
    });

    it('should calculate ceiling correctly', () => {
      const raw = 'KJFK 151730Z 1518/1624 31010KT 5SM FEW010 SCT020 BKN035 OVC100';
      const result = parseTaf(raw);

      expect(result.periods[0].ceiling).toBe(3500);
    });

    it('should calculate flight rules correctly', () => {
      // VFR conditions
      const vfrTaf = parseTaf('KJFK 151730Z 1518/1624 31010KT P6SM FEW040');
      expect(vfrTaf.periods[0].flightRules).toBe('VFR');

      // IFR conditions
      const ifrTaf = parseTaf('KJFK 151730Z 1518/1624 31010KT 2SM BKN008');
      expect(ifrTaf.periods[0].flightRules).toBe('IFR');

      // LIFR conditions
      const lifrTaf = parseTaf('KJFK 151730Z 1518/1624 31010KT 1/2SM OVC002');
      expect(lifrTaf.periods[0].flightRules).toBe('LIFR');
    });

    it('should parse gusting winds', () => {
      const raw = 'KJFK 151730Z 1518/1624 27020G35KT P6SM SCT040';
      const result = parseTaf(raw);

      expect(result.periods[0].wind?.direction).toBe(270);
      expect(result.periods[0].wind?.speed).toBe(20);
      expect(result.periods[0].wind?.gust).toBe(35);
    });

    it('should parse variable winds', () => {
      const raw = 'KJFK 151730Z 1518/1624 VRB05KT P6SM CLR';
      const result = parseTaf(raw);

      expect(result.periods[0].wind?.direction).toBeNull();
      expect(result.periods[0].wind?.speed).toBe(5);
    });

    it('should parse fractional visibility', () => {
      const raw = 'KJFK 151730Z 1518/1624 27010KT 1/2SM FG VV002';
      const result = parseTaf(raw);

      expect(result.periods[0].visibility).toBe(0.5);
    });

    it('should parse complex TAF with multiple periods', () => {
      const raw = `KJFK 151730Z 1518/1624 31010KT P6SM FEW040 SCT250
        FM152200 33012G20KT P6SM SCT040 BKN100
        TEMPO 1520/1524 4SM -RA BR BKN030
        FM160000 36008KT P6SM FEW080`;
      const result = parseTaf(raw);

      expect(result.periods.length).toBeGreaterThanOrEqual(4);
      expect(result.periods.filter((p) => p.type === 'FM')).toHaveLength(2);
      expect(result.periods.filter((p) => p.type === 'TEMPO')).toHaveLength(1);
    });

    it('should handle empty or invalid input', () => {
      const result = parseTaf('');
      expect(result.icao).toBe('');
      expect(result.periods).toHaveLength(0);
    });
  });

  describe('visibility parsing', () => {
    const base = (vis: string) =>
      parseTaf(`KJFK 151730Z 1518/1624 31010KT ${vis} SKC`).periods[0];

    it.each([
      ['P6SM', 10, 'VFR'],
      ['6SM', 6, 'VFR'],
      ['5SM', 5, 'MVFR'],
      ['3SM', 3, 'MVFR'],
      ['2SM', 2, 'IFR'],
      ['1 1/2SM', 1.5, 'IFR'],
      ['2 1/4SM', 2.25, 'IFR'],
      ['2 3/4SM', 2.75, 'IFR'],
      ['1SM', 1, 'IFR'],
      ['3/4SM', 0.75, 'LIFR'],
      ['1/2SM', 0.5, 'LIFR'],
      ['1/4SM', 0.25, 'LIFR'],
      ['M1/4SM', 0.25, 'LIFR'],
    ])('parses %s as %d SM (%s)', (vis, expected, rules) => {
      const period = base(vis);
      expect(period.visibility).toBeCloseTo(expected as number);
      expect(period.flightRules).toBe(rules);
    });

    it('parses a mixed-number visibility inside a TEMPO group', () => {
      const taf = parseTaf(
        'KJFK 151730Z 1518/1624 31010KT P6SM SKC TEMPO 1520/1524 1 1/2SM BR'
      );
      const tempo = taf.periods.find((p) => p.type === 'TEMPO');
      expect(tempo?.visibility).toBe(1.5);
      expect(tempo?.flightRules).toBe('IFR');
    });

    it('does not treat a wind or time group as the whole-mile part', () => {
      expect(parseVisibility('FM152200 33012KT 1/2SM FG')).toBe(0.5);
      expect(parseVisibility('TEMPO 1520/1524 3/4SM BR')).toBe(0.75);
    });

    it('returns null when no visibility group is present', () => {
      expect(parseVisibility('31010KT BKN020')).toBeNull();
    });
  });

  describe('formatPeriodTime', () => {
    it('should format 6-digit time', () => {
      expect(formatPeriodTime('152200')).toBe('Day 15 22:00Z');
    });

    it('should format 4-digit time', () => {
      expect(formatPeriodTime('1522')).toBe('Day 15 22:00Z');
    });
  });

  describe('getPeriodForTime', () => {
    const sampleTaf = parseTaf(
      'KJFK 151730Z 1518/1624 31010KT P6SM FEW040 FM152200 33015KT P6SM SCT050'
    );

    it('should return base period for early time', () => {
      // Create a date that falls within base period
      const testDate = new Date();
      testDate.setUTCDate(15);
      testDate.setUTCHours(19, 0, 0, 0);

      const period = getPeriodForTime(sampleTaf, testDate);
      expect(period?.type).toBe('BASE');
    });

    it('should return FM period after transition', () => {
      // Create a date after FM period starts
      const testDate = new Date();
      testDate.setUTCDate(15);
      testDate.setUTCHours(23, 0, 0, 0);

      const period = getPeriodForTime(sampleTaf, testDate);
      expect(period?.type).toBe('FM');
    });

    it('should return null for empty TAF', () => {
      const emptyTaf = parseTaf('');
      const period = getPeriodForTime(emptyTaf, new Date());
      expect(period).toBeNull();
    });
  });

  describe('getPeriodsForTimeRange', () => {
    const complexTaf = parseTaf(
      `KJFK 151730Z 1518/1624 31010KT P6SM FEW040
       TEMPO 1520/1524 4SM -RA BKN030
       PROB30 1521/1523 2SM TSRA BKN015CB`
    );

    it('should return overlapping TEMPO periods', () => {
      const startTime = new Date();
      startTime.setUTCDate(15);
      startTime.setUTCHours(21, 0, 0, 0);

      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

      const result = getPeriodsForTimeRange(complexTaf, startTime, endTime);

      expect(result.tempo).toHaveLength(1);
      expect(result.prob).toHaveLength(1);
    });

    it('should return base period', () => {
      const startTime = new Date();
      startTime.setUTCDate(15);
      startTime.setUTCHours(19, 0, 0, 0);

      const endTime = new Date(startTime.getTime() + 1 * 60 * 60 * 1000);

      const result = getPeriodsForTimeRange(complexTaf, startTime, endTime);

      expect(result.base).not.toBeNull();
      expect(result.base?.type).toBe('BASE');
    });
  });

  describe('parseLocalFlightTime', () => {
    const timezone = 'America/New_York';
    const flightDate = new Date('2024-01-15');

    it('should parse HH:MM format', () => {
      const result = parseLocalFlightTime('14:30', flightDate, timezone);
      expect(result).toBeInstanceOf(Date);
    });

    it('should parse HHMM format', () => {
      const result = parseLocalFlightTime('1430', flightDate, timezone);
      expect(result).toBeInstanceOf(Date);
    });

    it('should parse 12-hour AM format', () => {
      const result = parseLocalFlightTime('6:30 AM', flightDate, timezone);
      expect(result).toBeInstanceOf(Date);
    });

    it('should parse 12-hour PM format', () => {
      const result = parseLocalFlightTime('2:30 PM', flightDate, timezone);
      expect(result).toBeInstanceOf(Date);
    });

    it('should throw for invalid time', () => {
      expect(() => parseLocalFlightTime('invalid', flightDate, timezone)).toThrow();
    });
  });

  describe('getFlightTimeForecast', () => {
    it('should return warnings for IFR conditions', () => {
      const taf = parseTaf(
        'KJFK 151730Z 1518/1624 31010KT 2SM BR BKN008 TEMPO 1520/1524 1SM FG OVC003'
      );

      const departureTime = new Date();
      departureTime.setUTCDate(15);
      departureTime.setUTCHours(21, 0, 0, 0);

      const forecast = getFlightTimeForecast(taf, departureTime);

      expect(forecast.warnings.length).toBeGreaterThan(0);
      expect(forecast.warnings.some((w) => w.includes('IFR') || w.includes('LIFR'))).toBe(
        true
      );
    });

    it('should return warnings for thunderstorms', () => {
      const taf = parseTaf(
        'KJFK 151730Z 1518/1624 31010KT P6SM FEW040 TEMPO 1520/1524 2SM TSRA BKN025CB'
      );

      const departureTime = new Date();
      departureTime.setUTCDate(15);
      departureTime.setUTCHours(21, 0, 0, 0);

      const forecast = getFlightTimeForecast(taf, departureTime);

      expect(forecast.warnings.some((w) => w.includes('Thunderstorms'))).toBe(true);
    });

    it('should return empty warnings for VFR conditions', () => {
      const taf = parseTaf('KJFK 151730Z 1518/1624 31010KT P6SM FEW040 SCT250');

      const departureTime = new Date();
      departureTime.setUTCDate(15);
      departureTime.setUTCHours(19, 0, 0, 0);

      const forecast = getFlightTimeForecast(taf, departureTime);

      expect(forecast.warnings).toHaveLength(0);
    });
  });
});
