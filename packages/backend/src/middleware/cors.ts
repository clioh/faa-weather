/**
 * CORS Middleware
 *
 * Configures CORS with environment-based origin whitelisting.
 */

import cors from 'cors';
import type { CorsOptions } from 'cors';
import type { RequestHandler } from 'express';

/**
 * Allowed origins based on environment.
 */
const getAllowedOrigins = (): (string | RegExp)[] => {
  const origins: (string | RegExp)[] = [];

  // Always allow local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  origins.push(/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/);
  origins.push(/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/);
  origins.push(/^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/);

  // Allow localhost with any port
  origins.push(/^https?:\/\/localhost(:\d+)?$/);
  origins.push(/^https?:\/\/127\.0\.0\.1(:\d+)?$/);

  // Allow Capacitor (mobile app)
  origins.push('capacitor://localhost');
  origins.push('ionic://localhost');

  // Allow file:// protocol (for local development)
  origins.push('file://');

  if (process.env.NODE_ENV === 'development') {
    // Development-specific origins
    origins.push('http://localhost:3000'); // React dev server
    origins.push('http://localhost:5173'); // Vite dev server
    origins.push('http://localhost:8081'); // Metro bundler (React Native)
    origins.push('http://localhost:19000'); // Expo
    origins.push('http://localhost:19006'); // Expo web
  }

  if (process.env.NODE_ENV === 'production') {
    // Production-specific origins
    origins.push('https://skyglass.dev');
    origins.push(/^https:\/\/.*\.skyglass\.dev$/);
  }

  // Allow custom origins from environment
  const customOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (customOrigins) {
    customOrigins.split(',').forEach((origin) => {
      const trimmed = origin.trim();
      if (trimmed) {
        origins.push(trimmed);
      }
    });
  }

  return origins;
};

/**
 * Origin verification function.
 */
const verifyOrigin = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void => {
  // Allow requests with no origin (same-origin, curl, mobile apps, etc.)
  if (!origin) {
    callback(null, true);
    return;
  }

  const allowedOrigins = getAllowedOrigins();

  const isAllowed = allowedOrigins.some((allowed) => {
    if (typeof allowed === 'string') {
      return origin === allowed;
    }
    // RegExp matching
    return allowed.test(origin);
  });

  if (isAllowed) {
    callback(null, true);
  } else {
    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  }
};

/**
 * CORS configuration options.
 */
const corsOptions: CorsOptions = {
  origin: verifyOrigin,
  credentials: true, // Allow credentials (cookies, auth headers)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400, // 24 hours - cache preflight requests
  optionsSuccessStatus: 204, // Some legacy browsers choke on 204
};

/**
 * Configured CORS middleware.
 */
export const corsMiddleware: RequestHandler = cors(corsOptions);

export default corsMiddleware;
