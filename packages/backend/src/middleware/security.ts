/**
 * Security Middleware
 *
 * Configures helmet.js for security headers including CSP, HSTS, X-Frame-Options, etc.
 */

import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * Security middleware with helmet.js configuration.
 * Allows unsafe-inline for setup wizard which uses inline scripts/styles.
 */
export const securityMiddleware: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for setup wizard
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for setup wizard
      // http://*:5000 = presence server MJPEG video feed (RegistrationOverlay)
      imgSrc: ["'self'", 'data:', 'blob:', 'http://*:5000', 'https://*:5000'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:'], // Allow WebSocket connections
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // The mirror is served over plain HTTP on the LAN / localhost (kiosk
      // loads http://localhost:3001), so do not force https subresources.
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false, // Disabled to allow loading external resources
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow CORS requests
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true, // X-Content-Type-Options: nosniff
  xFrameOptions: { action: 'deny' }, // X-Frame-Options: DENY
  xXssProtection: true, // X-XSS-Protection: 1; mode=block
});

export default securityMiddleware;
