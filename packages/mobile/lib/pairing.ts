/**
 * Pairing flow
 *
 * The mirror only answers paired phones (bearer token; see lib/pairingStore
 * and the Bearer header in lib/api). This module decides when the Pair screen
 * (app/pair.tsx) opens and hands its result back to whoever asked:
 *
 * - ensurePaired(): called by every path that connects to a mirror
 *   (discovery, manual address, the QR deep link via discovery, My Mirrors,
 *   the WiFi hand-off). Checks the token with GET /api/pairing/whoami and, if
 *   the mirror says pairing_required, opens the Pair screen and waits.
 * - usePairingRedirect(): installed once in the root layout. Any other 401
 *   pairing_required (token revoked, mirror reset) opens the Pair screen
 *   once, then reopens the screen the user was on so it reloads.
 *
 * Only one Pair screen exists at a time. After the user backs out of it,
 * automatic redirects pause for REDIRECT_COOLDOWN_MS so a screen that keeps
 * polling can't bounce them straight back.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { router, useGlobalSearchParams, usePathname, type Href } from 'expo-router';
import { api, ApiError, isPairingRequired, PAIRING_LOCKED, TOO_MANY_DEVICES } from './api';
import { isSetupHotspot } from './mirrorLocator';

const REDIRECT_COOLDOWN_MS = 60000;

interface ActiveFlow {
  id: string;
  promise: Promise<boolean>;
  resolve: (paired: boolean) => void;
}

let active: ActiveFlow | null = null;
let flowSeq = 0;
let redirectPausedUntil = 0;

export interface PairingScreenParams {
  /** Shown on the Pair screen ("Pair with Hangar Mirror"). */
  mirrorName?: string;
  /** 'expired': this phone was paired but the mirror no longer accepts it. */
  reason?: 'new' | 'expired';
}

/**
 * Open the Pair screen for the current mirror (api base URL) and resolve
 * true once paired, false if the user leaves. Calls while it is open share
 * the same result instead of stacking a second screen.
 */
export function openPairing(params: PairingScreenParams = {}): Promise<boolean> {
  if (active) return active.promise;
  const id = String(++flowSeq);
  let resolve: (paired: boolean) => void = () => {};
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  active = { id, promise, resolve };
  router.push({
    pathname: '/pair',
    params: { flow: id, mirrorName: params.mirrorName ?? '', reason: params.reason ?? 'new' },
  });
  return promise;
}

/** Called by the Pair screen: true on success, false when it closes unpaired. */
export function settlePairing(flowId: string | undefined, paired: boolean): void {
  if (!active || active.id !== flowId) return;
  const flow = active;
  active = null;
  if (!paired) redirectPausedUntil = Date.now() + REDIRECT_COOLDOWN_MS;
  flow.resolve(paired);
}

/**
 * Make sure this phone may talk to the current mirror, pairing first if
 * needed. Resolves true when it may. The setup hotspot's provisioning server
 * has no pairing (it only takes WiFi credentials), and a backend without the
 * pairing routes (404) is let through.
 *
 * Throws ApiError when the mirror can't be reached, so callers keep their
 * "couldn't connect" handling.
 */
export async function ensurePaired(params: PairingScreenParams = {}): Promise<boolean> {
  const { host, port } = api.getConnectionState();
  if (isSetupHotspot(host, port)) return true;
  const hadToken = await api.hasPairingToken();
  try {
    await api.whoami();
    return true;
  } catch (err) {
    if (isPairingRequired(err)) {
      return openPairing({ ...params, reason: hadToken ? 'expired' : 'new' });
    }
    if (err instanceof ApiError && err.status === 404) return true;
    throw err;
  }
}

/**
 * User-facing text for the pairing errors every pairing call can return
 * (claim, request, complete), or null when the caller should decide.
 */
export function commonPairingError(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === undefined) {
    return 'Couldn’t reach the mirror. Make sure your phone is on the same WiFi network as the mirror.';
  }
  if (err.code === PAIRING_LOCKED) {
    return 'Pairing with a code is locked for now after too many wrong codes. Scan the QR code on the mirror’s setup screen instead.';
  }
  if (err.code === TOO_MANY_DEVICES) {
    return 'This mirror already has the most paired phones it allows. On a phone that’s already paired, open Settings → Paired phones and remove one you no longer use, then try again.';
  }
  if (err.status === 429) {
    return 'Too many pairing attempts. Wait a few minutes, then try again.';
  }
  return null;
}

/** Epoch ms from the mirror's expiresAt (epoch ms; ISO tolerated). */
export function expiryMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return NaN;
}

/** A name for this phone on the mirror's Paired phones list: 1-60 printable characters. */
export function getDeviceName(): string {
  // eslint-disable-next-line no-control-regex
  const fromDevice = (Constants.deviceName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (fromDevice) return fromDevice.slice(0, 60);
  if (Platform.OS === 'ios') return Platform.isPad ? 'iPad' : 'iPhone';
  if (Platform.OS === 'android') return 'Android phone';
  return 'Phone';
}

/**
 * Root-layout hook: send the user to the Pair screen when the mirror stops
 * accepting this phone, then reopen where they were so it reloads.
 */
export function usePairingRedirect(): void {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const here = useRef<{ pathname: string; params: Record<string, string> }>({
    pathname,
    params: {},
  });

  useEffect(() => {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string') flat[k] = v;
      else if (Array.isArray(v) && typeof v[0] === 'string') flat[k] = v[0];
    }
    here.current = { pathname, params: flat };
  }, [pathname, params]);

  useEffect(() => {
    api.setPairingRequiredListener(() => {
      if (active || Date.now() < redirectPausedUntil) return;
      const from = here.current;
      if (from.pathname === '/pair') return;
      openPairing().then((paired) => {
        if (!paired) return;
        // The Pair screen has popped itself; remount the screen underneath so
        // it reloads with the new token.
        setTimeout(() => {
          router.replace({ pathname: from.pathname, params: from.params } as Href);
        }, 0);
      });
    });
    return () => api.setPairingRequiredListener(null);
  }, []);
}
