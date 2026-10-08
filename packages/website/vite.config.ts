import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // The mirror UI (packages/frontend) owns 5173; keep the marketing site off it
  // so `npm run dev` gives each a predictable port.
  server: {
    port: 5174,
  },
  resolve: {
    // Workspace hoisting leaves React 18 at the repo root (pulled in by other
    // packages' deps) while this package uses React 19. Force every import of
    // react to resolve to this package's copy so libraries such as
    // react-helmet-async don't render elements from a second React.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
