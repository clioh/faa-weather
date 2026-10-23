import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  classifyNotam,
  filterNotamsByCategory,
  fetchNotamsResult,
  parseCloudNotams,
  NotamDataManager,
  type NotamData,
  type NotamFetchResult,
} from './notam.js';

describe('classifyNotam', () => {
  it.each([
    ['RWY 04L/22R CLSD', 'runway'],
    ['JFK RUNWAY 13R/31L CLOSED TO ACFT OVER 12500LBS', 'runway'],
    ['TWY B BTN RWY 4L AND TWY C CLSD', 'taxiway'],
    ['TAXIWAY K CLOSED', 'taxiway'],
    ['OBST CRANE (ASN 2026-AEA-123) 404058N0734732W (1.2NM SW JFK) 210FT AGL', 'obstacle'],
    ['TOWER 1234FT AMSL 2NM E LGTS OUT OF SERVICE', 'obstacle'],
    ['AIRSPACE UAS WI AN AREA DEFINED AS 1NM RADIUS', 'airspace'],
    ['PJE 5NM RADIUS OF XYZ SFC-FL180', 'airspace'],
    ['TFR SEE FDC 6/9169', 'airspace'],
    ['NAV ILS RWY 22L GS U/S', 'navaid'],
    ['ILS RWY 22L GS U/S', 'navaid'],
    ['VOR/DME OUT OF SERVICE', 'navaid'],
    ['NDB U/S', 'navaid'],
    ['IAP JOHN F KENNEDY INTL, NEW YORK, NY. ILS OR LOC RWY 22L, AMDT 5', 'approach'],
    ['SID KENNEDY FIVE DEPARTURE...', 'approach'],
    ['APCH LGT SYSTEM U/S', 'approach'],
    ['SVC FUEL UNAVBL', 'other'],
    ['AD AP BIRD ACT', 'other'],
    ['', 'other'],
  ])('%s → %s', (text, category) => {
    expect(classifyNotam(text)).toBe(category);
  });

  it('matches whole words only', () => {
    expect(classifyNotam('LOCAL TRAFFIC ADVISORY STARTING')).toBe('other');
    expect(classifyNotam('rwy 9 clsd')).toBe('runway');
  });
});

describe('filterNotamsByCategory', () => {
  const n = (id: string, description: string, classification = 'DOM'): NotamData =>
    ({
      id,
      type: 'N',
      classification,
      description,
      effectiveStart: new Date(0),
      effectiveEnd: null,
    }) as unknown as NotamData;
  const list = [
    n('1', 'RWY 4L CLSD'),
    n('2', 'TWY A CLSD'),
    n('3', 'OBST CRANE', 'FDC'),
    n('4', 'SVC FUEL UNAVBL'),
  ];

  it('filters by derived category (case-insensitive)', () => {
    expect(filterNotamsByCategory(list, ['Runway', 'obstacle']).map((x) => x.id)).toEqual([
      '1',
      '3',
    ]);
    expect(filterNotamsByCategory(list, ['other']).map((x) => x.id)).toEqual(['4']);
  });

  it('still accepts FAA classification codes', () => {
    expect(filterNotamsByCategory(list, ['FDC']).map((x) => x.id)).toEqual(['3']);
  });

  it('returns everything when no categories are given', () => {
    expect(filterNotamsByCategory(list, [])).toHaveLength(4);
  });
});

// ---------------------------------------------------------------- cloud fetch (mocked)

const CLOUD_BODY = {
  version: 1,
  icao: 'KSAN',
  fetchedAt: '2026-10-21T12:00:00.000Z',
  totalCount: 2,
  notams: [
    {
      id: 'N1',
      number: '10/123',
      type: 'N',
      classification: 'DOM',
      text: 'RWY 09/27 CLSD',
      effectiveStart: '2026-10-20T10:00:00.000Z',
      effectiveEnd: '2026-10-25T10:00:00.000Z',
      location: 'SAN',
      affectedFir: 'KZLA',
      schedule: null,
      minimumAltitude: null,
      maximumAltitude: null,
    },
    {
      id: 'N2',
      type: 'N',
      classification: 'FDC',
      text: 'OBST CRANE',
      effectiveStart: '2026-01-01T00:00:00.000Z',
      effectiveEnd: null,
      location: 'KSAN',
      affectedFir: '',
      schedule: 'DLY',
      minimumAltitude: 'FL050',
      maximumAltitude: 'FL180',
    },
    { id: 'BAD', effectiveStart: 'nope' },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(impl: (url: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return impl(String(input));
    })
  );
  return calls;
}

