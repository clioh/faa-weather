import { describe, it, expect } from 'vitest';
import { parseIcs, IcsParseError } from './ical.js';

const VTZ_NY = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'X-WR-CALNAME:Crew & Family',
  'X-APPLE-CALENDAR-COLOR:#FF2968FF',
  VTZ_NY,
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'SUMMARY:Sim session',
  'LOCATION:Training center',
  'DTSTART;TZID=America/New_York:20261015T090000',
  'DTEND;TZID=America/New_York:20261015T110000',
  'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=6',
  'EXDATE;TZID=America/New_York:20261029T090000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'RECURRENCE-ID;TZID=America/New_York:20261112T090000',
  'SUMMARY:Sim session (moved)',
  'DTSTART;TZID=America/New_York:20261112T103000',
  'DTEND;TZID=America/New_York:20261112T123000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-1',
  'SUMMARY:Vacation',
  'DTSTART;VALUE=DATE:20261020',
  'DTEND;VALUE=DATE:20261023',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-2',
  'SUMMARY:Birthday',
  'DTSTART;VALUE=DATE:20261021',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:berlin-1',
  'SUMMARY:Call with Berlin',
  'DTSTART;TZID=Europe/Berlin:20261021T180000',
  'DTEND;TZID=Europe/Berlin:20261021T190000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc-1',
  'SUMMARY:UTC meeting',
  'DTSTART:20261021T120000Z',
  'DURATION:PT30M',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:floating-1',
  'SUMMARY:Floating lunch',
  'DTSTART:20261022T120000',
  'DTEND:20261022T130000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cancelled-1',
  'SUMMARY:Cancelled',
  'STATUS:CANCELLED',
  'DTSTART:20261021T150000Z',
  'DTEND:20261021T160000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:old-1',
  'SUMMARY:Long ago',
  'DTSTART:20200101T120000Z',
  'DTEND:20200101T130000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const WINDOW = { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-12-31T00:00:00Z') };

describe('parseIcs', () => {
  const parsed = parseIcs(ICS, WINDOW, 'America/Los_Angeles');
  const byTitle = (t: string) => parsed.events.filter((e) => e.title === t);

  it('reads the calendar name and color', () => {
    expect(parsed.name).toBe('Crew & Family');
    expect(parsed.color).toBe('#FF2968FF');
  });

  it('expands a weekly RRULE with EXDATE across a DST change, using the VTIMEZONE', () => {
    const sims = byTitle('Sim session').map((e) => new Date(e.start).toISOString());
    expect(sims).toEqual([
      '2026-10-15T13:00:00.000Z', // EDT
      '2026-10-22T13:00:00.000Z',
      // 10-29 excluded by EXDATE
      '2026-11-05T14:00:00.000Z', // EST after Nov 1
      // 11-12 overridden below
      '2026-11-19T14:00:00.000Z',
    ]);
    const first = byTitle('Sim session')[0];
    expect(first.end - first.start).toBe(2 * 60 * 60 * 1000);
    expect(first.location).toBe('Training center');
    expect(first.allDay).toBe(false);
  });

  it('applies RECURRENCE-ID overrides', () => {
    const moved = byTitle('Sim session (moved)');
    expect(moved).toHaveLength(1);
    expect(new Date(moved[0].start).toISOString()).toBe('2026-11-12T15:30:00.000Z');
    expect(new Date(moved[0].end).toISOString()).toBe('2026-11-12T17:30:00.000Z');
    // Occurrence keys are unique
    const keys = parsed.events.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps all-day events as floating dates with an exclusive end', () => {
    const [vac] = byTitle('Vacation');
    expect(vac.allDay).toBe(true);
    expect(vac.startDate).toBe('2026-10-20');
    expect(vac.endDate).toBe('2026-10-23');
    // Instants are local midnight in the fallback (mirror) timezone
    expect(new Date(vac.start).toISOString()).toBe('2026-10-20T07:00:00.000Z');
    const [bday] = byTitle('Birthday');
    expect(bday.startDate).toBe('2026-10-21');
    expect(bday.endDate).toBe('2026-10-22');
  });

  it('resolves TZIDs without a VTIMEZONE via IANA names, floating times in the mirror timezone', () => {
    const [berlin] = byTitle('Call with Berlin');
    expect(new Date(berlin.start).toISOString()).toBe('2026-10-21T16:00:00.000Z'); // CEST +2
    const [utc] = byTitle('UTC meeting');
    expect(new Date(utc.end).toISOString()).toBe('2026-10-21T12:30:00.000Z');
    const [floating] = byTitle('Floating lunch');
    expect(new Date(floating.start).toISOString()).toBe('2026-10-22T19:00:00.000Z'); // PDT -7
  });

  it('drops cancelled events and events outside the window', () => {
    expect(byTitle('Cancelled')).toHaveLength(0);
    expect(byTitle('Long ago')).toHaveLength(0);
  });

  it('returns events sorted by start', () => {
    const starts = parsed.events.map((e) => e.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('rejects non-calendar input', () => {
    expect(() => parseIcs('<html>nope</html>', WINDOW, 'UTC')).toThrow(IcsParseError);
  });
});
