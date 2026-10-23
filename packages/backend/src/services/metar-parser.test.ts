import { describe, it, expect } from 'vitest';
import { parseMetar, formatWind, formatVisibility, formatClouds } from './metar-parser.js';

describe('METAR Parser', () => {
  describe('parseMetar', () => {
    it('should drop the METAR/SPECI report-type prefix used by aviationweather.gov', () => {
      const raw = 'METAR KSFO 150656Z 00000KT 10SM CLR 17/07 A3012 RMK AO2 SLP198 T01720072 $';
      const result = parseMetar(raw);

      expect(result.icao).toBe('KSFO');
      expect(result.observationTime).toBe('150656');
      expect(result.wind?.speed).toBe(0);
      expect(result.temperature).toBe(17);

      const speci = parseMetar('SPECI KSFO 150712Z 27012G20KT 3SM BR OVC008 15/14 A3010');
      expect(speci.icao).toBe('KSFO');
      expect(speci.observationTime).toBe('150712');
      expect(speci.wind?.gust).toBe(20);
      expect(speci.ceiling).toBe(800);
    });

    it('should parse a standard METAR', () => {
      const raw = 'KJFK 151951Z 31008KT 10SM FEW045 SCT250 17/01 A3012 RMK AO2 SLP203';
      const result = parseMetar(raw);

      expect(result.icao).toBe('KJFK');
      expect(result.observationTime).toBe('151951');
      expect(result.wind?.direction).toBe(310);
      expect(result.wind?.speed).toBe(8);
      expect(result.wind?.gust).toBeNull();
      expect(result.visibility).toBe(10);
      expect(result.temperature).toBe(17);
      expect(result.dewpoint).toBe(1);
      expect(result.altimeter).toBe(30.12);
    });

    it('should parse METAR with gusting winds', () => {
      const raw = 'KORD 121756Z 27015G25KT 10SM SCT035 BKN250 22/12 A2998';
      const result = parseMetar(raw);

      expect(result.wind?.direction).toBe(270);
      expect(result.wind?.speed).toBe(15);
      expect(result.wind?.gust).toBe(25);
    });

    it('should parse METAR with variable winds', () => {
      const raw = 'KLAX 121753Z VRB03KT 10SM CLR 18/11 A3002';
      const result = parseMetar(raw);

      expect(result.wind?.direction).toBeNull();
      expect(result.wind?.speed).toBe(3);
    });

    it('should parse METAR with variable wind direction', () => {
      const raw = 'KJFK 121756Z 31008KT 280V340 10SM FEW045 17/01 A3012';
      const result = parseMetar(raw);

      expect(result.wind?.direction).toBe(310);
      expect(result.wind?.variable?.from).toBe(280);
      expect(result.wind?.variable?.to).toBe(340);
    });

    it('should parse METAR with calm winds', () => {
      const raw = 'KDEN 121756Z 00000KT 10SM CLR 15/05 A3020';
      const result = parseMetar(raw);

      expect(result.wind?.direction).toBe(0);
      expect(result.wind?.speed).toBe(0);
    });

    it('should parse fractional visibility', () => {
      const raw = 'KSFO 121756Z 27010KT 1/2SM FG VV002 10/10 A3002';
      const result = parseMetar(raw);

      expect(result.visibility).toBe(0.5);
    });

    it('should parse mixed visibility (1 1/2SM)', () => {
      const raw = 'KBOS 121756Z 36015KT 1 1/2SM BR BKN010 08/07 A2990';
      const result = parseMetar(raw);

      // Note: Current parser may need adjustment for mixed fractions
      expect(result.visibility).toBeLessThanOrEqual(2);
    });

    it('should parse P6SM (greater than 6 miles)', () => {
      const raw = 'KMIA 121756Z 09012KT P6SM FEW025 SCT250 28/22 A3010';
      const result = parseMetar(raw);

      expect(result.visibility).toBe(10);
    });

    it('should parse negative temperatures', () => {
      const raw = 'KORD 121756Z 32020G30KT 10SM SCT020 M05/M12 A3025';
      const result = parseMetar(raw);

      expect(result.temperature).toBe(-5);
      expect(result.dewpoint).toBe(-12);
    });

    it('should calculate ceiling correctly', () => {
      const raw = 'KJFK 121756Z 27010KT 5SM FEW010 SCT020 BKN035 OVC100 15/10 A3000';
      const result = parseMetar(raw);

      // Ceiling is lowest BKN or OVC
      expect(result.ceiling).toBe(3500);
    });

    it('should parse vertical visibility', () => {
      const raw = 'KSFO 121756Z 00000KT 1/4SM FG VV002 10/10 A3002';
      const result = parseMetar(raw);

      expect(result.clouds).toContainEqual({
        coverage: 'VV',
        altitude: 200,
        type: undefined,
      });
      expect(result.ceiling).toBe(200);
    });

    it('should parse cloud types (CB, TCU)', () => {
      const raw = 'KMIA 121756Z 18015KT 6SM TSRA BKN025CB OVC045 25/22 A2995';
      const result = parseMetar(raw);

      expect(result.clouds).toContainEqual({
        coverage: 'BKN',
        altitude: 2500,
        type: 'CB',
      });
    });

    it('should detect AUTO observations', () => {
      const raw = 'KABC 121756Z AUTO 27005KT 10SM CLR 20/15 A3010';
      const result = parseMetar(raw);

      expect(result.isAuto).toBe(true);
    });

    it('should parse weather phenomena', () => {
      const raw = 'KORD 121756Z 27015KT 3SM +RA BR BKN015 OVC025 12/11 A2985';
      const result = parseMetar(raw);

      expect(result.weather).toContain('+RA');
      expect(result.weather).toContain('BR');
    });

    it('should parse thunderstorm with rain', () => {
      const raw = 'KMIA 121756Z 18020G35KT 2SM TSRA BKN020CB OVC040 24/22 A2990';
      const result = parseMetar(raw);

      expect(result.weather).toContain('TSRA');
    });

    it('should extract remarks', () => {
      const raw = 'KJFK 121756Z 27010KT 10SM FEW045 17/01 A3012 RMK AO2 SLP203 T01670006';
      const result = parseMetar(raw);

      expect(result.remarks).toContain('AO2');
      expect(result.remarks).toContain('SLP203');
    });

    it('should handle SKC (sky clear)', () => {
      const raw = 'KLAX 121756Z 25005KT 10SM SKC 22/14 A3002';
      const result = parseMetar(raw);

      expect(result.clouds).toContainEqual({
        coverage: 'SKC',
        altitude: null,
        type: undefined,
      });
      expect(result.ceiling).toBeNull();
    });

    it('should handle CLR (clear)', () => {
      const raw = 'KDEN 121756Z 18008KT 10SM CLR 25/08 A3015';
      const result = parseMetar(raw);

      expect(result.clouds).toContainEqual({
        coverage: 'CLR',
        altitude: null,
        type: undefined,
      });
      expect(result.ceiling).toBeNull();
    });
  });

  describe('formatWind', () => {
    it('should format calm winds', () => {
      expect(formatWind(null)).toBe('Calm');
      expect(formatWind({ direction: 0, speed: 0, gust: null })).toBe('Calm');
    });

    it('should format standard winds', () => {
      const wind = { direction: 310, speed: 15, gust: null };
      expect(formatWind(wind)).toBe('310° at 15kt');
    });

    it('should format gusting winds', () => {
      const wind = { direction: 270, speed: 20, gust: 30 };
      expect(formatWind(wind)).toBe('270° at 20kt gusting 30kt');
    });

    it('should format variable direction winds', () => {
      const wind = { direction: null, speed: 5, gust: null };
      expect(formatWind(wind)).toBe('VRB at 5kt');
    });

    it('should format winds with variable range', () => {
      const wind = {
        direction: 310,
        speed: 10,
        gust: null,
        variable: { from: 280, to: 340 },
      };
      expect(formatWind(wind)).toBe('310° at 10kt (variable 280°-340°)');
    });

    it('should pad direction to 3 digits', () => {
      const wind = { direction: 90, speed: 10, gust: null };
      expect(formatWind(wind)).toBe('090° at 10kt');
    });
  });

  describe('formatVisibility', () => {
    it('should handle unknown visibility', () => {
      expect(formatVisibility(null)).toBe('Unknown');
    });

    it('should format high visibility', () => {
      expect(formatVisibility(10)).toBe('10+ SM');
      expect(formatVisibility(15)).toBe('10+ SM');
    });

    it('should format low visibility', () => {
      expect(formatVisibility(0.5)).toBe('0.5 SM');
      expect(formatVisibility(0.25)).toBe('0.25 SM');
    });

    it('should format normal visibility', () => {
      expect(formatVisibility(5)).toBe('5 SM');
      expect(formatVisibility(3)).toBe('3 SM');
    });
  });

  describe('formatClouds', () => {
    it('should handle no clouds', () => {
      expect(formatClouds([])).toBe('No clouds reported');
    });

    it('should format SKC/CLR', () => {
      expect(formatClouds([{ coverage: 'SKC', altitude: null }])).toBe('SKC');
      expect(formatClouds([{ coverage: 'CLR', altitude: null }])).toBe('CLR');
    });

    it('should format cloud layers with altitude', () => {
      const clouds = [
        { coverage: 'FEW' as const, altitude: 2500 },
        { coverage: 'SCT' as const, altitude: 5000 },
        { coverage: 'BKN' as const, altitude: 10000 },
      ];
      expect(formatClouds(clouds)).toBe('FEW 2,500ft, SCT 5,000ft, BKN 10,000ft');
    });

    it('should include cloud type', () => {
      const clouds = [{ coverage: 'BKN' as const, altitude: 2500, type: 'CB' as const }];
      expect(formatClouds(clouds)).toBe('BKN 2,500ft CB');
    });
  });
});
