import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hasEnrolledUsers, isFaceEnrolled } from './setup.js';

describe('face enrollment detection', () => {
  let dir: string;
  let legacy: string;
  let users: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-face-'));
    legacy = path.join(dir, 'enrolled_face.pkl');
    users = path.join(dir, 'users');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is false when nothing is enrolled (users dir missing)', () => {
    expect(hasEnrolledUsers(users)).toBe(false);
    expect(isFaceEnrolled(legacy, users)).toBe(false);
  });

  it('is true for the legacy single-user file', () => {
    fs.writeFileSync(legacy, 'x');
    expect(isFaceEnrolled(legacy, users)).toBe(true);
  });

  it('ignores user dirs without encodings', () => {
    fs.mkdirSync(path.join(users, 'alice'), { recursive: true });
    fs.writeFileSync(path.join(users, 'alice', 'metadata.json'), '{}');
    expect(hasEnrolledUsers(users)).toBe(false);
    expect(isFaceEnrolled(legacy, users)).toBe(false);
  });

  it('is true when a multi-user enrollment has encodings', () => {
    fs.mkdirSync(path.join(users, 'alice'), { recursive: true });
    fs.writeFileSync(path.join(users, 'alice', 'encodings.pkl'), 'x');
    expect(hasEnrolledUsers(users)).toBe(true);
    expect(isFaceEnrolled(legacy, users)).toBe(true);
  });
});
