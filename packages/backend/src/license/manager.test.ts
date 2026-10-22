import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LicenseManager, type LicenseRecord, type LicenseStatus } from './manager.js';
import { generateKeyPairSync, sign, type KeyObject } from 'crypto';

interface TestSigner {
  publicPem: string;
  privateKey: KeyObject;
}

function makeSigner(): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
}

function makeToken(
  signer: TestSigner,
  payload: { fp: string; iat: number; exp: number; lid?: string; v?: number }
): string {
  const json = Buffer.from(JSON.stringify({ v: 1, lid: 'lic-1', ...payload }));
  return `${json.toString('base64url')}.${sign(null, json, signer.privateKey).toString('base64url')}`;
}

const FP = '10000000cafe0001';
const KEY = 'ABCD-EFGH-JKMN-PQRS';
const DAY = 86_400_000;
const T0 = 1_761_000_000_000;
const SERVER = 'https://skyglass.dev';

type Reply = { status: number; body?: unknown } | Error;

// Never touch the real ~/.skyglass from tests.
const MARKER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-lic-marker-'));
let markerSeq = 0;
afterAll(() => fs.rmSync(MARKER_DIR, { recursive: true, force: true }));

function setup(
  opts: {
    record?: LicenseRecord | null;
    keyFile?: string;
    markerFile?: string;
    signer?: TestSigner;
    fingerprint?: string;
    save?: (r: LicenseRecord) => void;
  } = {}
) {
  const signer = opts.signer ?? makeSigner();
  process.env.SKYGLASS_LICENSE_PUBLIC_KEY = signer.publicPem;
  let now = T0;
  let mono = 1_000;
  const markerFile = opts.markerFile ?? path.join(MARKER_DIR, `marker-${++markerSeq}`);
  const fp = opts.fingerprint ?? FP;
  let saved: LicenseRecord | null = opts.record ?? null;
  const replies: Reply[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const reply = replies.shift();
    if (!reply) throw new Error('no reply queued');
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? 'oops' : JSON.stringify(reply.body), { status: reply.status });
  });
  const events: LicenseStatus[] = [];
  const manager = new LicenseManager({
    store: {
      load: () => saved,
      save: (r) => {
        opts.save?.(r);
        saved = { ...r };
      },
    },
    config: () => ({ enabled: true, server: SERVER }),
    fingerprint: () => ({ type: 'pi_serial', value: fp }),
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
    monotonic: () => mono,
    mirrorId: () => 'mirror-1',
    appVersion: () => '1.0.0',
    keyFilePath: () => opts.keyFile ?? '/nonexistent/skyglass-license.txt',
    keyFileMarkerPath: () => markerFile,
  });
  manager.onChange((s) => events.push(s));
  const token = (tokenFp = fp, iatMs = now) =>
    makeToken(signer, { fp: tokenFp, iat: Math.floor(iatMs / 1000), exp: Math.floor(iatMs / 1000) + 30 * 86400 });
  const ok = (t = token()) => ({ status: 200, body: { status: 'active', token: t, licenseId: 'lic-1', keyLast4: 'PQRS', activatedAt: '2026-10-01T00:00:00.000Z' } });
  return {
    manager,
    replies,
    calls,
    events,
    token,
    ok,
    saved: () => saved,
    signer,
    markerFile,
    advance: (ms: number) => {
      now += ms;
      mono += ms;
    },
    /** Wall clock only (NTP correction, RTC-less boot); the monotonic clock is unaffected. */
    jumpWall: (ms: number) => (now += ms),
    now: () => now,
  };
}

afterEach(() => {
  delete process.env.SKYGLASS_LICENSE_PUBLIC_KEY;
  vi.restoreAllMocks();
});

