/**
 * SQLite Database Module
 *
 * Handles database initialization, migrations, and provides access to the database.
 * Uses better-sqlite3 for synchronous, performant SQLite operations.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { hostname } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../../../data');
const DB_PATH = join(DATA_DIR, 'skyglass.db');

let db: Database.Database | null = null;

// Type definitions
export interface DbUser {
  id: string;
  name: string;
  preferences: string; // JSON string
  created_at: string;
  updated_at: string;
  last_seen: string | null;
}

export interface DbUserLayout {
  id: string;
  user_id: string;
  name: string;
  modules: string; // JSON string
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface DbMirrorSetting {
  key: string;
  value: string;
}

/** Single-row license state (see src/license/manager.ts). */
export interface DbLicenseState {
  license_key: string | null;
  token: string | null;
  state: string;
  activated_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
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

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  console.log(`[Database] Connected to: ${DB_PATH}`);

  // Run migrations
  runMigrations(db);

  // Ensure mirror has an ID
  ensureMirrorIdentity(db);

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
 * Run database migrations
 */
function runMigrations(db: Database.Database): void {
  // Create tables if they don't exist
  db.exec(`
    -- Users table: stores user profiles from mobile apps
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      preferences TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen TEXT
    );

    -- User layouts: each user can have multiple layouts
    CREATE TABLE IF NOT EXISTS user_layouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Default',
      modules TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Mirror settings: key-value store for mirror configuration
    CREATE TABLE IF NOT EXISTS mirror_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Create indexes for better query performance
    CREATE INDEX IF NOT EXISTS idx_user_layouts_user_id ON user_layouts(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_layouts_active ON user_layouts(user_id, is_active);

    -- License: the key entered from the app (or picked up from the SD card),
    -- the last signed activation token and the derived state.
    DROP TABLE IF EXISTS license_cache;
    DELETE FROM mirror_settings WHERE key = 'licenseKey';
    CREATE TABLE IF NOT EXISTS license_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      license_key TEXT,
      token TEXT,
      state TEXT NOT NULL DEFAULT 'unlicensed',
      activated_at TEXT,
      last_checked_at TEXT,
      last_error TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('[Database] Migrations complete');
}

/**
 * Ensure the mirror has a unique identity
 */
function ensureMirrorIdentity(db: Database.Database): void {
  const existing = db.prepare('SELECT value FROM mirror_settings WHERE key = ?').get('mirrorId') as DbMirrorSetting | undefined;

  if (!existing) {
    const mirrorId = uuidv4();
    const mirrorName = `SkyGlass-${hostname().split('.')[0]}`;

    db.prepare('INSERT INTO mirror_settings (key, value) VALUES (?, ?)').run('mirrorId', mirrorId);
    db.prepare('INSERT INTO mirror_settings (key, value) VALUES (?, ?)').run('mirrorName', mirrorName);

    console.log(`[Database] Generated mirror identity: ${mirrorId} (${mirrorName})`);
  }
}

/**
 * Get mirror ID
 */
export function getMirrorId(): string {
  const row = getDb().prepare('SELECT value FROM mirror_settings WHERE key = ?').get('mirrorId') as DbMirrorSetting;
  return row?.value || 'unknown';
}

/**
 * Get mirror name
 */
export function getMirrorName(): string {
  const row = getDb().prepare('SELECT value FROM mirror_settings WHERE key = ?').get('mirrorName') as DbMirrorSetting;
  return row?.value || 'SkyGlass';
}

// User operations

/**
 * Create or update a user
 */
export function upsertUser(id: string, name: string, preferences: Record<string, unknown> = {}): DbUser {
  const db = getDb();
  const now = new Date().toISOString();
  const prefsJson = JSON.stringify(preferences);

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);

  if (existing) {
    db.prepare(`
      UPDATE users SET name = ?, preferences = ?, updated_at = ?
      WHERE id = ?
    `).run(name, prefsJson, now, id);
  } else {
    db.prepare(`
      INSERT INTO users (id, name, preferences, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, prefsJson, now, now);

    // Create default layout for new user
    createDefaultLayout(id);
  }

  return getUser(id)!;
}

/**
 * Get a user by ID
 */
export function getUser(id: string): DbUser | null {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | null;
}

/**
 * Get all users
 */
export function getAllUsers(): DbUser[] {
  return getDb().prepare('SELECT * FROM users ORDER BY name').all() as DbUser[];
}

/**
 * Delete a user
 */
export function deleteUser(id: string): boolean {
  const result = getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Update user's last seen timestamp
 */
export function updateUserLastSeen(id: string): void {
  getDb().prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), id);
}

