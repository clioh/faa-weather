/**
 * Phone pairing, mirror side.
 *
 * The kiosk runs on the mirror itself (http://localhost:3001), which the
 * backend trusts as a local client, so nothing here sends a token. Phones pair
 * either by scanning the connect QR (a single-use secret from
 * GET /api/pairing/qr) or by typing the 6-digit code the mirror shows on a
 * WS `pairing` { state: 'show' } event.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWsEvent } from './components/modules/useWsEvent';

export type PairingEvent =
  | { state: 'show'; code: string; deviceName?: string; expiresAt: string | number }
  | { state: 'hide'; result?: 'paired' | 'failed' | 'expired'; deviceName?: string }
  | { state: 'qr-rotated' };

export interface PairingQr {
  url: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Accepts an ISO string or epoch ms; NaN when unusable. */
export function toEpochMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) && value.trim() !== '' ? n : Date.parse(value);
  }
  return NaN;
}

/** Re-fetch this long before the secret expires so the QR never goes stale. */
const QR_REFRESH_LEAD_MS = 30_000;
/** Back-off after a failed fetch (backend restarting, endpoint missing). */
const QR_RETRY_MS = 15_000;
const QR_MIN_DELAY_MS = 5_000;

async function fetchPairingQr(): Promise<PairingQr | null> {
  const res = await fetch('/api/pairing/qr', {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { url?: unknown; expiresAt?: unknown };
  if (typeof data?.url !== 'string' || !data.url) return null;
  const expiresAt = toEpochMs(data.expiresAt);
  return { url: data.url, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 600_000 };
}

/**
 * The current connect QR link. Re-fetched shortly before it expires and as
 * soon as the backend rotates it (after every claim). Null while unknown or
 * when the backend can't provide one; an expired link is never returned.
 */
export function usePairingQr(enabled = true): PairingQr | null {
  const [qr, setQr] = useState<PairingQr | null>(null);
  const timerRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;

    let next: PairingQr | null = null;
    try {
      next = await fetchPairingQr();
    } catch {
      next = null;
    }
    // A newer request (rotation event, unmount) superseded this one.
    if (seq !== seqRef.current) return;

    const now = Date.now();
    if (next && next.expiresAt > now) {
      setQr(next);
      const delay = Math.max(next.expiresAt - now - QR_REFRESH_LEAD_MS, QR_MIN_DELAY_MS);
      timerRef.current = window.setTimeout(load, delay);
    } else {
      // Keep the previous link while it is still valid; drop it once expired.
      setQr((prev) => (prev && prev.expiresAt > now ? prev : null));
      timerRef.current = window.setTimeout(load, QR_RETRY_MS);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => {
      seqRef.current++;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, load]);

  useWsEvent('pairing', (data) => {
    if (!enabled) return;
    if ((data as PairingEvent | null)?.state === 'qr-rotated') void load();
  });

  return enabled ? qr : null;
}

/** "482913" → ["482", "913"]; other lengths are left whole. */
export function groupCode(code: string): string[] {
  const digits = code.replace(/\s+/g, '');
  if (digits.length === 6) return [digits.slice(0, 3), digits.slice(3)];
  if (digits.length === 8) return [digits.slice(0, 4), digits.slice(4)];
  return [digits];
}
