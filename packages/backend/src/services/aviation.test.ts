import { describe, it, expect } from 'vitest';
import { calculateFlightRules } from './aviation.js';

describe('Aviation Service', () => {
  describe('calculateFlightRules', () => {
    describe('VFR conditions', () => {
      it('should return VFR for clear skies and unlimited visibility', () => {
        expect(calculateFlightRules(null, null)).toBe('VFR');
        expect(calculateFlightRules(null, 10)).toBe('VFR');
        expect(calculateFlightRules(10000, null)).toBe('VFR');
      });

      it('should return VFR for ceiling > 3000ft AND visibility > 5sm', () => {
        expect(calculateFlightRules(5000, 10)).toBe('VFR');
        expect(calculateFlightRules(10000, 7)).toBe('VFR');
        expect(calculateFlightRules(3500, 6)).toBe('VFR');
      });

      it('should return VFR at exactly the boundary', () => {
        // Ceiling > 3000 AND visibility > 5
        expect(calculateFlightRules(3001, 5.1)).toBe('VFR');
      });
    });

    describe('MVFR conditions', () => {
      it('should return MVFR for ceiling 1000-3000ft', () => {
        expect(calculateFlightRules(1000, 10)).toBe('MVFR');
        expect(calculateFlightRules(2000, 10)).toBe('MVFR');
        expect(calculateFlightRules(3000, 10)).toBe('MVFR');
      });

      it('should return MVFR for visibility 3-5sm', () => {
        expect(calculateFlightRules(5000, 3)).toBe('MVFR');
        expect(calculateFlightRules(5000, 4)).toBe('MVFR');
        expect(calculateFlightRules(5000, 5)).toBe('MVFR');
      });

      it('should return MVFR when both ceiling and visibility are MVFR', () => {
        expect(calculateFlightRules(2500, 4)).toBe('MVFR');
      });
    });

    describe('IFR conditions', () => {
      it('should return IFR for ceiling 500-1000ft', () => {
        expect(calculateFlightRules(500, 10)).toBe('IFR');
        expect(calculateFlightRules(700, 10)).toBe('IFR');
        expect(calculateFlightRules(999, 10)).toBe('IFR');
      });

      it('should return IFR for visibility 1-3sm', () => {
        expect(calculateFlightRules(5000, 1)).toBe('IFR');
        expect(calculateFlightRules(5000, 2)).toBe('IFR');
        expect(calculateFlightRules(5000, 2.5)).toBe('IFR');
      });

      it('should return IFR when both ceiling and visibility are IFR', () => {
        expect(calculateFlightRules(800, 2)).toBe('IFR');
      });
    });

    describe('LIFR conditions', () => {
      it('should return LIFR for ceiling < 500ft', () => {
        expect(calculateFlightRules(100, 10)).toBe('LIFR');
        expect(calculateFlightRules(200, 10)).toBe('LIFR');
        expect(calculateFlightRules(499, 10)).toBe('LIFR');
      });

      it('should return LIFR for visibility < 1sm', () => {
        expect(calculateFlightRules(5000, 0.25)).toBe('LIFR');
        expect(calculateFlightRules(5000, 0.5)).toBe('LIFR');
        expect(calculateFlightRules(5000, 0.75)).toBe('LIFR');
      });

      it('should return LIFR when both ceiling and visibility are LIFR', () => {
        expect(calculateFlightRules(200, 0.5)).toBe('LIFR');
      });

      it('should return LIFR for zero visibility', () => {
        expect(calculateFlightRules(5000, 0)).toBe('LIFR');
      });
    });

    describe('Most restrictive condition wins', () => {
      it('should return LIFR when visibility is LIFR but ceiling is VFR', () => {
        expect(calculateFlightRules(10000, 0.5)).toBe('LIFR');
      });

      it('should return LIFR when ceiling is LIFR but visibility is VFR', () => {
        expect(calculateFlightRules(200, 10)).toBe('LIFR');
      });

      it('should return IFR when ceiling is IFR but visibility is VFR', () => {
        expect(calculateFlightRules(800, 10)).toBe('IFR');
      });

      it('should return IFR when visibility is IFR but ceiling is MVFR', () => {
        expect(calculateFlightRules(2000, 2)).toBe('IFR');
      });

      it('should return MVFR when ceiling is MVFR but visibility is VFR', () => {
        expect(calculateFlightRules(2000, 10)).toBe('MVFR');
      });
    });

    describe('Edge cases', () => {
      it('should handle zero ceiling', () => {
        expect(calculateFlightRules(0, 10)).toBe('LIFR');
      });

      it('should treat null as unlimited', () => {
        expect(calculateFlightRules(null, 10)).toBe('VFR');
        expect(calculateFlightRules(5000, null)).toBe('VFR');
      });

      it('should handle very high values', () => {
        expect(calculateFlightRules(50000, 100)).toBe('VFR');
      });
    });
  });
});
