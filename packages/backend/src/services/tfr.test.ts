import { describe, it, expect } from 'vitest';
import { parseTfrDescription, parseTfrListItem } from './aviation.js';

// Rows as returned by https://tfr.faa.gov/tfrapi/getTfrList (Oct 2026)
describe('parseTfrDescription', () => {
  it('splits a date range in UTC', () => {
    expect(
      parseTfrDescription(
        '11NM SE SENECA, OR, Thursday, October 15, 2026 through Monday, October 19, 2026 UTC'
      )
    ).toEqual({
      location: '11NM SE SENECA, OR',
      effectiveStart: '2026-10-15',
      effectiveEnd: '2026-10-19',
    });
  });

  it('splits a date range in local time', () => {
    expect(
      parseTfrDescription(
        'MAYPORT, FL, Tuesday, October 13, 2026 through Saturday, October 17, 2026 Local'
      )
    ).toEqual({
      location: 'MAYPORT, FL',
      effectiveStart: '2026-10-13',
      effectiveEnd: '2026-10-17',
    });
  });

  it('treats a single day as start and end', () => {
    expect(parseTfrDescription('Fayetteville, WV, Saturday, October 17, 2026 UTC')).toEqual({
      location: 'Fayetteville, WV',
      effectiveStart: '2026-10-17',
      effectiveEnd: '2026-10-17',
    });
    expect(parseTfrDescription('Marietta, GA, Friday, October 16, 2026 Local').effectiveStart).toBe(
      '2026-10-16'
    );
  });

  it('handles a leading-whitespace USA-wide range', () => {
    expect(
      parseTfrDescription('  USA, Thursday, April 16, 2026 through Sunday, April 16, 2028 UTC')
    ).toEqual({ location: 'USA', effectiveStart: '2026-04-16', effectiveEnd: '2028-04-16' });
  });

  it('leaves standing TFRs without dates', () => {
    expect(parseTfrDescription('WASHINGTON, DC., USA')).toEqual({
      location: 'WASHINGTON, DC., USA',
      effectiveStart: '',
      effectiveEnd: '',
    });
    expect(parseTfrDescription('Clear, AK').effectiveEnd).toBe('');
    expect(parseTfrDescription('').location).toBe('');
  });
});

describe('parseTfrListItem', () => {
  it('maps a feed row to TfrData', () => {
    expect(
      parseTfrListItem({
        notam_id: '6/9735',
        facility: 'ZLC',
        state: 'OR',
        type: 'HAZARDS',
        description:
          '11NM SE SENECA, OR, Thursday, October 15, 2026 through Monday, October 19, 2026 UTC',
        mod_date: '10/15/2026 03:47:00',
        mod_abs_time: '202610150347',
        is_new: 'Y',
        gid: '6/9735',
      })
    ).toEqual({
      id: '6/9735',
      type: 'HAZARDS',
      facility: 'ZLC',
      state: 'OR',
      description: '11NM SE SENECA, OR',
      effectiveStart: '2026-10-15',
      effectiveEnd: '2026-10-19',
      lastModified: '2026-10-15T03:47:00Z',
      latitude: null,
      longitude: null,
    });
  });

  it('tolerates missing fields', () => {
    expect(parseTfrListItem({})).toEqual({
      id: '',
      type: 'Unknown',
      facility: '',
      state: '',
      description: '',
      effectiveStart: '',
      effectiveEnd: '',
      lastModified: '',
      latitude: null,
      longitude: null,
    });
  });
});
