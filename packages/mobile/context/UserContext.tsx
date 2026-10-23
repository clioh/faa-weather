/**
 * User Context Provider
 *
 * Provides user profile and linked mirrors state throughout the app.
 * Handles initial loading, profile creation, and updates.
 * Integrates with Clerk for cloud authentication.
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth, useUser as useClerkUser } from '@clerk/expo';
import { storage, UserProfile, LinkedMirror } from '@/lib/storage';
import { api } from '@/lib/api';
import { logError } from '@/lib/errors';
import { resetAppData as wipeAppData } from '@/lib/devReset';

interface UserContextValue {
  // User profile
  user: UserProfile | null;
  isLoading: boolean;
  isOnboarded: boolean;

  // Error state
  error: Error | null;

  // Linked mirrors
  linkedMirrors: LinkedMirror[];
  currentMirror: LinkedMirror | null;

  // Cloud auth state
  isCloudAuthenticated: boolean;
  clerkUserId: string | null;
  clerkUserEmail: string | null;
  cloudSyncEnabled: boolean;

  // Actions
  /** `id` only when accepting an invite (the mirror already knows the person). */
  createProfile: (name: string, id?: string) => Promise<UserProfile>;
  updateProfile: (updates: Partial<Omit<UserProfile, 'id' | 'createdAt'>>) => Promise<void>;

  // Mirror management
  addMirror: (mirror: LinkedMirror) => Promise<void>;
  removeMirror: (mirrorId: string) => Promise<void>;
  setCurrentMirror: (mirror: LinkedMirror | null) => void;
  markFaceEnrolled: (mirrorId: string) => Promise<void>;

  // Cloud actions
  setCloudSyncEnabled: (enabled: boolean) => Promise<void>;
  signOut: () => Promise<void>;

  /** Dev only: wipe profile, mirrors, pairing tokens and cloud sign-in (lib/devReset). */
  resetAppData: () => Promise<void>;

  // Reload data
  refresh: () => Promise<void>;
  retryLoad: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [linkedMirrors, setLinkedMirrors] = useState<LinkedMirror[]>([]);
  const [currentMirror, setCurrentMirror] = useState<LinkedMirror | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(false);

  // Clerk hooks - wrapped in try/catch for when Clerk is not available
  let clerkAuth: ReturnType<typeof useAuth> | null = null;
  let clerkUser: ReturnType<typeof useClerkUser> | null = null;

  try {
    clerkAuth = useAuth();
    clerkUser = useClerkUser();
  } catch {
    // Clerk not available (no provider), continue without cloud auth
  }

  const isCloudAuthenticated = clerkAuth?.isSignedIn ?? false;
  const clerkUserId = clerkAuth?.userId ?? null;
  const clerkUserEmail = clerkUser?.user?.primaryEmailAddress?.emailAddress ?? null;

  // Load initial data
  const loadData = useCallback(async () => {
    setError(null);

    try {
      const [profile, mirrors, syncEnabled] = await Promise.all([
        storage.getUserProfile(),
        storage.getLinkedMirrors(),
        storage.getCloudSyncEnabled(),
      ]);

      setUser(profile);
      setLinkedMirrors(mirrors);
      setCloudSyncEnabledState(syncEnabled);

      console.log(
        '[UserContext] Loaded:',
        profile ? `User ${profile.name}` : 'No user',
        `${mirrors.length} mirrors`,
        `cloudSync: ${syncEnabled}`
      );
    } catch (err) {
      logError('UserContext.loadData', err);
      const wrappedError = err instanceof Error ? err : new Error('Failed to load user data');
      setError(wrappedError);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Retry loading data (for error recovery)
  const retryLoad = useCallback(async () => {
    setIsLoading(true);
    await loadData();
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // The API client found the current mirror at a new address and saved it;
  // pick up the new host so screens that show it stay accurate.
  useEffect(
    () =>
      api.onMirrorMoved(async (mirrorId, host, port) => {
        const mirrors = await storage.getLinkedMirrors();
        setLinkedMirrors(mirrors);
        setCurrentMirror((current) =>
          current?.mirrorId === mirrorId ? { ...current, host, port } : current
        );
      }),
    []
  );

  // Create new profile
  const createProfile = useCallback(async (name: string, id?: string): Promise<UserProfile> => {
    try {
      const profile = await storage.createUserProfile(name, id);
      setUser(profile);
      setError(null);
      return profile;
    } catch (err) {
      logError('UserContext.createProfile', err, { name });
      throw err; // Re-throw for caller to handle
    }
  }, []);

  // Update profile
  const updateProfile = useCallback(
    async (updates: Partial<Omit<UserProfile, 'id' | 'createdAt'>>) => {
      try {
        const updated = await storage.updateUserProfile(updates);
        setUser(updated);
      } catch (err) {
        logError('UserContext.updateProfile', err, { updates });
        throw err;
      }
    },
    []
  );

  // Add mirror
  const addMirror = useCallback(async (mirror: LinkedMirror) => {
    try {
      await storage.addLinkedMirror(mirror);
      const mirrors = await storage.getLinkedMirrors();
      setLinkedMirrors(mirrors);
    } catch (err) {
      logError('UserContext.addMirror', err, { mirrorId: mirror.mirrorId });
      throw err;
    }
  }, []);

  // Remove mirror
  const removeMirror = useCallback(
    async (mirrorId: string) => {
      try {
        // Revoke this phone's pairing token on the mirror (best effort) and
        // forget it locally before dropping the mirror from the list.
        const mirror = (await storage.getLinkedMirrors()).find((m) => m.mirrorId === mirrorId);
        if (mirror) await api.unpairMirror(mirror);
        await storage.removeLinkedMirror(mirrorId);
        const mirrors = await storage.getLinkedMirrors();
        setLinkedMirrors(mirrors);

        // Clear current mirror if it's the one being removed
        if (currentMirror?.mirrorId === mirrorId) {
          setCurrentMirror(null);
        }
      } catch (err) {
        logError('UserContext.removeMirror', err, { mirrorId });
        throw err;
      }
    },
    [currentMirror]
  );

  // Mark face enrolled
  const markFaceEnrolled = useCallback(
    async (mirrorId: string) => {
      try {
        await storage.markFaceEnrolled(mirrorId);
        const mirrors = await storage.getLinkedMirrors();
        setLinkedMirrors(mirrors);

        // Update current mirror if it's the one being updated
        if (currentMirror?.mirrorId === mirrorId) {
          const updated = mirrors.find((m) => m.mirrorId === mirrorId);
          if (updated) {
            setCurrentMirror(updated);
          }
        }
      } catch (err) {
        logError('UserContext.markFaceEnrolled', err, { mirrorId });
        throw err;
      }
    },
    [currentMirror]
  );

  // Cloud sync toggle
  const setCloudSyncEnabled = useCallback(async (enabled: boolean) => {
    try {
      await storage.setCloudSyncEnabled(enabled);
      setCloudSyncEnabledState(enabled);
    } catch (err) {
      logError('UserContext.setCloudSyncEnabled', err);
      throw err;
    }
  }, []);

  // Sign out of cloud
  const signOut = useCallback(async () => {
    try {
      if (clerkAuth?.signOut) {
        await clerkAuth.signOut();
      }
      await storage.setCloudSyncEnabled(false);
      setCloudSyncEnabledState(false);
    } catch (err) {
      logError('UserContext.signOut', err);
      throw err;
    }
  }, [clerkAuth]);

  const resetAppData = useCallback(async () => {
    try {
      if (clerkAuth?.isSignedIn) await clerkAuth.signOut().catch(() => {});
      await wipeAppData();
    } finally {
      setUser(null);
      setLinkedMirrors([]);
      setCurrentMirror(null);
      setCloudSyncEnabledState(false);
    }
  }, [clerkAuth]);

  const value: UserContextValue = {
    user,
    isLoading,
    isOnboarded: user !== null,
    error,
    linkedMirrors,
    currentMirror,
    // Cloud auth
    isCloudAuthenticated,
    clerkUserId,
    clerkUserEmail,
    cloudSyncEnabled,
    // Actions
    createProfile,
    updateProfile,
    addMirror,
    removeMirror,
    setCurrentMirror,
    markFaceEnrolled,
    setCloudSyncEnabled,
    signOut,
    resetAppData,
    refresh: loadData,
    retryLoad,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
