/**
 * Calendar accounts storage (data/calendar-accounts.json).
 *
 * Holds OAuth tokens and passwords, so the file is written atomically with
 * mode 0600. Routes must only ever return `toPublicAccount(...)`.
 */

import fs from 'fs';
import path from 'path';
import type { CalendarAccount, StoredAccount } from './types.js';

const PROVIDERS = new Set(['google', 'microsoft', 'icloud', 'caldav', 'ics']);

function isStoredAccount(v: unknown): v is StoredAccount {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === 'string' &&
    typeof a.provider === 'string' &&
    PROVIDERS.has(a.provider) &&
    Array.isArray(a.calendars) &&
    !!a.secrets &&
    typeof a.secrets === 'object'
  );
}

/** Public shape: an explicit allowlist so new internal fields never leak. */
export function toPublicAccount(a: StoredAccount): CalendarAccount {
  return {
    id: a.id,
    provider: a.provider,
    label: a.label,
    email: a.email ?? null,
    status: a.status,
    error: a.error ?? null,
    lastSyncAt: a.lastSyncAt ?? null,
    createdAt: a.createdAt,
    calendars: a.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      enabled: c.enabled,
    })),
  };
}

export class CalendarAccountStore {
  private accounts: StoredAccount[] | null = null;

  constructor(private readonly filePath: string) {}

  private load(): StoredAccount[] {
    if (this.accounts) return this.accounts;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as { accounts?: unknown };
      this.accounts = Array.isArray(raw?.accounts) ? raw.accounts.filter(isStoredAccount) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error('[calendar] could not read accounts file:', (error as Error).message);
      }
      this.accounts = [];
    }
    return this.accounts;
  }

  private save(): void {
    const accounts = this.load();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, accounts }, null, 2), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600); // mode is ignored when the tmp file already existed
    fs.renameSync(tmp, this.filePath);
  }

  list(): StoredAccount[] {
    return [...this.load()];
  }

  get(id: string): StoredAccount | undefined {
    return this.load().find((a) => a.id === id);
  }

  add(account: StoredAccount): StoredAccount {
    this.load().push(account);
    this.save();
    return account;
  }

  /** Apply `mutate` to the stored account and persist. Returns undefined if it is gone. */
  update(id: string, mutate: (a: StoredAccount) => void): StoredAccount | undefined {
    const account = this.get(id);
    if (!account) return undefined;
    mutate(account);
    this.save();
    return account;
  }

  remove(id: string): StoredAccount | undefined {
    const accounts = this.load();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const [removed] = accounts.splice(idx, 1);
    this.save();
    return removed;
  }
}
