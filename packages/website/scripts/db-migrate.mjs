#!/usr/bin/env node
/**
 * Apply db/schema.sql to the Neon database in DATABASE_URL.
 *
 *   DATABASE_URL=postgres://… npm run db:migrate --workspace=packages/website
 *
 * The schema is idempotent (CREATE … IF NOT EXISTS, ALTER TABLE … ADD COLUMN IF NOT
 * EXISTS), so running it again is safe and upgrades an older database in place.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy it from the Neon dashboard or `vercel env pull`.')
  process.exit(1)
}

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql')
const statements = readFileSync(schemaPath, 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter(Boolean)

const sql = neon(url)
try {
  // One HTTP transaction, so a failure leaves the database unchanged.
  await sql.transaction(statements.map((s) => sql.query(s)))
  console.log(`Applied ${statements.length} statements from db/schema.sql`)
} catch (err) {
  console.error('Migration failed:', err.message)
  process.exit(1)
}