describe('fetchNotamsResult (SkyGlass service)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calls /api/data/notams with the canonical ICAO and no credentials, maps the body', async () => {
    const calls = stubFetch(() => json(200, CLOUD_BODY));
    const r = await fetchNotamsResult(' ksan ', 'https://skyglass.dev');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://skyglass.dev/api/data/notams?icao=KSAN');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(
      Object.keys(headers)
        .map((k) => k.toLowerCase())
        .sort()
    ).toEqual(['accept', 'user-agent']);
    expect(calls[0].url).not.toMatch(/client_id|client_secret|key/i);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notams).toHaveLength(2);
    expect(r.notams[0]).toEqual({
      id: 'N1',
      icao: 'KSAN',
      type: 'N',
      classification: 'DOM',
      description: 'RWY 09/27 CLSD',
      effectiveStart: new Date('2026-10-20T10:00:00.000Z'),
      effectiveEnd: new Date('2026-10-25T10:00:00.000Z'),
      location: 'SAN',
      affectedFir: 'KZLA',
      schedule: null,
      minimumAltitude: null,
      maximumAltitude: null,
    });
    expect(r.notams[1]).toMatchObject({
      effectiveEnd: null,
      minimumAltitude: 'FL050',
      maximumAltitude: 'FL180',
    });
    expect(classifyNotam(r.notams[1].description)).toBe('obstacle');
  });

  it('not_configured → no NOTAMs with a clear message', async () => {
    stubFetch(() => json(503, { error: 'not_configured' }));
    const r = await fetchNotamsResult('KSAN', 'https://skyglass.dev');
    expect(r).toMatchObject({ ok: false, reason: 'not_configured' });
    if (!r.ok) expect(r.message).toMatch(/no FAA NOTAM credentials/);
  });

  it('unreachable / 502 → unreachable', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await fetchNotamsResult('KSAN', 'https://skyglass.dev')).toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
    stubFetch(() => json(502, { error: 'upstream_unavailable' }));
    const r = await fetchNotamsResult('KSAN', 'https://skyglass.dev');
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
    if (!r.ok) expect(r.message).toMatch(/Can't reach the SkyGlass service/);
  });

  it('invalid config / ICAO and malformed bodies make no or harmless calls', async () => {
    const calls = stubFetch(() => json(200, { nope: true }));
    expect(await fetchNotamsResult('KSAN', null)).toMatchObject({
      ok: false,
      reason: 'invalid_config',
    });
    expect(await fetchNotamsResult('../x', 'https://skyglass.dev')).toMatchObject({
      ok: false,
      reason: 'invalid_icao',
    });
    expect(calls).toHaveLength(0);
    expect(await fetchNotamsResult('KSAN', 'https://skyglass.dev')).toMatchObject({
      ok: false,
      reason: 'bad_response',
    });
    expect(parseCloudNotams({ version: 2, notams: [] }, 'KSAN')).toBeNull();
  });
});

describe('NotamDataManager', () => {
  const N = (id: string): NotamData => ({
    id,
    icao: 'KSAN',
    type: 'N',
    classification: 'DOM',
    description: 'RWY 9 CLSD',
    effectiveStart: new Date(0),
    effectiveEnd: null,
    location: 'SAN',
    affectedFir: '',
    schedule: null,
    minimumAltitude: null,
    maximumAltitude: null,
  });

  it('caches success 30 min, serves last good list through failures, retries failures after 5 min', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let t = 0;
    const results: NotamFetchResult[] = [
      { ok: true, notams: [N('a')] },
      { ok: false, reason: 'unreachable', message: 'down' },
      { ok: false, reason: 'unreachable', message: 'down' },
    ];
    const fetcher = vi.fn(async () => results.shift()!);
    const m = new NotamDataManager(fetcher, () => t);
    expect((await m.getNotams('ksan')).map((n) => n.id)).toEqual(['a']);
    t += 10 * 60 * 1000;
    await m.getNotams('KSAN');
    expect(fetcher).toHaveBeenCalledTimes(1);
    t += 25 * 60 * 1000; // past TTL → refetch fails → stale good list
    expect((await m.getNotams('KSAN')).map((n) => n.id)).toEqual(['a']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    t += 60 * 1000; // within failure TTL
    await m.getNotams('KSAN');
    expect(fetcher).toHaveBeenCalledTimes(2);
    t += 5 * 60 * 1000;
    await m.getNotams('KSAN');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledTimes(1); // logged once per reason
  });

  it('returns [] when nothing good was ever fetched, and drops very old lists', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let t = 0;
    const m = new NotamDataManager(
      async () => ({ ok: false, reason: 'not_configured', message: 'x' }),
      () => t
    );
    expect(await m.getNotams('KSAN')).toEqual([]);
    const seq: NotamFetchResult[] = [{ ok: true, notams: [N('a')] }];
    const m2 = new NotamDataManager(
      async () => seq.shift() ?? { ok: false, reason: 'unreachable', message: 'x' },
      () => t
    );
    await m2.getNotams('KSAN');
    t += 7 * 60 * 60 * 1000;
    expect(await m2.getNotams('KSAN')).toEqual([]);
  });
});
