/**
 * Rate Limiting Middleware
 *
 * Configures rate limiters for different endpoint types.
 */

import rateLimit from 'express-rate-limit';
import type { Options } from 'express-rate-limit';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * True for loopback client addresses. The mirror display (kiosk browser),
 * presence detector and admin portal all run on the device itself, so their
 * requests always arrive from loopback and must never be throttled.
 *
 * NOTE: server.ts sets `trust proxy` to 'loopback', so for requests forwarded
 * by a local nginx `req.ip` is the real client address from X-Forwarded-For,
 * not 127.0.0.1. Only genuinely local clients are exempted.
 */
export function isLoopbackIp(ip: string | undefined | null): boolean {
  return !!ip && LOOPBACK_ADDRESSES.has(ip);
}

/**
 * Common options for all rate limiters.
 */
const commonOptions: Partial<Options> = {
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    error: 'Too many requests',
    message: 'Please try again later',
  },
  // Always skip rate limiting for on-device (loopback) clients, in every NODE_ENV
  skip: (req) => isLoopbackIp(req.ip || req.socket.remoteAddress),
};

/**
 * Standard rate limiter for general API routes.
 * 600 requests per 15 minutes per client IP (LAN appliance: phones/tablets
 * polling setup/progress screens). Local clients are exempt (see above).
 */
export const standardLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // Limit each IP to 600 requests per window
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again in a few minutes.',
  },
});

/**
 * Config-write rate limiter for setup endpoints (airport/location) used by
 * the mobile setup flow. 30 requests per 15 minutes.
 */
export const configWriteLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: {
    error: 'Too many configuration changes',
    message: 'Please wait before trying again.',
  },
});

/**
 * Auth rate limiter for authentication/registration endpoints.
 * 5 requests per 15 minutes.
 */
export const authLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per window
  message: {
    error: 'Too many authentication attempts',
    message: 'Please wait before trying again.',
  },
});

/**
 * Upload rate limiter for file upload endpoints.
 * 10 requests per hour.
 */
export const uploadLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 uploads per hour
  message: {
    error: 'Too many uploads',
    message: 'Upload limit exceeded. Please try again later.',
  },
});

/**
 * Critical rate limiter for sensitive operations.
 * 3 requests per hour.
 */
export const criticalLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 requests per hour
  message: {
    error: 'Too many requests for this operation',
    message: 'This operation is rate-limited. Please try again later.',
  },
});

export default {
  standardLimiter,
  configWriteLimiter,
  authLimiter,
  uploadLimiter,
  criticalLimiter,
};