describe('LicenseManager: activation', () => {
  it('starts unlicensed and activates an entered key', async () => {
    const t = setup();
    expect(t.manager.getStatus()).toMatchObject({ enabled: true, state: 'unlicensed', manageUrl: `${SERVER}/license` });
    expect(t.manager.isActivated()).toBe(false);

    t.replies.push(t.ok());
    const r = await t.manager.submitKey(' abcd efgh-jkmn pqrs ');
    expect(r.ok).toBe(true);
    expect(t.calls[0].url).toBe(`${SERVER}/api/license/activate`);
    expect(t.calls[0].body).toMatchObject({
      licenseKey: KEY,
      deviceFingerprint: FP,
      fingerprintType: 'pi_serial',
      mirrorId: 'mirror-1',
      appVersion: '1.0.0',
    });
    const status = t.manager.getStatus();
    expect(status).toMatchObject({ state: 'active', keyLast4: 'PQRS', activatedAt: '2026-10-01T00:00:00.000Z' });
    expect(status.expiresAt).toBe(new Date(T0 + 30 * DAY).toISOString());
    expect(t.saved()).toMatchObject({ license_key: KEY, state: 'active' });
    expect(t.events.at(-1)?.state).toBe('active');
    expect(t.manager.isActivated()).toBe(true);
  });

  it('rejects malformed keys without calling the server', async () => {
    const t = setup();
    const r = await t.manager.submitKey('ABCD-EFGH-JKMN-PQR0');
    expect(r).toMatchObject({ ok: false, code: 'invalid_key', httpStatus: 400 });
    expect(t.calls).toHaveLength(0);
  });

  it('409 bound_to_another_device → bound_elsewhere when nothing is active', async () => {
    const t = setup();
    t.replies.push({ status: 409, body: { status: 'bound_to_another_device', message: 'Bound elsewhere' } });
    const r = await t.manager.submitKey(KEY);
    expect(r).toMatchObject({ ok: false, code: 'bound_to_another_device', httpStatus: 409 });
    expect(t.manager.getStatus()).toMatchObject({ state: 'bound_elsewhere', keyLast4: 'PQRS' });
    expect(t.manager.isActivated()).toBe(false);
  });

  it('403 revoked → revoked', async () => {
    const t = setup();
    t.replies.push({ status: 403, body: { status: 'revoked', message: 'Revoked' } });
    expect(await t.manager.submitKey(KEY)).toMatchObject({ ok: false, code: 'revoked', httpStatus: 403 });
    expect(t.manager.getStatus().state).toBe('revoked');
  });

  it('does not overwrite an active license with a rejected key', async () => {
    const t = setup();
    t.replies.push(t.ok());
    await t.manager.submitKey(KEY);
    for (const [status, code] of [
      [409, 'bound_to_another_device'],
      [404, 'not_found'],
      [403, 'revoked'],
    ] as const) {
      t.replies.push({ status, body: { status: code, message: code } });
      const r = await t.manager.submitKey('WXYZ-WXYZ-WXYZ-WXYZ');
      expect(r).toMatchObject({ ok: false, code, httpStatus: status });
      expect(t.manager.getStatus()).toMatchObject({ state: 'active', keyLast4: 'PQRS' });
    }
  });

  it('passes rate_limited through as 429 and changes nothing', async () => {
    const t = setup();
    t.replies.push({ status: 429, body: { status: 'rate_limited', message: 'Slow down' } });
    expect(await t.manager.submitKey(KEY)).toMatchObject({ ok: false, code: 'rate_limited', httpStatus: 429 });
    expect(t.manager.getStatus().state).toBe('unlicensed');
    expect(t.saved()).toBeNull();
  });

  it('network error on activation → 503, state unchanged', async () => {
    const t = setup();
    t.replies.push(new TypeError('fetch failed'));
    expect(await t.manager.submitKey(KEY)).toMatchObject({ ok: false, code: 'network_error', httpStatus: 503 });
    expect(t.manager.getStatus().state).toBe('unlicensed');
  });

  it('treats a 200 with a bad token as an error, not active', async () => {
    const t = setup();
    t.replies.push(t.ok(t.token('someone-else')));
    expect(await t.manager.submitKey(KEY)).toMatchObject({ ok: false, code: 'server_error', httpStatus: 502 });
    const forged = makeToken(makeSigner(), { fp: FP, iat: T0 / 1000, exp: T0 / 1000 + 86400 });
    t.replies.push(t.ok(forged));
    expect(await t.manager.submitKey(KEY)).toMatchObject({ ok: false, code: 'server_error' });
    expect(t.manager.getStatus().state).toBe('unlicensed');
  });

  it('treats a bare 404 page as a server error, not not_found', async () => {
    const t = setup();
    t.replies.push({ status: 404 });
    expect(await t.manager.submitKey(KEY)).toMatchObject({ ok: false, code: 'server_error' });
  });
});

