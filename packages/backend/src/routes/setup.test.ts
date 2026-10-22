import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeSetupStatus, hasEnrolledUsers, isStepCompleted, markStepCompleted } from './setup.js';

describe('face enrollment detection', () => {
  let dir: string;
  let users: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-face-'));
    users = path.join(dir, 'users');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is false when nothing is enrolled (users dir missing)', () => {
    expect(hasEnrolledUsers(users)).toBe(false);
  });

  it('ignores user dirs without an encodings file', () => {
    fs.mkdirSync(path.join(users, 'alice'), { recursive: true });
    fs.writeFileSync(path.join(users, 'alice', 'metadata.json'), '{}');
    expect(hasEnrolledUsers(users)).toBe(false);
  });

  it('is true when a user enrollment exists, even with an empty encodings list', () => {
    fs.mkdirSync(path.join(users, 'alice'), { recursive: true });
    // Empty-list pickle, what web_server.py writes without face_recognition
    fs.writeFileSync(path.join(users, 'alice', 'encodings.pkl'), Buffer.from([0x80, 0x04, 0x5d, 0x94, 0x2e]));
    expect(hasEnrolledUsers(users)).toBe(true);
  });
});

describe('setup step markers', () => {
  it('is not completed when no marker exists', () => {
    expect(isStepCompleted({}, 'airport')).toBe(false);
    expect(isStepCompleted({ setup: {} }, 'airport')).toBe(false);
    expect(isStepCompleted({ setup: { completed: 'airport' } }, 'airport')).toBe(false);
  });

  it('records steps idempotently and preserves other setup keys', () => {
    const config = { airport: 'KJFK', setup: { other: 1 } };
    markStepCompleted(config, 'airport');
    markStepCompleted(config, 'airport');
    markStepCompleted(config, 'location');
    expect(config.setup).toEqual({ other: 1, completed: ['airport', 'location'] });
    expect(isStepCompleted(config, 'airport')).toBe(true);
    expect(isStepCompleted(config, 'location')).toBe(true);
  });

  it('lets the default airport count as configured once chosen', () => {
    // Regression: KJFK is config/default.yaml's airport, and used to be
    // indistinguishable from "never set".
    const config = { airport: 'KJFK' };
    expect(isStepCompleted(config, 'airport')).toBe(false);
    markStepCompleted(config, 'airport');
    expect(isStepCompleted(config, 'airport')).toBe(true);
  });
});

describe('setup status', () => {
  const ready = { configExists: true, faceEnrolled: false, wifiConfigured: true, licenseActivated: true };

  it('ignores non-default values without a completion marker', () => {
    const status = computeSetupStatus(
      { airport: 'KSFO', location: { latitude: 37.6, longitude: -122.4 } },
      ready
    );
    expect(status.airportConfigured).toBe(false);
    expect(status.locationConfigured).toBe(false);
    expect(status.step).toBe('location');
  });

  it('walks wifi, license, location, airport, face in order', () => {
    expect(computeSetupStatus({}, { ...ready, wifiConfigured: false }).step).toBe('wifi');
    expect(computeSetupStatus({}, { ...ready, licenseActivated: false }).step).toBe('license');
    expect(computeSetupStatus({ setup: { completed: ['location'] } }, ready).step).toBe('airport');
    const both = { setup: { completed: ['location', 'airport'] } };
    expect(computeSetupStatus(both, ready).step).toBe('face');
    const done = computeSetupStatus(both, { ...ready, faceEnrolled: true });
    expect(done).toMatchObject({ step: 'complete', setupComplete: true, needsSetup: false });
  });

  it('returns camelCase fields only', () => {
    const status = computeSetupStatus(null, ready);
    expect(Object.keys(status).sort()).toEqual(
      [
        'airportConfigured',
        'configExists',
        'faceEnrolled',
        'licenseActivated',
        'locationConfigured',
        'needsSetup',
        'setupComplete',
        'step',
        'wifiConfigured',
      ].sort()
    );
  });
});
