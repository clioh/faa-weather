#!/usr/bin/env node
/**
 * Generate the Ed25519 keypair that signs SkyGlass activation tokens.
 *
 *   node scripts/license-keygen.mjs
 *
 * - LICENSE_SIGNING_KEY (private, PKCS8 PEM base64-encoded onto one line):
 *   set it on Vercel for the website project. Never commit it.
 * - Public key (SPKI PEM): paste into packages/backend/src/license/public-key.ts.
 *
 * Rotating the key invalidates every token mirrors hold; they recover at their
 * next refresh (daily) as long as they can reach the server.
 */
import { generateKeyPairSync } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })

console.log('# LICENSE_SIGNING_KEY (Vercel env var, keep secret):')
console.log(Buffer.from(privatePem, 'utf8').toString('base64'))
console.log()
console.log('# Public key for packages/backend/src/license/public-key.ts:')
console.log(publicPem.trim())