describe('LicenseManager: refresh', () => {
  async function activated() {
    const t = setup();
    t.replies.push(t.ok());
    await t.manager.submitKey(KEY);
    t.calls.length = 0;
    return t;
  }

  it('refreshes daily (never activates) and stays active', async () => {
    const t = await activated();
    t.replies.push(t.ok());
    await t.manager.tick(); // first tick after start is due immediately
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe(`${SERVER}/api/license/refresh`);
    expect(t.calls[0].body).not.toHaveProperty('fingerprintType');

    t.advance(DAY - 1000);
    await t.manager.tick();
    expect(t.calls).toHaveLength(1); // not due yet
    t.advance(2000);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.calls.every((c) => c.url.endsWith('/refresh'))).toBe(true);
    expect(t.manager.getStatus().state).toBe('active');
  });

  it('409 released on refresh → released', async () => {
    const t = await activated();
    t.replies.push({ status: 409, body: { status: 'released', message: 'Released' } });
    await t.manager.refreshNow();
    expect(t.manager.getStatus()).toMatchObject({ state: 'released', keyLast4: 'PQRS' });
    expect(t.events.at(-1)?.state).toBe('released');
    // Released licenses are not polled (and never re-activated).
    t.advance(2 * DAY);
    await t.manager.tick();
    expect(t.calls).toHaveLength(1);
    // Still counts as activated: the mirror shows the license screen, not setup.
    expect(t.manager.isActivated()).toBe(true);
  });

  it('403 revoked on refresh → revoked', async () => {
    const t = await activated();
    t.replies.push({ status: 403, body: { status: 'revoked' } });
    await t.manager.refreshNow();
    expect(t.manager.getStatus().state).toBe('revoked');
  });

  it('network errors keep active until exp, then expired; recovers on success', async () => {
    const t = await activated();
    t.replies.push(new TypeError('fetch failed'));
    await t.manager.tick();
    expect(t.manager.getStatus().state).toBe('active');

    // Offline for a month: hourly retries all fail.
    for (let h = 0; h < 30 * 24 - 1; h++) {
      t.advance(60 * 60 * 1000);
      t.replies.push(new TypeError('fetch failed'));
      await t.manager.tick();
      expect(t.manager.getStatus().state).toBe('active');
    }
    t.advance(60 * 60 * 1000);
    t.replies.push(new TypeError('fetch failed'));
    await t.manager.tick();
    expect(t.manager.getStatus().state).toBe('expired');
    expect(t.events.at(-1)?.state).toBe('expired');

    // Expired retries hourly, and returns to active on success.
    t.advance(30 * 60 * 1000);
    const before = t.calls.length;
    await t.manager.tick();
    expect(t.calls.length).toBe(before);
    t.advance(30 * 60 * 1000);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.manager.getStatus().state).toBe('active');
  });

  it('getStatus flips active → expired once exp passes, even without a tick', async () => {
    const t = await activated();
    t.advance(30 * DAY);
    expect(t.manager.getStatus().state).toBe('expired');
  });

  it('a bad token on refresh is an error and keeps the current token', async () => {
    const t = await activated();
    const good = t.saved()?.token;
    t.replies.push(t.ok(t.token('other-device')));
    await t.manager.refreshNow();
    expect(t.manager.getStatus().state).toBe('active');
    expect(t.saved()?.token).toBe(good);
  });

  it('re-derives state from the stored token on load', () => {
    const signer = makeSigner();
    const stale = makeToken(signer, { fp: FP, iat: T0 / 1000 - 40 * 86400, exp: T0 / 1000 - 10 * 86400 });
    const t = setup({
      record: {
        license_key: KEY,
        token: stale,
        state: 'active',
        activated_at: '2026-01-01T00:00:00.000Z',
        last_checked_at: null,
        last_error: null,
      },
    });
    expect(t.manager.getStatus().state).toBe('expired');
  });
});

