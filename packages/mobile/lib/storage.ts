/**
 * Persistent Storage Layer
 *
 * Handles user profile and linked mirrors storage using AsyncStorage.
 * The mobile device acts as the "source of truth" for user identity.
 */

import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { isMirrorId } from './mirrorLocator';

/**
 * Storage error for validation failures
 */
export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageValidationError';
  }
}

/**
 * Validate user profile data
 */
function validateUserProfile(profile: unknown): profile is UserProfile {
  if (!profile || typeof profile !== 'object') return false;
  const p = profile as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    typeof p.createdAt === 'string'
  );
}

/**
 * Validate linked mirror data
 */
function validateLinkedMirror(mirror: unknown): mirror is LinkedMirror {
  if (!mirror || typeof mirror !== 'object') return false;
  const m = mirror as Record<string, unknown>;
  return (
    typeof m.mirrorId === 'string' &&
    m.mirrorId.length > 0 &&
    typeof m.mirrorName === 'string' &&
    typeof m.host === 'string' &&
    m.host.length > 0 &&
    typeof m.port === 'number' &&
    m.port > 0 &&
    m.port < 65536 &&
    typeof m.faceEnrolled === 'boolean' &&
    typeof m.lastConnected === 'string'
  );
}

/**
 * Validate host format (IP address or hostname)
 */
function isValidHost(host: string): boolean {
  // IP address pattern
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // Hostname pattern (allows alphanumeric, dots, and hyphens)
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
  return ipPattern.test(host) || hostnamePattern.test(host);
}

const STORAGE_KEYS = {
  USER_PROFILE: '@skyglass:userProfile',
  LINKED_MIRRORS: '@skyglass:linkedMirrors',
  ONBOARDING_STATE: '@skyglass:onboardingState',
  PENDING_MIRROR: '@skyglass:pendingMirror',
  // Cloud sync keys
  CLOUD_SYNC_ENABLED: '@skyglass:cloudSyncEnabled',
} as const;

export interface UserProfile {
  id: string;
  name: string;
  createdAt: string;
  preferences: {
    theme?: 'dark' | 'light';
  };
}

export interface LinkedMirror {
  mirrorId: string;
  mirrorName: string;
  host: string;
  port: number;
  faceEnrolled: boolean;
  enrolledAt?: string;
  lastConnected: string;
}

/** A mirror address handed to the app by a deep link (QR code on the mirror). */
export interface PendingMirror {
  host: string;
  port: number;
}

export type OnboardingPhase = 'welcome' | 'profile' | 'discover' | 'setup' | 'template' | 'complete';

export interface OnboardingState {
  phase: OnboardingPhase;
  mirrorIdForSetup?: string;
}

