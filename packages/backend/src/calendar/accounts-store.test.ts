import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CalendarAccountStore, toPublicAccount } from './accounts-store.js';
import type { StoredAccount } from './types.js';

function account(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id: 'acc-1',
    provider: 'google',
    label: 'Google',
    email: 'pilot@example.com',
    status: 'ok',
    error: null,
    lastSyncAt: null,
    createdAt: '2026-10-21T00:00:00.000Z',
    calendars: [
      {
        id: 'primary',
        name: 'Pilot',
        color: '#7ad7ff',
        enabled: true,
        primary: true,
        colorLocked: true,
        url: 'https://x/y',
      },
    ],
    secrets: {
      accessToken: 'ya29.secret',
      refreshToken: '1//refresh-secret',
      expiresAt: 123,
      password: 'pw',
    },
    discoveredAt: 1,
    ...overrides,
  };
}

describe('CalendarAccountStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-cal-'));
    file = path.join(dir, 'nested', 'calendar-accounts.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('public shape has exactly the contract fields and no secrets', () => {
    const pub = toPublicAccount(account());
    expect(Object.keys(pub).sort()).toEqual(
      [
        'calendars',
        'createdAt',
        'email',
        'error',
        'id',
        'label',
        'lastSyncAt',
        'provider',
        'status',
      ].sort()
    );
    expect(Object.keys(pub.calendars[0]).sort()).toEqual(['color', 'enabled', 'id', 'name']);
    const json = JSON.stringify(pub);
    for (const secret of ['ya29.secret', 'refresh-secret', '"pw"', 'https://x/y', 'secrets']) {
      expect(json).not.toContain(secret);
    }
  });

  it('persists atomically with mode 0600 and reloads', () => {
    const store = new CalendarAccountStore(file);
    store.add(account());
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // no temp files left behind
    expect(fs.readdirSync(path.dirname(file))).toEqual(['calendar-accounts.json']);

    store.update('acc-1', (a) => {
      a.label = 'Work';
    });
    const reloaded = new CalendarAccountStore(file);
    expect(reloaded.get('acc-1')?.label).toBe('Work');
    expect(reloaded.get('acc-1')?.secrets.refreshToken).toBe('1//refresh-secret');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    expect(reloaded.remove('acc-1')?.id).toBe('acc-1');
    expect(new CalendarAccountStore(file).list()).toEqual([]);
  });

  it('treats a missing or corrupt file as empty and skips invalid entries', () => {
    expect(new CalendarAccountStore(file).list()).toEqual([]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    expect(new CalendarAccountStore(file).list()).toEqual([]);
    fs.writeFileSync(
      file,
      JSON.stringify({ accounts: [account(), { id: 'x', provider: 'bogus' }] })
    );
    expect(new CalendarAccountStore(file).list().map((a) => a.id)).toEqual(['acc-1']);
  });
});
