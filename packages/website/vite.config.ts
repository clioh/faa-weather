import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { getCatalogProduct } from './shared/catalog'

/**
 * Fills `{{CATALOG_PRICE_USD:<product-id>}}` in index.html (structured data)
 * from shared/catalog.ts so the static HTML never carries its own price.
 */
function catalogHtml(): Plugin {
  return {
    name: 'skyglass-catalog-html',
    transformIndexHtml(html) {
      return html.replace(/\{\{CATALOG_PRICE_USD:([a-z-]+)\}\}/g, (_, id: string) => {
        const product = getCatalogProduct(id)
        if (!product) throw new Error(`index.html: unknown catalog product "${id}"`)
        return String(product.priceCents / 100)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), catalogHtml()],
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