// Layout operations

/**
 * Create default layout for a user
 */
function createDefaultLayout(userId: string): void {
  const layoutId = uuidv4();
  const defaultModules = [
    {
      instanceId: 'clock-default',
      moduleId: 'digital-clock',
      position: { x: 0, y: 0 },
      size: 'medium',
      config: { showZulu: true },
    },
    {
      instanceId: 'aviation-default',
      moduleId: 'aviation-weather',
      position: { x: 2, y: 0 },
      size: 'large',
      config: {},
    },
  ];

  getDb().prepare(`
    INSERT INTO user_layouts (id, user_id, name, modules, is_active)
    VALUES (?, ?, 'Default', ?, 1)
  `).run(layoutId, userId, JSON.stringify(defaultModules));
}

/**
 * Get user's active layout
 */
export function getUserActiveLayout(userId: string): DbUserLayout | null {
  return getDb().prepare(`
    SELECT * FROM user_layouts WHERE user_id = ? AND is_active = 1
  `).get(userId) as DbUserLayout | null;
}

/**
 * Get all layouts for a user
 */
export function getUserLayouts(userId: string): DbUserLayout[] {
  return getDb().prepare(`
    SELECT * FROM user_layouts WHERE user_id = ? ORDER BY name
  `).all(userId) as DbUserLayout[];
}

/**
 * Update a layout's modules
 */
export function updateLayoutModules(layoutId: string, modules: unknown[]): boolean {
  const result = getDb().prepare(`
    UPDATE user_layouts SET modules = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(modules), new Date().toISOString(), layoutId);
  return result.changes > 0;
}

/**
 * Set a layout as active for a user (deactivates others)
 */
export function setActiveLayout(userId: string, layoutId: string): boolean {
  const db = getDb();

  // Deactivate all user layouts
  db.prepare('UPDATE user_layouts SET is_active = 0 WHERE user_id = ?').run(userId);

  // Activate the specified layout
  const result = db.prepare('UPDATE user_layouts SET is_active = 1 WHERE id = ? AND user_id = ?').run(layoutId, userId);
  return result.changes > 0;
}

/**
 * Create a new layout for a user
 */
export function createLayout(userId: string, name: string, modules: unknown[] = []): DbUserLayout {
  const layoutId = uuidv4();
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO user_layouts (id, user_id, name, modules, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(layoutId, userId, name, JSON.stringify(modules), now, now);

  return getDb().prepare('SELECT * FROM user_layouts WHERE id = ?').get(layoutId) as DbUserLayout;
}

/**
 * Delete a layout
 */
export function deleteLayout(layoutId: string): boolean {
  const result = getDb().prepare('DELETE FROM user_layouts WHERE id = ?').run(layoutId);
  return result.changes > 0;
}

// License operations

export function getLicenseState(): DbLicenseState | null {
  const row = getDb()
    .prepare(
      'SELECT license_key, token, state, activated_at, last_checked_at, last_error FROM license_state WHERE id = 1'
    )
    .get() as DbLicenseState | undefined;
  return row ?? null;
}

export function saveLicenseState(record: DbLicenseState): void {
  getDb()
    .prepare(
      `INSERT INTO license_state (id, license_key, token, state, activated_at, last_checked_at, last_error, updated_at)
       VALUES (1, @license_key, @token, @state, @activated_at, @last_checked_at, @last_error, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         license_key = excluded.license_key,
         token = excluded.token,
         state = excluded.state,
         activated_at = excluded.activated_at,
         last_checked_at = excluded.last_checked_at,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`
    )
    .run({ ...record, updated_at: new Date().toISOString() });
}