describe('LicenseManager: key file', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-lic-'));
    file = path.join(dir, 'skyglass-license.txt');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('activates a pre-flashed key on the first boot with network', async () => {
    fs.writeFileSync(file, 'abcd-efgh-jkmn-pqrs\n');
    const t = setup({ keyFile: file });
    t.replies.push(new TypeError('fetch failed'));
    await t.manager.tick();
    expect(t.manager.getStatus().state).toBe('unlicensed');

    expect(t.manager.getStatus()).toMatchObject({
      keyFilePending: true,
      message: 'Activating the pre-installed license…',
    });

    t.advance(20 * 1000);
    await t.manager.tick();
    expect(t.calls).toHaveLength(1); // retry waits 30 s right after boot

    t.advance(15 * 1000);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.calls.map((c) => c.url)).toEqual([
      `${SERVER}/api/license/activate`,
      `${SERVER}/api/license/activate`,
    ]);
    expect(t.calls[1].body).toMatchObject({ licenseKey: KEY });
    expect(t.manager.getStatus()).toMatchObject({ state: 'active', keyLast4: 'PQRS', keyFilePending: false });
    expect(t.saved()?.license_key).toBe(KEY);

    // From now on only refresh is used.
    t.advance(DAY);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.calls.at(-1)?.url).toBe(`${SERVER}/api/license/refresh`);
  });

  it('honors SKYGLASS_LICENSE_FILE', async () => {
    fs.writeFileSync(file, KEY);
    process.env.SKYGLASS_LICENSE_FILE = file;
    try {
      const signer = makeSigner();
      process.env.SKYGLASS_LICENSE_PUBLIC_KEY = signer.publicPem;
      const calls: string[] = [];
      const m = new LicenseManager({
        store: { load: () => null, save: () => undefined },
        config: () => ({ enabled: true, server: SERVER }),
        fingerprint: () => ({ type: 'pi_serial', value: FP }),
        now: () => T0,
        keyFileMarkerPath: () => path.join(dir, 'marker'),
        fetch: (async (url: string) => {
          calls.push(url);
          const tok = makeToken(signer, { fp: FP, iat: T0 / 1000, exp: T0 / 1000 + 86400 });
          return new Response(JSON.stringify({ status: 'active', token: tok }), { status: 200 });
        }) as unknown as typeof fetch,
      });
      await m.tick();
      expect(calls).toEqual([`${SERVER}/api/license/activate`]);
      expect(m.getStatus().state).toBe('active');
    } finally {
      delete process.env.SKYGLASS_LICENSE_FILE;
    }
  });

  it('a key entered in the app wins over the key file', async () => {
    fs.writeFileSync(file, 'WXYZ-WXYZ-WXYZ-WXYZ');
    const t = setup({ keyFile: file });
    t.replies.push(t.ok());
    await t.manager.submitKey(KEY);
    t.replies.push(t.ok());
    await t.manager.tick();
    expect(t.calls.map((c) => c.body.licenseKey)).toEqual([KEY, KEY]);
  });

  it('stores a key-file key bound elsewhere and does not retry activate', async () => {
    fs.writeFileSync(file, KEY);
    const t = setup({ keyFile: file });
    t.replies.push({ status: 409, body: { status: 'bound_to_another_device' } });
    await t.manager.tick();
    expect(t.manager.getStatus().state).toBe('bound_elsewhere');
    t.advance(DAY);
    await t.manager.tick();
    expect(t.calls).toHaveLength(1);
  });

  it('ignores a key file without a valid key', async () => {
    fs.writeFileSync(file, 'not a key');
    const t = setup({ keyFile: file });
    await t.manager.tick();
    expect(t.calls).toHaveLength(0);
    expect(t.manager.getStatus().state).toBe('unlicensed');
  });
});

