import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getInternalToken,
  internalHeaders,
  isValidInternalToken,
  loadOrCreateInternalToken,
  resetInternalTokenCache,
  INTERNAL_TOKEN_HEADER,
} from './internal-token.js';

describe('internal service token', () => {
  let dir: string;
  let file: string;
  const savedEnv = process.env.SKYGLASS_INTERNAL_TOKEN_FILE;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-token-'));
    file = path.join(dir, 'data', 'internal-token');
    process.env.SKYGLASS_INTERNAL_TOKEN_FILE = file;
    resetInternalTokenCache();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SKYGLASS_INTERNAL_TOKEN_FILE;
    else process.env.SKYGLASS_INTERNAL_TOKEN_FILE = savedEnv;
    resetInternalTokenCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates a 64-hex token with mode 0600 on first use', () => {
    const token = getInternalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(token);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // no temp files left behind
    expect(fs.readdirSync(path.dirname(file))).toEqual(['internal-token']);
  });

  it('reuses an existing token (e.g. created by the presence server)', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = 'a'.repeat(64);
    fs.writeFileSync(file, `${existing}\n`, { mode: 0o644 });
    expect(loadOrCreateInternalToken(file)).toBe(existing);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses a malformed token file instead of replacing it', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'short');
    expect(() => loadOrCreateInternalToken(file)).toThrow(/64-character hex/);
    expect(fs.readFileSync(file, 'utf8')).toBe('short');
  });

  it('validates supplied tokens', () => {
    const token = getInternalToken();
    expect(isValidInternalToken(token)).toBe(true);
    expect(isValidInternalToken(token.slice(0, 63) + (token[63] === 'a' ? 'b' : 'a'))).toBe(false);
    expect(isValidInternalToken('')).toBe(false);
    expect(isValidInternalToken(undefined)).toBe(false);
    expect(isValidInternalToken([token])).toBe(false);
    expect(internalHeaders()).toEqual({ [INTERNAL_TOKEN_HEADER]: token });
  });
});
