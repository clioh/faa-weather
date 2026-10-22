/**
 * Dev reset
 *
 * Puts the app back to a fresh install without reinstalling Expo Go: every
 * `@skyglass:*` AsyncStorage key and every pairing token in SecureStore.
 * Cloud sign-in (Clerk) is handled by UserContext.resetAppData.
 *
 * `npm run dev:e2e -- --reset` adds `&reset=<nonce>` to the QR deep link;
 * app/connect.tsx resets once per nonce, so scanning the same QR again later
 * in the session doesn't wipe the profile you just made. Dev builds only.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { pairingStore } from './pairingStore';
import { storage } from './storage';

const KEY_PREFIX = '@skyglass:';
const RESET_NONCE_KEY = '@skyglass:devResetNonce';

export async function resetAppData(): Promise<void> {
  const [mirrors, pending, nonce] = await Promise.all([
    storage.getLinkedMirrors().catch(() => []),
    storage.getPendingMirror().catch(() => null),
    AsyncStorage.getItem(RESET_NONCE_KEY).catch(() => null),
  ]);
  await pairingStore.clearAll([...mirrors, ...(pending ? [pending] : [])]);

  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(KEY_PREFIX));
  await AsyncStorage.multiRemove(keys);
  // Survives the wipe so the same QR doesn't reset again.
  if (nonce) await AsyncStorage.setItem(RESET_NONCE_KEY, nonce);

  api.resetClient();
  console.log(`[DevReset] Cleared ${keys.length} keys and pairing tokens`);
}

/** True the first time a given reset nonce is seen (and records it). */
export async function claimResetNonce(nonce: string): Promise<boolean> {
  if (!__DEV__ || !nonce) return false;
  if ((await AsyncStorage.getItem(RESET_NONCE_KEY)) === nonce) return false;
  await AsyncStorage.setItem(RESET_NONCE_KEY, nonce);
  return true;
}
