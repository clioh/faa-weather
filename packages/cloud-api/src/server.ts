import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { testConnection } from './db/index.js';
import { clerkAuth, clerkConfigured } from './middleware/clerk.js';
import { relayService } from './services/relay.js';
import layoutsRouter from './routes/layouts.js';
import mirrorsRouter from './routes/mirrors.js';
import relayRouter from './routes/relay.js';

const app = express();
const server = createServer(app);

// Trust proxy for Railway
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(
  cors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Health check (no auth required, mounted before Clerk)
app.get('/api/health', async (_req, res) => {
  const dbHealthy = await testConnection();
  const status = dbHealthy ? 'healthy' : 'unhealthy';

  res.status(dbHealthy ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    database: dbHealthy ? 'connected' : 'disconnected',
    relay: {
      connectedMirrors: relayService.getConnectedMirrors().length,
    },
  });
});

// Clerk authentication
app.use(clerkAuth);

// API routes
app.use('/api/layouts', layoutsRouter);
app.use('/api/mirrors', mirrorsRouter);
app.use('/api/relay', relayRouter);

// 404 handler (Express 5 / path-to-regexp v8 rejects bare '*'; a '/api' prefix mount catches the rest)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize WebSocket relay
relayService.initialize(server);

// Start server. 3001 belongs to the mirror backend, so the cloud API defaults
// to 3003 to allow both to run locally.
const PORT = parseInt(process.env.PORT || '3003', 10);

server.listen(PORT, () => {
  console.log(`Cloud API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (!clerkConfigured) {
    console.warn(
      '[Cloud API] CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY are not set. ' +
        'Authenticated routes will return 503 until they are configured.'
    );
  }
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  relayService.shutdown();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server };