describe('LicenseManager: disabled', () => {
  it('reports disabled, counts as activated, and never calls the server', async () => {
    const fetchMock = vi.fn();
    const m = new LicenseManager({
      store: { load: () => null, save: () => undefined },
      config: () => ({ enabled: false, server: SERVER }),
      fingerprint: () => ({ type: 'pi_serial', value: FP }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    m.start();
    await m.tick();
    expect(m.getStatus()).toEqual({
      enabled: false,
      state: 'disabled',
      keyFilePending: false,
      supportEmail: 'support@skyglass.dev',
      manageUrl: `${SERVER}/license`,
    });
    expect(m.isActivated()).toBe(true);
    expect(await m.submitKey(KEY)).toMatchObject({ ok: false, code: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
    m.stop();
  });
});


describe('LicenseManager: key file timing and status', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-lic-'));
    file = path.join(dir, 'skyglass-license.txt');
    fs.writeFileSync(file, KEY);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reports keyFilePending before the first attempt', () => {
    const t = setup({ keyFile: file });
    expect(t.manager.getStatus()).toMatchObject({
      state: 'unlicensed',
      keyFilePending: true,
      message: 'Activating the pre-installed license…',
    });
  });

  it('retries every 30 s for 10 minutes after boot, then every 5 minutes', async () => {
    const t = setup({ keyFile: file });
    t.replies.push(new TypeError('fetch failed'));
    await t.manager.tick();
    // 19 more fast retries fill the first ~10 minutes.
    for (let i = 0; i < 19; i++) {
      t.advance(30 * 1000);
      t.replies.push(new TypeError('fetch failed'));
      await t.manager.tick();
    }
    expect(t.calls).toHaveLength(20);
    t.advance(30 * 1000); // 10:00 after boot: window over
    await t.manager.tick();
    expect(t.calls).toHaveLength(20); // last attempt was only 30 s ago
    expect(t.manager.getStatus()).toMatchObject({
      keyFilePending: true,
      message: 'Connect the mirror to the internet to activate the pre-installed license.',
    });
    t.advance(4 * 60 * 1000);
    await t.manager.tick();
    expect(t.calls).toHaveLength(20);
    t.advance(30 * 1000);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.calls).toHaveLength(21);
    expect(t.manager.getStatus()).toMatchObject({ state: 'active', keyFilePending: false });
  });

  it('POST refresh (refreshNow) tries the key file immediately', async () => {
    const t = setup({ keyFile: file });
    t.replies.push(new TypeError('fetch failed'));
    await t.manager.tick();
    t.replies.push(t.ok());
    const status = await t.manager.refreshNow(); // no wait for the retry interval
    expect(t.calls).toHaveLength(2);
    expect(status).toMatchObject({ state: 'active', keyFilePending: false });
  });

  it('uses the monotonic clock for retries: a wall-clock jump does not stall or rush them', async () => {
    const t = setup();
    t.replies.push(t.ok());
    await t.manager.submitKey(KEY);
    t.replies.push(t.ok());
    await t.manager.tick();
    t.calls.length = 0;
    // NTP pulls the clock back an hour, then a day of real time passes.
    t.jumpWall(-60 * 60 * 1000);
    t.advance(DAY);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.calls).toHaveLength(1);
    // A forward wall jump alone does not trigger a refresh.
    t.jumpWall(2 * DAY);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.calls).toHaveLength(1);
  });
});

