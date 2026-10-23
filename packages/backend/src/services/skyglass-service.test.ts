import { describe, it, expect, afterEach, vi } from 'vitest';
import { getSkyglassJson, normalizeServiceUrl, skyglassServiceUrl } from './skyglass-service.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('skyglassServiceUrl', () => {
  it('defaults, normalizes and rejects', () => {
    expect(skyglassServiceUrl({})).toBe('https://skyglass.dev');
    expect(skyglassServiceUrl({ skyglass_service: '  ' })).toBe('https://skyglass.dev');
    expect(skyglassServiceUrl({ skyglass_service: 'https://self.example/' })).toBe(
      'https://self.example'
    );
    expect(skyglassServiceUrl({ skyglass_service: 'http://localhost:3000' })).toBe(
      'http://localhost:3000'
    );
    expect(skyglassServiceUrl({ skyglass_service: 'http://skyglass.dev' })).toBeNull();
    expect(normalizeServiceUrl('${SKYGLASS}')).toBeNull();
  });
});

describe('getSkyglassJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps statuses to failure reasons', async () => {
    const cases: Array<[Response | Error, unknown]> = [
      [json(200, { a: 1 }), { ok: true, json: { a: 1 } }],
      [new Response('<html>', { status: 200 }), { ok: false, reason: 'bad_response', status: 200 }],
      [
        json(503, { error: 'not_configured' }),
        { ok: false, reason: 'not_configured', status: 503 },
      ],
      [json(503, { error: 'other' }), { ok: false, reason: 'unreachable', status: 503 }],
      [
        json(502, { error: 'upstream_unavailable' }),
        { ok: false, reason: 'unreachable', status: 502 },
      ],
      [json(429, { error: 'rate_limited' }), { ok: false, reason: 'rate_limited', status: 429 }],
      [json(400, { error: 'invalid_request' }), { ok: false, reason: 'rejected', status: 400 }],
      [new TypeError('fetch failed'), { ok: false, reason: 'unreachable' }],
    ];
    for (const [res, expected] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (res instanceof Error) throw res;
          return res;
        })
      );
      expect(await getSkyglassJson('https://skyglass.dev', '/api/data/x')).toEqual(expected);
    }
    expect(await getSkyglassJson(null, '/api/data/x')).toEqual({
      ok: false,
      reason: 'invalid_config',
    });
  });
});
