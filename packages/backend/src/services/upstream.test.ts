import { describe, it, expect, vi } from 'vitest';
import { TtlCache, UpstreamError, upstreamErrorResponse } from './upstream.js';

describe('TtlCache', () => {
  it('caches within the TTL', async () => {
    const cache = new TtlCache<number>(1000);
    const loader = vi.fn().mockResolvedValue(1);
    await cache.get('k', loader);
    await cache.get('k', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('serves stale data when the upstream fails after expiry', async () => {
    const cache = new TtlCache<number>(1000);
    cache.set('k', 7, Date.now() - 5000);
    const result = await cache.get('k', () => Promise.reject(new Error('boom')));
    expect(result).toMatchObject({ value: 7, stale: true });
  });

  it('wraps raw errors when nothing is cached', async () => {
    const cache = new TtlCache<number>(1000);
    const err = await cache.get('k', () => Promise.reject(new Error('ECONNRESET 10.0.0.1:443'))).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).not.toContain('10.0.0.1');
  });

  it('de-duplicates concurrent loads', async () => {
    const cache = new TtlCache<number>(1000);
    const loader = vi.fn(() => new Promise<number>((r) => setTimeout(() => r(3), 10)));
    const [a, b] = await Promise.all([cache.get('k', loader), cache.get('k', loader)]);
    expect(a.value).toBe(3);
    expect(b.value).toBe(3);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('evicts beyond maxEntries', async () => {
    const cache = new TtlCache<number>(1000, 1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    const loader = vi.fn().mockResolvedValue(9);
    expect((await cache.get('a', loader)).value).toBe(9);
  });
});

describe('upstreamErrorResponse', () => {
  it('never exposes non-upstream error text', () => {
    expect(upstreamErrorResponse(new Error('secret'), 'Failed')).toEqual({ status: 502, body: { error: 'Failed' } });
    expect(upstreamErrorResponse(new UpstreamError('Upstream timed out', 504), 'Failed')).toEqual({
      status: 504,
      body: { error: 'Failed: Upstream timed out' },
    });
  });
});
