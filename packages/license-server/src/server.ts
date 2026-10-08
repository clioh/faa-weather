/**
 * License Server
 *
 * Central API for license activation and validation.
 * Designed to deploy on Vercel, Railway, or any Node.js host.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initDatabase, closeDatabase } from './db/index.js';
import licenseRoutes from './routes/licenses.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// Stricter rate limit for activation endpoint
const activationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 activation attempts per hour
  message: { error: 'Too many activation attempts, please try again later' },
});
app.use('/api/v1/licenses/activate', activationLimiter);

// API Routes
app.use('/api/v1/licenses', licenseRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'SkyGlass License Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      activate: 'POST /api/v1/licenses/activate',
      create: 'POST /api/v1/licenses',
      reset: 'POST /api/v1/licenses/reset',
      list: 'GET /api/v1/licenses',
      status: 'GET /api/v1/licenses/:key/status',
    },
  });
});

const PORT = process.env.PORT || 3002;

async function start() {
  // Initialize database
  try {
    initDatabase();
    console.log('[License Server] Database initialized');
  } catch (error) {
    console.error('[License Server] Failed to initialize database:', error);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[License Server] Running on http://localhost:${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[License Server] Shutting down...');
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[License Server] Shutting down...');
  closeDatabase();
  process.exit(0);
});

start().catch(console.error);
