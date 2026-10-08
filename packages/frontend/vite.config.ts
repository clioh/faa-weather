import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend to proxy API and WebSocket calls to during `vite dev`.
// Override with VITE_BACKEND_URL (e.g. http://backend:3001 inside docker-compose.dev.yml).
const backendUrl = process.env.VITE_BACKEND_URL || 'http://localhost:3001';
const backendWsUrl = backendUrl.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Workspace hoisting leaves React 18 at the repo root (qrcode.react etc.)
    // while this package uses React 19; keep a single React instance.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWsUrl,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