describe('LicenseManager: key file pickup marker', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-lic-'));
    file = path.join(dir, 'skyglass-license.txt');
    fs.writeFileSync(file, KEY);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('records the pickup and does not auto-activate the key file again after DB loss', async () => {
    const marker = path.join(dir, 'nested', 'license-keyfile-used');
    const first = setup({ keyFile: file, markerFile: marker });
    first.replies.push(first.ok());
    await first.manager.tick();
    expect(first.manager.getStatus().state).toBe('active');
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.readFileSync(marker, 'utf8')).not.toContain(KEY);

    // data/ wiped: no stored record, same card, same marker.
    const t = setup({ keyFile: file, markerFile: marker });
    await t.manager.tick();
    await t.manager.refreshNow();
    expect(t.calls).toHaveLength(0);
    expect(t.manager.getStatus()).toMatchObject({
      state: 'unlicensed',
      keyFilePending: false,
      message: expect.stringContaining('already used'),
    });
    expect(t.manager.isActivated()).toBe(false);

    // Entering the key in the app still works.
    t.replies.push(t.ok());
    expect(await t.manager.submitKey(KEY)).toMatchObject({ ok: true });
  });

  it('records a definitive rejection too', async () => {
    const t = setup({ keyFile: file });
    t.replies.push({ status: 409, body: { status: 'bound_to_another_device' } });
    await t.manager.tick();
    expect(fs.existsSync(t.markerFile)).toBe(true);
  });

  it('does not record a network failure, and a marker for a different key does not block', async () => {
    const t = setup({ keyFile: file });
    t.replies.push(new TypeError('fetch failed'));
    await t.manager.tick();
    expect(fs.existsSync(t.markerFile)).toBe(false);

    fs.writeFileSync(t.markerFile, 'deadbeef\n'); // a previous card's key
    t.advance(30 * 1000);
    t.replies.push(t.ok());
    await t.manager.tick();
    expect(t.manager.getStatus().state).toBe('active');
  });
});

describe('LicenseManager: card or DB moved to another Pi', () => {
  const OTHER_FP = '10000000beef0002';

  function moved() {
    const signer = makeSigner();
    const foreign = makeToken(signer, { fp: OTHER_FP, iat: T0 / 1000 - DAY / 1000, exp: T0 / 1000 + 29 * 86400 });
    return setup({
      signer,
      record: {
        license_key: KEY,
        token: foreign,
        state: 'active',
        activated_at: '2026-09-01T00:00:00.000Z',
        last_checked_at: null,
        last_error: null,
      },
    });
  }

  it('never reports expired for a fingerprint mismatch; activates the stored key here', async () => {
    const t = moved();
    const status = t.manager.getStatus();
    expect(status.state).toBe('unlicensed');
    expect(status.state).not.toBe('expired');
    expect(status.message).toMatch(/Checking/);
    expect(status.expiresAt).toBeUndefined();
    expect(t.manager.isActivated()).toBe(true); // license screen, not the setup wizard

    // Released on the website (pending): activate binds it here.
    t.replies.push(t.ok());
    await t.manager.tick();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe(`${SERVER}/api/license/activate`);
    expect(t.calls[0].body).toMatchObject({ licenseKey: KEY, deviceFingerprint: FP });
    expect(t.manager.getStatus()).toMatchObject({ state: 'active', keyLast4: 'PQRS' });

    // Back to refresh only.
    t.advance(DAY);
    t.replies.push(t.ok(t.token(FP, t.now())));
    await t.manager.tick();
    expect(t.calls.at(-1)?.url).toBe(`${SERVER}/api/license/refresh`);
  });

  it('still bound to the other Pi → bound_elsewhere (not released), activated once', async () => {
    const t = moved();
    t.replies.push({ status: 409, body: { status: 'bound_to_another_device', message: 'Bound elsewhere' } });
    await t.manager.tick();
    expect(t.manager.getStatus()).toMatchObject({ state: 'bound_elsewhere', keyLast4: 'PQRS' });
    expect(t.saved()).toMatchObject({ license_key: KEY, token: null, activated_at: '2026-09-01T00:00:00.000Z' });
    expect(t.manager.isActivated()).toBe(true);
    t.advance(DAY);
    await t.manager.tick();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe(`${SERVER}/api/license/activate`);
  });

  it('retries the activation after a network error and survives a restart before the answer', async () => {
    const t = moved();
    t.replies.push(new TypeError('fetch failed'));
    await t.manager.tick();
    expect(t.manager.getStatus().state).toBe('unlicensed');
    // The foreign token is kept, so a restarted manager re-detects the move.
    const again = setup({ signer: t.signer, record: t.saved() });
    expect(again.manager.getStatus().message).toMatch(/Checking/);
    again.replies.push(again.ok());
    await again.manager.refreshNow();
    expect(again.calls[0].url).toBe(`${SERVER}/api/license/activate`);
    expect(again.manager.getStatus().state).toBe('active');
  });
});

