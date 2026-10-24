import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import {
  ANDROID_CERT_SHA256,
  ANDROID_PACKAGE,
  APPLE_TEAM_ID,
  APP_LINK_PATHS,
  IOS_BUNDLE_ID,
} from './src/config/app'

const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/
const CERT_SHA256_PATTERN = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

interface WellKnownFile {
  /** Published path without the leading slash, e.g. ".well-known/assetlinks.json". */
  fileName: string
  body: string
}

/**
 * The app-link files from src/config/app.ts. A file whose identifiers aren't filled in yet is
 * left out (with a warning) rather than published half-empty: an invalid AASA or assetlinks
 * file is worse than none, since iOS and Android cache the result.
 */
function appLinkFiles(warn: (message: string) => void): WellKnownFile[] {
  const files: WellKnownFile[] = []

  if (APPLE_TEAM_ID && TEAM_ID_PATTERN.test(APPLE_TEAM_ID)) {
    const aasa = {
      applinks: {
        details: [
          {
            appIDs: [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`],
            components: APP_LINK_PATHS.map((linkPath) => ({ '/': linkPath })),
          },
        ],
      },
    }
    files.push({
      fileName: '.well-known/apple-app-site-association',
      body: `${JSON.stringify(aasa, null, 2)}\n`,
    })
  } else {
    warn(
      APPLE_TEAM_ID
        ? `APPLE_TEAM_ID "${APPLE_TEAM_ID}" is not a 10-character Team ID; not publishing apple-app-site-association`
        : 'APPLE_TEAM_ID is not set (src/config/app.ts); not publishing apple-app-site-association, so iOS Universal Links are off'
    )
  }

  const fingerprints = ANDROID_CERT_SHA256.filter((value) => {
    if (CERT_SHA256_PATTERN.test(value)) return true
    warn(`ignoring malformed ANDROID_CERT_SHA256 entry "${value}" (expected AB:CD:... upper-case)`)
    return false
  })
  if (fingerprints.length > 0) {
    const statements = [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]
    files.push({
      fileName: '.well-known/assetlinks.json',
      body: `${JSON.stringify(statements, null, 2)}\n`,
    })
  } else {
    warn(
      'ANDROID_CERT_SHA256 is empty (src/config/app.ts); not publishing assetlinks.json, so Android App Links are off'
    )
  }

  return files
}

/** Serve the generated files from the dev and preview servers, as Vercel serves dist/. */
function wellKnownMiddleware(files: WellKnownFile[]): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0]
    const file = files.find((f) => `/${f.fileName}` === pathname)
    if (!file) return next()
    res.setHeader('Content-Type', 'application/json')
    res.end(file.body)
  }
}

/** Writes /.well-known/apple-app-site-association and /.well-known/assetlinks.json. */
function appLinks(): Plugin {
  const warn = (message: string) => console.warn(`[app-links] warning: ${message}`)
  return {
    name: 'skyglass-app-links',
    configureServer(server) {
      server.middlewares.use(wellKnownMiddleware(appLinkFiles(warn)))
    },
    configurePreviewServer(server) {
      server.middlewares.use(wellKnownMiddleware(appLinkFiles(() => {})))
    },
    generateBundle() {
      for (const file of appLinkFiles((message) => this.warn(message))) {
        this.emitFile({ type: 'asset', fileName: file.fileName, source: file.body })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), appLinks()],
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
