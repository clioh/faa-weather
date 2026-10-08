import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseLocalFlightTime } from './taf-parser.js';

/**
 * parseLocalFlightTime must not depend on the host (server) timezone.
 * These tests force a non-UTC host TZ at runtime (Node re-reads process.env.TZ
 * when it is assigned) and check the result is the same absolute instant.
 */
const HOST_ZONES = ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/Berlin', 'UTC'];

describe.each(HOST_ZONES)('parseLocalFlightTime with host TZ=%s', (hostTz) => {
  let originalTz: string | undefined;

  beforeAll(() => {
    originalTz = process.env.TZ;
    process.env.TZ = hostTz;
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('host TZ override is in effect', () => {
    const expectedOffset = hostTz === 'UTC' ? 0 : null;
    const actual = new Date('2024-01-15T00:00:00Z').getTimezoneOffset();
    if (expectedOffset !== null) expect(actual).toBe(expectedOffset);
    else expect(actual).not.toBe(0);
  });

  it('converts 14:30 America/New_York (EST, UTC-5) on 2024-01-15 to 19:30Z', () => {
    const result = parseLocalFlightTime('14:30', new Date('2024-01-15'), 'America/New_York');
    expect(result.toISOString()).toBe('2024-01-15T19:30:00.000Z');
  });

  it('converts 0630 America/New_York in summer (EDT, UTC-4) to 10:30Z', () => {
    const result = parseLocalFlightTime('0630', new Date('2024-07-04'), 'America/New_York');
    expect(result.toISOString()).toBe('2024-07-04T10:30:00.000Z');
  });

  it('converts 11:45 PM America/Los_Angeles to 07:45Z the next UTC day', () => {
    const result = parseLocalFlightTime('11:45 PM', new Date('2024-01-15'), 'America/Los_Angeles');
    expect(result.toISOString()).toBe('2024-01-16T07:45:00.000Z');
  });

  it('converts 08:00 Asia/Tokyo (UTC+9) to 23:00Z the previous UTC day', () => {
    const result = parseLocalFlightTime('08:00', new Date('2024-01-15'), 'Asia/Tokyo');
    expect(result.toISOString()).toBe('2024-01-14T23:00:00.000Z');
  });

  it('treats the flight date of a full timestamp as the calendar day in the target zone', () => {
    // 2024-01-16T02:00Z is still Jan 15 in New York
    const result = parseLocalFlightTime('14:30', new Date('2024-01-16T02:00:00Z'), 'America/New_York');
    expect(result.toISOString()).toBe('2024-01-15T19:30:00.000Z');
  });

  it('handles 12:00 AM and 12:00 PM', () => {
    expect(
      parseLocalFlightTime('12:00 AM', new Date('2024-01-15'), 'UTC').toISOString()
    ).toBe('2024-01-15T00:00:00.000Z');
    expect(
      parseLocalFlightTime('12:00 PM', new Date('2024-01-15'), 'UTC').toISOString()
    ).toBe('2024-01-15T12:00:00.000Z');
  });
});
