/**
 * Internal service token shared with the presence/admin server
 * (packages/presence/security.py).
 *
 * A random 32-byte secret (64 hex chars) in <repo>/data/internal-token,
 * mode 0600; env SKYGLASS_INTERNAL_TOKEN_FILE overrides the path. Whichever
 * process needs it first creates it atomically (temp file + hard link, so a
 * concurrent creator never sees a partial file and never overwrites the
 * winner's token). The backend sends it as X-SkyGlass-Internal on calls to
 * the presence server; the presence server sends it back on its
 * notifications to the internal-only /api/registration/* endpoints.
 *
 * See docs/SECURITY.md.
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const INTERNAL_TOKEN_HEADER = 'X-SkyGlass-Internal';
const TOKEN_RE = /^[0-9a-f]{64}$/;

export function internalTokenPath(): string {
  return process.env.SKYGLASS_INTERNAL_TOKEN_FILE || path.resolve(__dirname, '../../../../data/internal-token');
}

function createTokenFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, `${randomBytes(32).toString('hex')}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(tmp, file);
  } catch (error) {
    // EEXIST: another process created it first; use theirs.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Read the token at `file`, creating it if missing. Throws on a malformed file. */
export function loadOrCreateInternalToken(file: string = internalTokenPath()): string {
  for (let attempt = 0; attempt < 3; attempt++) {
    let value: string;
    try {
      value = fs.readFileSync(file, 'utf8').trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      createTokenFile(file);
      continue;
    }
    if (!TOKEN_RE.test(value)) {
      throw new Error(
        `${file} does not contain a 64-character hex secret. ` +
          'Delete it and restart the backend and presence server to regenerate it.'
      );
    }
    try {
      if (fs.statSync(file).mode & 0o077) fs.chmodSync(file, 0o600);
    } catch {
      // best effort
    }
    return value;
  }
  throw new Error(`Could not create ${file}`);
}

const cache = new Map<string, string>();

export function getInternalToken(): string {
  const file = internalTokenPath();
  let token = cache.get(file);
  if (!token) {
    token = loadOrCreateInternalToken(file);
    cache.set(file, token);
  }
  return token;
}

/** For tests. */
export function resetInternalTokenCache(): void {
  cache.clear();
}

/** Headers for a call to the presence server. */
export function internalHeaders(): Record<string, string> {
  return { [INTERNAL_TOKEN_HEADER]: getInternalToken() };
}

/** Constant-time check of a supplied X-SkyGlass-Internal value. */
export function isValidInternalToken(supplied: string | string[] | undefined): boolean {
  if (typeof supplied !== 'string' || supplied.length === 0) return false;
  let expected: string;
  try {
    expected = getInternalToken();
  } catch (error) {
    console.error('[Security] Internal token unavailable:', error);
    return false;
  }
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
