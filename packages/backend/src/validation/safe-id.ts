/**
 * Safe identifier validation
 *
 * Any request-supplied identifier that ends up in a filesystem path or is
 * forwarded to another local service must pass through these helpers.
 * Express 5 URL-decodes route params, so values like `..%2F..%2Fsecret`
 * arrive as `../../secret` and must never be joined into a path unchecked.
 */

import path from 'path';

/** Allowlist: letters, digits, underscore, hyphen; 1-64 chars. */
export const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Returns true when `id` is a string matching SAFE_ID_PATTERN. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID_PATTERN.test(id);
}

/**
 * Resolve `${id}${ext}` inside `baseDir`, or return null if the id is not
 * allowlisted or the resolved path would escape `baseDir`.
 */
export function resolveSafePath(baseDir: string, id: unknown, ext = ''): string | null {
  if (!isSafeId(id)) return null;
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, `${id}${ext}`);
  const rel = path.relative(base, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    return null;
  }
  return resolved;
}