describe('LicenseManager: rejected keys keep an activated mirror out of setup', () => {
  async function released() {
    const t = setup();
    t.replies.push(t.ok());
    await t.manager.submitKey(KEY);
    t.replies.push({ status: 409, body: { status: 'released', message: 'Released' } });
    await t.manager.refreshNow();
    t.calls.length = 0;
    return t;
  }

  it.each([
    [409, 'bound_to_another_device'],
    [403, 'revoked'],
    [404, 'not_found'],
  ] as const)('released mirror + rejected key (%s %s) keeps the bound key and activated_at', async (status, code) => {
    const t = await released();
    t.replies.push({ status, body: { status: code, message: code } });
    const r = await t.manager.submitKey('WXYZ-WXYZ-WXYZ-WXYZ');
    expect(r).toMatchObject({ ok: false, code, httpStatus: status });
    expect(t.saved()).toMatchObject({ license_key: KEY, state: 'released' });
    expect(t.saved()?.activated_at).toBeTruthy();
    expect(t.manager.isActivated()).toBe(true);
    expect(t.manager.getStatus()).toMatchObject({ state: 'released', keyLast4: 'PQRS' });
  });

  it('revoked mirror + rejected key stays activated', async () => {
    const t = setup();
    t.replies.push(t.ok());
    await t.manager.submitKey(KEY);
    t.replies.push({ status: 403, body: { status: 'revoked' } });
    await t.manager.refreshNow();
    t.replies.push({ status: 409, body: { status: 'bound_to_another_device' } });
    await t.manager.submitKey('WXYZ-WXYZ-WXYZ-WXYZ');
    expect(t.manager.isActivated()).toBe(true);
    expect(t.saved()).toMatchObject({ license_key: KEY, state: 'revoked' });
  });

  it('a released mirror can still activate a new key', async () => {
    const t = await released();
    t.replies.push({ ...t.ok(), body: { ...(t.ok().body as object), keyLast4: 'WXYZ' } });
    expect(await t.manager.submitKey('WXYZ-WXYZ-WXYZ-WXYZ')).toMatchObject({ ok: true });
    expect(t.manager.getStatus()).toMatchObject({ state: 'active', keyLast4: 'WXYZ' });
  });
});

describe('LicenseManager: failures never escape', () => {
  it('a throwing store keeps the in-memory state and does not reject', async () => {
    const t = setup({
      save: () => {
        throw new Error('SQLITE_READONLY: attempt to write a readonly database');
      },
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    t.replies.push(t.ok());
    const r = await t.manager.submitKey(KEY);
    expect(r.ok).toBe(true);
    expect(t.manager.getStatus().state).toBe('active');
    t.replies.push(t.ok());
    await expect(t.manager.tick()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });

  it('start() swallows a throwing background tick (no unhandled rejection)', async () => {
    let calls = 0;
    const m = new LicenseManager({
      store: { load: () => null, save: () => undefined },
      config: () => {
        calls++;
        // start() reads config once directly; the background tick hits the bad config.
        if (calls > 2) throw new Error('config.yaml: bad indentation');
        return { enabled: true, server: SERVER };
      },
      fingerprint: () => ({ type: 'pi_serial', value: FP }),
      keyFilePath: () => '/nonexistent/skyglass-license.txt',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      m.start();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith('[License] Background check failed:', expect.any(Error));
    } finally {
      m.stop();
      process.off('unhandledRejection', unhandled);
    }
  });
});
