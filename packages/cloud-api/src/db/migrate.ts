import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, closePool, testConnection } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations(): Promise<void> {
  console.log('Starting database migrations...');

  const connected = await testConnection();
  if (!connected) {
    console.error('Failed to connect to database');
    process.exit(1);
  }

  // Create migrations table if it doesn't exist
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get applied migrations
  const { rows: appliedMigrations } = await query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id'
  );
  const appliedSet = new Set(appliedMigrations.map((m) => m.name));

  // Get migration files
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  Skipping ${file} (already applied)`);
      continue;
    }

    console.log(`  Applying ${file}...`);
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    try {
      await query(sql);
      await query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`  Applied ${file}`);
    } catch (error) {
      console.error(`  Failed to apply ${file}:`, error);
      throw error;
    }
  }

  console.log('Migrations complete!');
  await closePool();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
