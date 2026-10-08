/**
 * License Server Database Module
 *
 * Handles database initialization and license operations.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolves to packages/license-server/data from both src/db and dist/db.
// Override with LICENSE_DATA_DIR for deployments that mount a volume.
const DATA_DIR = process.env.LICENSE_DATA_DIR || join(__dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'licenses.db');

let db: Database.Database | null = null;

// Type definitions
export interface DbLicense {
  id: string;
  license_key: string;
  email: string;
  stripe_payment_id: string | null;
  status: 'pending' | 'active' | 'revoked';
  device_fingerprint: string | null;
  device_fingerprint_type: string | null;
  device_mirror_id: string | null;
  activated_at: string | null;
  created_at: string;
}

/**
 * Initialize the database connection and run migrations
 */
export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[Database] Created data directory: ${DATA_DIR}`);
  }

  // Create database connection
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  console.log(`[Database] Connected to: ${DB_PATH}`);

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Get the database instance (must be initialized first)
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[Database] Connection closed');
  }
}

/**
 * Run database migrations
 */
function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Licenses table
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      license_key TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      stripe_payment_id TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
      device_fingerprint TEXT UNIQUE,
      device_fingerprint_type TEXT,
      device_mirror_id TEXT,
      activated_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Index for license key lookups
    CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);

    -- Index for device fingerprint lookups
    CREATE INDEX IF NOT EXISTS idx_licenses_fingerprint ON licenses(device_fingerprint);
  `);

  console.log('[Database] Migrations complete');
}

// License operations

/**
 * Create a new license
 */
export function createLicense(data: {
  id: string;
  licenseKey: string;
  email: string;
  stripePaymentId?: string;
}): DbLicense {
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO licenses (id, license_key, email, stripe_payment_id, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(data.id, data.licenseKey, data.email, data.stripePaymentId || null, now);

  return getLicenseById(data.id)!;
}

/**
 * Get a license by ID
 */
export function getLicenseById(id: string): DbLicense | null {
  return getDb().prepare('SELECT * FROM licenses WHERE id = ?').get(id) as DbLicense | null;
}

/**
 * Get a license by license key
 */
export function getLicenseByKey(licenseKey: string): DbLicense | null {
  return getDb().prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey) as DbLicense | null;
}

/**
 * Get a license by device fingerprint
 */
export function getLicenseByFingerprint(fingerprint: string): DbLicense | null {
  return getDb().prepare('SELECT * FROM licenses WHERE device_fingerprint = ?').get(fingerprint) as DbLicense | null;
}

/**
 * Activate a license (bind to device)
 */
export function activateLicense(
  licenseKey: string,
  deviceFingerprint: string,
  deviceFingerprintType: string,
  deviceMirrorId?: string
): DbLicense | null {
  const now = new Date().toISOString();

  const result = getDb().prepare(`
    UPDATE licenses
    SET status = 'active',
        device_fingerprint = ?,
        device_fingerprint_type = ?,
        device_mirror_id = ?,
        activated_at = ?
    WHERE license_key = ? AND status = 'pending'
  `).run(deviceFingerprint, deviceFingerprintType, deviceMirrorId || null, now, licenseKey);

  if (result.changes === 0) {
    return null;
  }

  return getLicenseByKey(licenseKey);
}

/**
 * Revoke a license
 */
export function revokeLicense(licenseKey: string): boolean {
  const result = getDb().prepare(`
    UPDATE licenses SET status = 'revoked' WHERE license_key = ?
  `).run(licenseKey);
  return result.changes > 0;
}

/**
 * Reset a license (unbind from device, allowing reactivation)
 */
export function resetLicense(licenseKey: string): boolean {
  const result = getDb().prepare(`
    UPDATE licenses
    SET status = 'pending',
        device_fingerprint = NULL,
        device_fingerprint_type = NULL,
        device_mirror_id = NULL,
        activated_at = NULL
    WHERE license_key = ?
  `).run(licenseKey);
  return result.changes > 0;
}

/**
 * Get all licenses (for admin)
 */
export function getAllLicenses(): DbLicense[] {
  return getDb().prepare('SELECT * FROM licenses ORDER BY created_at DESC').all() as DbLicense[];
}
