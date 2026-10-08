import { describe, it, expect } from 'vitest';
import { isLoopbackIp } from './rateLimiter.js';

describe('isLoopbackIp', () => {
  it('treats IPv4, IPv6 and IPv4-mapped loopback as local', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('::1')).toBe(true);
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('does not exempt LAN or empty addresses', () => {
    expect(isLoopbackIp('192.168.1.20')).toBe(false);
    expect(isLoopbackIp('::ffff:192.168.1.20')).toBe(false);
    expect(isLoopbackIp('10.42.0.5')).toBe(false);
    expect(isLoopbackIp('')).toBe(false);
    expect(isLoopbackIp(undefined)).toBe(false);
    expect(isLoopbackIp(null)).toBe(false);
  });
});
