import { query } from '../db/index.js';
import type { SyncPushInput } from '../validation/schemas.js';

interface SyncedLayout {
  id: string;
  name: string;
  modules: unknown[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface SyncResult {
  updated: SyncedLayout[];
  conflicts: { localId: string; serverVersion: number }[];
}

// Get layouts that have changed since a given timestamp
export async function getLayoutChangesSince(
  clerkId: string,
  since: Date | null
): Promise<SyncedLayout[]> {
  let queryText: string;
  let params: unknown[];

  if (since) {
    queryText = `
      SELECT id, name, modules, is_active, version, created_at, updated_at
      FROM user_layouts
      WHERE clerk_id = $1 AND updated_at > $2
      ORDER BY updated_at DESC
    `;
    params = [clerkId, since.toISOString()];
  } else {
    queryText = `
      SELECT id, name, modules, is_active, version, created_at, updated_at
      FROM user_layouts
      WHERE clerk_id = $1
      ORDER BY updated_at DESC
    `;
    params = [clerkId];
  }

  const { rows } = await query<{
    id: string;
    name: string;
    modules: unknown[];
    is_active: boolean;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(queryText, params);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    modules: row.modules,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

// Push local changes to cloud with conflict detection
export async function pushLayoutChanges(
  clerkId: string,
  changes: SyncPushInput
): Promise<SyncResult> {
  const updated: SyncedLayout[] = [];
  const conflicts: { localId: string; serverVersion: number }[] = [];

  for (const layout of changes.layouts) {
    // Check if layout exists and get current version
    const { rows: existing } = await query<{ version: number }>(
      'SELECT version FROM user_layouts WHERE id = $1 AND clerk_id = $2',
      [layout.id, clerkId]
    );

    if (layout.deleted) {
      // Handle deletion
      if (existing.length > 0) {
        await query('DELETE FROM user_layouts WHERE id = $1 AND clerk_id = $2', [
          layout.id,
          clerkId,
        ]);
      }
      continue;
    }

    if (existing.length === 0) {
      // New layout - insert
      const { rows } = await query<{
        id: string;
        name: string;
        modules: unknown[];
        is_active: boolean;
        version: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO user_layouts (id, clerk_id, name, modules, is_active, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id, name, modules, is_active, version, created_at, updated_at`,
        [
          layout.id,
          clerkId,
          layout.name,
          JSON.stringify(layout.modules),
          layout.isActive,
          layout.version,
        ]
      );

      // If this layout is active, deactivate others
      if (layout.isActive) {
        await query('UPDATE user_layouts SET is_active = FALSE WHERE clerk_id = $1 AND id != $2', [
          clerkId,
          layout.id,
        ]);
      }

      updated.push({
        id: rows[0].id,
        name: rows[0].name,
        modules: rows[0].modules,
        isActive: rows[0].is_active,
        version: rows[0].version,
        createdAt: rows[0].created_at.toISOString(),
        updatedAt: rows[0].updated_at.toISOString(),
      });
    } else if (existing[0].version < layout.version) {
      // Local version is newer - update
      const { rows } = await query<{
        id: string;
        name: string;
        modules: unknown[];
        is_active: boolean;
        version: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE user_layouts
         SET name = $3, modules = $4, is_active = $5, version = $6, updated_at = NOW()
         WHERE id = $1 AND clerk_id = $2
         RETURNING id, name, modules, is_active, version, created_at, updated_at`,
        [
          layout.id,
          clerkId,
          layout.name,
          JSON.stringify(layout.modules),
          layout.isActive,
          layout.version,
        ]
      );

      // If this layout is active, deactivate others
      if (layout.isActive) {
        await query('UPDATE user_layouts SET is_active = FALSE WHERE clerk_id = $1 AND id != $2', [
          clerkId,
          layout.id,
        ]);
      }

      updated.push({
        id: rows[0].id,
        name: rows[0].name,
        modules: rows[0].modules,
        isActive: rows[0].is_active,
        version: rows[0].version,
        createdAt: rows[0].created_at.toISOString(),
        updatedAt: rows[0].updated_at.toISOString(),
      });
    } else if (existing[0].version > layout.version) {
      // Server version is newer - conflict
      conflicts.push({
        localId: layout.id,
        serverVersion: existing[0].version,
      });
    }
    // If versions are equal, no update needed
  }

  return { updated, conflicts };
}
