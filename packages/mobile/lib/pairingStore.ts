/**
 * Pairing token store
 *
 * Each mirror gives this phone a bearer token when it is paired
 * (POST /api/pairing/claim or /complete). Tokens live in expo-secure-store,
 * one entry per mirror, keyed by the mirror's stable id (GET /api/discovery
 * `mirrorId`, the mDNS `id` TXT record and the claim response `mirror.id` are
 * the same value). Only when no id is known does the key fall back to the
 * mirror's host:port.
 *
 * Which id lives at which address is not secret, so that map stays in
 * AsyncStorage under the usual `@skyglass:*` convention; it lets the API
 * client find the right token without a round trip on every launch.
 *
 * Tokens are never logged and never written to AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { isMirrorId } from './mirrorLocator';

const SECURE_PREFIX = 'skyglass.pairing.';
const ADDRESS_MAP_KEY = '@skyglass:mirrorIdByAddress';

/** SecureStore keys may only contain letters, digits, ".", "-" and "_". */
function secureKey(ref: string): string {
  return SECURE_PREFIX + ref.replace(/[^A-Za-z0-9._-]/g, '_');
}

function idKey(mirrorId: string): string {
  return secureKey(`id.${mirrorId}`);
}

function addressKey(host: string, port: number): string {
  return secureKey(`addr.${host.toLowerCase()}_${port}`);
}

function addressRef(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

/** The id when it is a real mirror id (see isMirrorId), else null. */
export function usableMirrorId(id: unknown): string | null {
  return isMirrorId(id) ? id : null;
}

async function readAddressMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(ADDRESS_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing stored, or SecureStore unavailable.
  }
}

export const pairingStore = {
  /** The mirror id last seen at this address, if any. */
  async idForAddress(host: string, port: number): Promise<string | null> {
    const map = await readAddressMap();
    return usableMirrorId(map[addressRef(host, port)]);
  },

  async rememberAddress(host: string, port: number, mirrorId: string): Promise<void> {
    if (!usableMirrorId(mirrorId)) return;
    const map = await readAddressMap();
    if (map[addressRef(host, port)] === mirrorId) return;
    map[addressRef(host, port)] = mirrorId;
    try {
      await AsyncStorage.setItem(ADDRESS_MAP_KEY, JSON.stringify(map));
    } catch {
      // Only an optimisation; the id is fetched again next time.
    }
  },

  /** Token for a mirror: by id first, then by address. */
  async getToken(mirrorId: string | null, host: string, port: number): Promise<string | null> {
    const id = usableMirrorId(mirrorId);
    if (id) {
      const byId = await secureGet(idKey(id));
      if (byId) return byId;
    }
    return secureGet(addressKey(host, port));
  },

  /**
   * Save a token. With an id the address-keyed fallback entry is dropped so
   * there is only ever one token per mirror.
   */
  async setToken(mirrorId: string | null, host: string, port: number, token: string): Promise<void> {
    const id = usableMirrorId(mirrorId);
    if (id) {
      await SecureStore.setItemAsync(idKey(id), token);
      await secureDelete(addressKey(host, port));
      await this.rememberAddress(host, port, id);
    } else {
      await SecureStore.setItemAsync(addressKey(host, port), token);
    }
  },

  async clearToken(mirrorId: string | null, host: string, port: number): Promise<void> {
    const id = usableMirrorId(mirrorId);
    if (id) await secureDelete(idKey(id));
    await secureDelete(addressKey(host, port));
  },

  /**
   * Drop every token this phone knows about. SecureStore can't list its keys,
   * so the mirrors come from the address map plus whatever the caller adds
   * (linked mirrors, the pending mirror). Clears the address map too.
   */
  async clearAll(extra: Array<{ mirrorId?: string | null; host: string; port: number }> = []): Promise<void> {
    const map = await readAddressMap();
    const known = Object.entries(map).map(([ref, mirrorId]) => {
      const i = ref.lastIndexOf(':');
      return { mirrorId, host: ref.slice(0, i), port: Number(ref.slice(i + 1)) };
    });
    for (const m of [...known, ...extra]) await this.clearToken(m.mirrorId ?? null, m.host, m.port);
    try {
      await AsyncStorage.removeItem(ADDRESS_MAP_KEY);
    } catch {
      // Nothing stored.
    }
  },
};
