import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend to proxy API and WebSocket calls to during `vite dev`.
// Override with VITE_BACKEND_URL to point the dev UI at another backend.
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
        // Backend auth treats loopback as the trusted kiosk; forward the real
        // client address so LAN browsers hitting :5173 are not "local".
        xfwd: true,
      },
      '/ws': {
        target: backendWsUrl,
        ws: true,
        xfwd: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