export const storage = {
  // User Profile Methods

  async getUserProfile(): Promise<UserProfile | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.USER_PROFILE);
      if (!data) return null;

      const parsed = JSON.parse(data);

      // Validate stored data
      if (!validateUserProfile(parsed)) {
        console.warn('[Storage] Invalid user profile data, clearing');
        await AsyncStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
        return null;
      }

      return parsed;
    } catch (error) {
      console.error('[Storage] Failed to get user profile:', error);
      return null;
    }
  },

  async createUserProfile(name: string): Promise<UserProfile> {
    // Validate input
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new StorageValidationError('Name is required');
    }
    if (trimmedName.length > 50) {
      throw new StorageValidationError('Name must be 50 characters or less');
    }

    const profile: UserProfile = {
      id: uuidv4(),
      name: trimmedName,
      createdAt: new Date().toISOString(),
      preferences: {},
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.USER_PROFILE,
      JSON.stringify(profile)
    );

    console.log('[Storage] Created user profile:', profile.id);
    return profile;
  },

  async updateUserProfile(
    updates: Partial<Omit<UserProfile, 'id' | 'createdAt'>>
  ): Promise<UserProfile> {
    const current = await this.getUserProfile();
    if (!current) {
      throw new Error('No user profile exists. Create one first.');
    }

    const updated: UserProfile = {
      ...current,
      ...updates,
      preferences: {
        ...current.preferences,
        ...updates.preferences,
      },
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.USER_PROFILE,
      JSON.stringify(updated)
    );

    console.log('[Storage] Updated user profile');
    return updated;
  },

  // Linked Mirrors Methods

  async getLinkedMirrors(): Promise<LinkedMirror[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.LINKED_MIRRORS);
      if (!data) return [];

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        console.warn('[Storage] Invalid mirrors data (not array), clearing');
        await AsyncStorage.removeItem(STORAGE_KEYS.LINKED_MIRRORS);
        return [];
      }

      // Filter out invalid entries
      const validMirrors = parsed.filter((m) => {
        if (!validateLinkedMirror(m)) {
          console.warn('[Storage] Filtering out invalid mirror entry:', m);
          return false;
        }
        return true;
      });

      // If we filtered any out, save the cleaned list
      if (validMirrors.length !== parsed.length) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.LINKED_MIRRORS,
          JSON.stringify(validMirrors)
        );
      }

      return validMirrors;
    } catch (error) {
      console.error('[Storage] Failed to get linked mirrors:', error);
      return [];
    }
  },

  async addLinkedMirror(mirror: LinkedMirror): Promise<void> {
    // Validate required fields
    if (!mirror.mirrorId || typeof mirror.mirrorId !== 'string') {
      throw new StorageValidationError('Mirror ID is required');
    }
    if (!mirror.host || typeof mirror.host !== 'string') {
      throw new StorageValidationError('Mirror host is required');
    }
    if (!isValidHost(mirror.host)) {
      throw new StorageValidationError('Invalid mirror host format');
    }
    if (typeof mirror.port !== 'number' || mirror.port <= 0 || mirror.port >= 65536) {
      throw new StorageValidationError('Invalid mirror port');
    }

    let mirrors = await this.getLinkedMirrors();

    // Entries saved before the app stored the mirror's real id (it used the
    // mirror's name, "unknown" or host:port) are replaced by the verified
    // entry for the same address, which fills in the id.
    if (isMirrorId(mirror.mirrorId)) {
      mirrors = mirrors.filter(
        (m) => isMirrorId(m.mirrorId) || m.host !== mirror.host || m.port !== mirror.port
      );
    }

    // Check if mirror already exists, update if so
    const existingIndex = mirrors.findIndex(
      (m) => m.mirrorId === mirror.mirrorId
    );

    if (existingIndex >= 0) {
      mirrors[existingIndex] = {
        ...mirrors[existingIndex],
        ...mirror,
        lastConnected: new Date().toISOString(),
      };
    } else {
      mirrors.push({
        ...mirror,
        lastConnected: new Date().toISOString(),
      });
    }

    await AsyncStorage.setItem(
      STORAGE_KEYS.LINKED_MIRRORS,
      JSON.stringify(mirrors)
    );

    console.log('[Storage] Added/updated linked mirror:', mirror.mirrorName);
  },

  async updateLinkedMirror(
    mirrorId: string,
    updates: Partial<LinkedMirror>
  ): Promise<void> {
    const mirrors = await this.getLinkedMirrors();
    const index = mirrors.findIndex((m) => m.mirrorId === mirrorId);

    if (index < 0) {
      console.warn('[Storage] Mirror not found:', mirrorId);
      return;
    }

    mirrors[index] = {
      ...mirrors[index],
      ...updates,
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.LINKED_MIRRORS,
      JSON.stringify(mirrors)
    );

    console.log('[Storage] Updated linked mirror:', mirrorId);
  },

  async removeLinkedMirror(mirrorId: string): Promise<void> {
    const mirrors = await this.getLinkedMirrors();
    const filtered = mirrors.filter((m) => m.mirrorId !== mirrorId);

    await AsyncStorage.setItem(
      STORAGE_KEYS.LINKED_MIRRORS,
      JSON.stringify(filtered)
    );

    console.log('[Storage] Removed linked mirror:', mirrorId);
  },

  async markFaceEnrolled(mirrorId: string): Promise<void> {
    await this.updateLinkedMirror(mirrorId, {
      faceEnrolled: true,
      enrolledAt: new Date().toISOString(),
    });
  },

  // Onboarding State Methods

  // ---- Pending mirror (from a deep link) ----

  async getPendingMirror(): Promise<PendingMirror | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_MIRROR);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PendingMirror>;
      if (typeof parsed.host !== 'string' || typeof parsed.port !== 'number') return null;
      return { host: parsed.host, port: parsed.port };
    } catch {
      return null;
    }
  },

  async setPendingMirror(mirror: PendingMirror): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.PENDING_MIRROR, JSON.stringify(mirror));
  },

  async clearPendingMirror(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_MIRROR);
  },

  async getOnboardingState(): Promise<OnboardingState | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_STATE);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[Storage] Failed to get onboarding state:', error);
      return null;
    }
  },

  async setOnboardingState(state: OnboardingState): Promise<void> {
    await AsyncStorage.setItem(
      STORAGE_KEYS.ONBOARDING_STATE,
      JSON.stringify(state)
    );
    console.log('[Storage] Set onboarding state:', state.phase);
  },

  async isOnboardingComplete(): Promise<boolean> {
    const state = await this.getOnboardingState();
    return state?.phase === 'complete';
  },

  // Cloud Sync Methods

  async getCloudSyncEnabled(): Promise<boolean> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_ENABLED);
      return data === 'true';
    } catch {
      return false;
    }
  },

  async setCloudSyncEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_ENABLED, String(enabled));
    console.log('[Storage] Cloud sync enabled:', enabled);
  },
};
