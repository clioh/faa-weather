/**
 * PM2 Ecosystem Configuration
 * Manages all SkyGlass processes
 *
 * Usage:
 *   pm2 start config/pm2.config.cjs   (or: npm start)
 *   pm2 stop all
 *   pm2 restart all
 *   pm2 logs
 *
 * This is the single source of truth for PM2 apps. PM2 is the only process
 * manager (systemd only runs the boot-mode, provisioning and watchdog units).
 * mDNS (_skyglass._tcp) is advertised by skyglass-backend itself.
 *
 * The display UI (packages/frontend/dist) is served by skyglass-backend on port
 * 3001 together with /api and /ws, so there is no separate frontend app.
 */

const path = require('path');
// Default to the checkout this file lives in (config/..), so PM2 works from
// any install location; SKYGLASS_DIR overrides it.
const INSTALL_DIR = process.env.SKYGLASS_DIR || path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'skyglass-backend',
      script: 'dist/server.js',
      cwd: path.join(INSTALL_DIR, 'packages/backend'),
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // Serve packages/frontend/dist (SPA) from the backend
        SKYGLASS_SERVE_FRONTEND: '1',
      },
      // Restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(INSTALL_DIR, 'logs/backend-error.log'),
      out_file: path.join(INSTALL_DIR, 'logs/backend-out.log'),
      merge_logs: true,
      // Watch for changes (disable in production)
      watch: false,
    },

    {
      name: 'skyglass-detector',
      script: 'detector.py',
      cwd: path.join(INSTALL_DIR, 'packages/presence'),
      interpreter: path.join(INSTALL_DIR, 'packages/presence/venv/bin/python'),
      args: '--backend http://localhost:3001',
      env: {
        PYTHONUNBUFFERED: '1',
      },
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(INSTALL_DIR, 'logs/detector-error.log'),
      out_file: path.join(INSTALL_DIR, 'logs/detector-out.log'),
      merge_logs: true,
      watch: false,
    },

    {
      name: 'skyglass-admin',
      script: path.join(INSTALL_DIR, 'packages/presence/venv/bin/gunicorn'),
      cwd: path.join(INSTALL_DIR, 'packages/presence'),
      args: '-c gunicorn.conf.py wsgi:app',
      env: {
        PYTHONUNBUFFERED: '1',
        PORT: 5000,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(INSTALL_DIR, 'logs/admin-error.log'),
      out_file: path.join(INSTALL_DIR, 'logs/admin-out.log'),
      merge_logs: true,
      watch: false,
    },
  ],
};
