/**
 * Home Screen
 * Mirror discovery and connection with user profile
 */

import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useMirrorDiscovery } from '@/hooks/useMirrorDiscovery';
import { api, MirrorDevice } from '@/lib/api';
import { storage, LinkedMirror } from '@/lib/storage';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { goToDashboard } from '@/lib/navigation';
import { ensurePaired } from '@/lib/pairing';

/**
 * Point the API client at the mirror an interrupted onboarding was using.
 * Falls back to the most recently connected linked mirror.
 */
async function restoreMirrorConnection(mirrorId?: string): Promise<void> {
  const mirrors = await storage.getLinkedMirrors();
  const mirror =
    (mirrorId && mirrors.find((m) => m.mirrorId === mirrorId)) ||
    [...mirrors].sort((a, b) => b.lastConnected.localeCompare(a.lastConnected))[0];
  if (mirror) {
    api.setBaseUrl(mirror.host, mirror.port, mirror.mirrorId);
    console.log(`[Home] Restored connection to ${mirror.mirrorName} at ${mirror.host}:${mirror.port}`);
  } else {
    console.warn('[Home] Resuming setup but no linked mirror to reconnect to');
  }
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const {
    user,
    isLoading: userLoading,
    isOnboarded,
    linkedMirrors,
    addMirror,
    setCurrentMirror,
  } = useUser();

  const {
    mirrors: discoveredMirrors,
    scanning,
    error,
    startScan,
    connectToMirror,
    manualConnect,
  } = useMirrorDiscovery();

  // ?manual=1 (from "Enter address manually" on a Mirror not found notice)
  const { manual } = useLocalSearchParams<{ manual?: string }>();
  const [showManual, setShowManual] = useState(manual === '1');
  useEffect(() => {
    if (manual === '1') setShowManual(true);
  }, [manual]);
  const [manualHost, setManualHost] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);

  // Check onboarding state and redirect appropriately
  useEffect(() => {
    const checkOnboardingState = async () => {
      if (userLoading) return;

      if (!isOnboarded) {
        // No user profile, start from beginning
        router.replace('/onboarding');
        return;
      }

      // User exists, check if onboarding was incomplete
      const state = await storage.getOnboardingState();
      if (state && state.phase !== 'complete') {
        // The API client's base URL lives in memory only. After an app reload
        // the setup screens would otherwise call the mirror with no address.
        if (state.phase === 'setup' || state.phase === 'template') {
          await restoreMirrorConnection(state.mirrorIdForSetup);
        }

        // Resume onboarding at the right step
        switch (state.phase) {
          case 'welcome':
          case 'profile':
            router.replace('/onboarding');
            break;
          case 'discover':
            router.replace('/onboarding/discover');
            break;
          case 'setup':
            router.replace('/setup');
            break;
          case 'template':
            router.replace('/onboarding/template');
            break;
        }
      }
    };

    checkOnboardingState();
  }, [userLoading, isOnboarded]);

  // Start scan on mount
  useEffect(() => {
    if (isOnboarded) {
      startScan();
    }
  }, [isOnboarded]);

  const handleConnect = async (mirror: MirrorDevice | LinkedMirror) => {
    if (!user) return;

    const isLinked = 'lastConnected' in mirror;
    setConnecting(isLinked ? mirror.mirrorId : mirror.id);

    try {
      // Connect to the mirror
      let connected = false;
      if (isLinked) {
        // LinkedMirror - direct connect. With its id set, a failed ping looks
        // for the mirror on the network and follows it to a new address.
        api.setBaseUrl(mirror.host, mirror.port, mirror.mirrorId);
        try {
          await api.ping();
          connected = true;
        } catch {
          connected = false;
        }
      } else {
        // MirrorDevice from discovery
        connected = await connectToMirror(mirror);
      }

      if (!connected) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setConnecting(null);
        return;
      }

      // Register user with mirror and get mirror info
      const provisioning = !isLinked && mirror.provisioning === true;
      // Pair before anything else (the setup hotspot has no pairing).
      const mirrorName = isLinked ? mirror.mirrorName : mirror.name;
      if (!provisioning && !(await ensurePaired({ mirrorName }))) {
        return;
      }
      const result = await registerUserWithMirror(user, provisioning);
      // Where the mirror answered (the client may have followed it to a new
      // address), now with its id.
      const { host, port } = api.getConnectionState();
      api.setBaseUrl(host, port, result.mirrorId);

      // Save/update linked mirror
      const linkedMirror: LinkedMirror = {
        mirrorId: result.mirrorId,
        mirrorName: result.mirrorName,
        host,
        port,
        faceEnrolled: isLinked ? mirror.faceEnrolled : false,
        lastConnected: new Date().toISOString(),
      };

      await addMirror(linkedMirror);
      setCurrentMirror(linkedMirror);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Check setup status
      const status = await api.getSetupStatus();
      if (status.step === 'complete') {
        goToDashboard();
      } else {
        router.replace('/setup');
      }
    } catch (err) {
      console.error('Connection failed:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setConnecting(null);
    }
  };

  const registerUserWithMirror = async (userProfile: typeof user, provisioning: boolean) => {
    const { host, port } = api.getConnectionState();
    const fallbackId = api.getMirrorId() || `${host}:${port}`;

    // The setup hotspot's provisioning server has no user store; the user is
    // registered once the mirror is on the home network (setup/wifi).
    if (!provisioning) {
      try {
        const { mirrorId, mirrorName } = await api.createUser({
          id: userProfile!.id,
          name: userProfile!.name,
          preferences: userProfile!.preferences,
        });
        return { mirrorId, mirrorName };
      } catch (err) {
        console.error('Registering user with mirror failed:', err);
      }
    }

    // Fallback: the mirror's identity from /api/discovery
    try {
      const discovery = await api.getDiscoveryInfo();
      return {
        mirrorId: discovery.mirrorId || fallbackId,
        mirrorName: discovery.name || 'SkyGlass',
      };
    } catch {
      return { mirrorId: fallbackId, mirrorName: 'SkyGlass' };
    }
  };

  const handleManualConnect = async () => {
    if (!manualHost.trim()) return;

    setConnecting('manual');
    const mirror = await manualConnect(manualHost.trim());

    if (mirror) {
      await handleConnect(mirror);
    }
    setConnecting(null);
  };

  // Show loading while checking user status
  if (userLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Merge linked mirrors with discovered (prioritize linked)
  const allMirrors = [
    ...linkedMirrors.map((m) => ({ ...m, isLinked: true })),
    ...discoveredMirrors
      .filter((d) => !linkedMirrors.some((l) => l.host === d.host && l.port === d.port))
      .map((m) => ({ ...m, isLinked: false })),
  ];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(0, 255, 136, 0.1)', 'transparent']}
        style={styles.headerGradient}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg },
        ]}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={scanning}
            onRefresh={startScan}
            tintColor={colors.primary}
          />
        }
      >
        {/* User Profile Header */}
        {user && (
          <TouchableOpacity
            style={styles.profileHeader}
            onPress={() => router.push('/profile')}
          >
            <View style={styles.avatarContainer}>
              <Text style={styles.avatarText}>
                {user.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.greeting}>Hello, {user.name}</Text>
              <Text style={styles.profileSubtext}>
                {linkedMirrors.length} mirror{linkedMirrors.length !== 1 ? 's' : ''} linked
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Logo and title */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Ionicons name="glasses-outline" size={48} color={colors.primary} />
          </View>
          <Text style={styles.title}>Connect to Mirror</Text>
          <Text style={styles.subtitle}>
            {linkedMirrors.length > 0
              ? 'Select a mirror to connect'
              : 'Find your mirror on the network'}
          </Text>
        </View>

        {/* Scanning indicator */}
        {scanning && (
          <View style={styles.scanningContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.scanningText}>Scanning network...</Text>
          </View>
        )}

        {/* Error message */}
        {error && !scanning && linkedMirrors.length === 0 && (
          <View style={styles.errorContainer}>
            <Ionicons name="warning-outline" size={20} color={colors.warning} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Linked Mirrors (saved) */}
        {linkedMirrors.length > 0 && (
          <View style={styles.mirrorsSection}>
            <Text style={styles.sectionLabel}>MY MIRRORS</Text>
            {linkedMirrors.map((mirror) => (
              <TouchableOpacity
                key={mirror.mirrorId}
                style={styles.mirrorCard}
                onPress={() => handleConnect(mirror)}
                disabled={connecting !== null}
              >
                <View style={styles.mirrorIcon}>
                  <Ionicons
                    name={mirror.faceEnrolled ? 'person-circle-outline' : 'tv-outline'}
                    size={24}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.mirrorInfo}>
                  <Text style={styles.mirrorName}>{mirror.mirrorName}</Text>
                  <Text style={styles.mirrorHost}>
                    {mirror.host}:{mirror.port}
                    {mirror.faceEnrolled && ' • Face enrolled'}
                  </Text>
                </View>
                {connecting === mirror.mirrorId ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Discovered Mirrors (not yet linked) */}
        {discoveredMirrors.filter(
          (d) => !linkedMirrors.some((l) => l.host === d.host && l.port === d.port)
        ).length > 0 && (
          <View style={styles.mirrorsSection}>
            <Text style={styles.sectionLabel}>DISCOVERED ON NETWORK</Text>
            {discoveredMirrors
              .filter(
                (d) => !linkedMirrors.some((l) => l.host === d.host && l.port === d.port)
              )
              .map((mirror) => (
                <TouchableOpacity
                  key={mirror.id}
                  style={styles.mirrorCard}
                  onPress={() => handleConnect(mirror)}
                  disabled={connecting !== null}
                >
                  <View style={[styles.mirrorIcon, styles.newMirrorIcon]}>
                    <Ionicons
                      name={mirror.setupComplete ? 'tv-outline' : 'construct-outline'}
                      size={24}
                      color={colors.accent}
                    />
                  </View>
                  <View style={styles.mirrorInfo}>
                    <Text style={styles.mirrorName}>{mirror.name}</Text>
                    <Text style={styles.mirrorHost}>
                      {mirror.host}:{mirror.port}
                      {mirror.version && ` • v${mirror.version}`}
                    </Text>
                  </View>
                  {connecting === mirror.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>NEW</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
          </View>
        )}

        {/* Instructions when no mirrors found */}
        {!scanning && allMirrors.length === 0 && (
          <View style={styles.instructionsContainer}>
            <Text style={styles.instructionsTitle}>No mirrors found</Text>
            <Text style={styles.instructionsText}>
              Make sure your SkyGlass is powered on and connected to the same network,
              or connect to its WiFi hotspot for initial setup.
            </Text>

            <View style={styles.helpSteps}>
              <View style={styles.helpStep}>
                <View style={styles.helpStepNumber}>
                  <Text style={styles.helpStepNumberText}>1</Text>
                </View>
                <Text style={styles.helpStepText}>
                  For new mirrors: Connect to the "SkyGlass-Setup" WiFi network
                </Text>
              </View>
              <View style={styles.helpStep}>
                <View style={styles.helpStepNumber}>
                  <Text style={styles.helpStepNumberText}>2</Text>
                </View>
                <Text style={styles.helpStepText}>
                  For configured mirrors: Make sure you're on the same WiFi network
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Manual connection */}
        <TouchableOpacity
          style={styles.manualButton}
          onPress={() => setShowManual(!showManual)}
        >
          <Ionicons
            name={showManual ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.manualButtonText}>Enter IP manually</Text>
        </TouchableOpacity>

        {showManual && (
          <View style={styles.manualForm}>
            <TextInput
              style={styles.manualInput}
              placeholder="IP address (e.g., 192.168.1.100)"
              placeholderTextColor={colors.textMuted}
              value={manualHost}
              onChangeText={setManualHost}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleManualConnect}
            />
            <TouchableOpacity
              style={[
                styles.connectButton,
                !manualHost.trim() && styles.connectButtonDisabled,
              ]}
              onPress={handleManualConnect}
              disabled={!manualHost.trim() || connecting !== null}
            >
              {connecting === 'manual' ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text style={styles.connectButtonText}>Connect</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={startScan}
            disabled={scanning}
          >
            <Ionicons name="refresh" size={20} color={colors.text} />
            <Text style={styles.actionButtonText}>Scan Again</Text>
          </TouchableOpacity>

          {linkedMirrors.length > 0 && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/mirrors')}
            >
              <Ionicons name="layers-outline" size={20} color={colors.text} />
              <Text style={styles.actionButtonText}>Manage Mirrors</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    ...typography.h2,
    color: colors.background,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  greeting: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  profileSubtext: {
    ...typography.caption,
    color: colors.textMuted,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  scanningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  scanningText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 170, 0, 0.1)',
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.warning,
    flex: 1,
  },
  mirrorsSection: {
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  mirrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mirrorIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  newMirrorIcon: {
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
  },
  mirrorInfo: {
    flex: 1,
  },
  mirrorName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  mirrorHost: {
    ...typography.caption,
    color: colors.textMuted,
  },
  newBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: borderRadius.sm,
  },
  newBadgeText: {
    ...typography.label,
    color: colors.background,
    fontSize: 10,
  },
  instructionsContainer: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  instructionsTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  instructionsText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  helpSteps: {
    gap: spacing.md,
  },
  helpStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  helpStepNumber: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpStepNumberText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  helpStepText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  manualButtonText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  manualForm: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  manualInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  connectButton: {
    height: 48,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectButtonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  connectButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 48,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonText: {
    ...typography.bodySmall,
    color: colors.text,
  },
});
