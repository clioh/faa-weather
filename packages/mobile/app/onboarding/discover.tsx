/**
 * Mirror Discovery Screen
 * Part of the onboarding flow - finds and connects to a mirror
 */

import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useMirrorDiscovery } from '@/hooks/useMirrorDiscovery';
import { api, MirrorDevice } from '@/lib/api';
import { storage, LinkedMirror } from '@/lib/storage';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { InlineError } from '@/components/ErrorToast';
import { HeaderBackButton } from '@/components';
import { goBack, goHome, goToDashboard } from '@/lib/navigation';
import { ensurePaired } from '@/lib/pairing';
import { classifyError, ErrorType, ERROR_MESSAGES, logError } from '@/lib/errors';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { user, addMirror, setCurrentMirror } = useUser();
  const {
    mirrors: discoveredMirrors,
    scanning,
    error,
    startScan,
    connectToMirror,
    manualConnect,
  } = useMirrorDiscovery();

  const [showManual, setShowManual] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Start scan on mount. If a deep link (the QR code on the mirror's setup
  // screen) already told us where the mirror is, connect to it directly.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await storage.getPendingMirror();
      if (cancelled) return;
      if (!pending) {
        startScan();
        return;
      }
      await storage.clearPendingMirror();
      setManualHost(pending.host);
      const mirror = await manualConnect(pending.host, pending.port);
      if (cancelled) return;
      if (mirror) {
        await handleConnect(mirror);
      } else {
        setShowManual(true);
        setConnectionError(
          `Could not reach the mirror at ${pending.host}:${pending.port}. Check that your phone is on the same network.`
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const registerUserWithMirror = async (mirror: MirrorDevice) => {
    const fallbackId = mirror.mirrorId || `${mirror.host}:${mirror.port}`;
    if (!user) return { mirrorId: fallbackId, mirrorName: mirror.name };

    // The setup hotspot's provisioning server has no user store; the user is
    // registered once the mirror is on the home network (setup/wifi).
    if (!mirror.provisioning) {
      try {
        const { mirrorId, mirrorName } = await api.createUser({
          id: user.id,
          name: user.name,
          preferences: user.preferences,
        });
        return { mirrorId, mirrorName };
      } catch (err) {
        logError('DiscoverScreen.registerUserWithMirror', err, { userId: user.id });
      }
    }

    // Fallback: the mirror's identity from /api/discovery
    try {
      const discovery = await api.getDiscoveryInfo();
      return {
        mirrorId: discovery.mirrorId || fallbackId,
        mirrorName: discovery.name || mirror.name,
      };
    } catch (err) {
      logError('DiscoverScreen.getDiscoveryInfo', err);
      return { mirrorId: fallbackId, mirrorName: mirror.name };
    }
  };

  const handleConnect = async (mirror: MirrorDevice) => {
    if (!user) return;

    setConnecting(mirror.id);
    setConnectionError(null);

    try {
      // Connect to the mirror
      const connected = await connectToMirror(mirror);

      if (!connected) {
        setConnectionError('Could not reach mirror. Check that it\'s powered on and on the same network.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setConnecting(null);
        return;
      }

      // Pair before anything else: every route past /api/discovery needs
      // this phone's token. A QR claim (connect) has already stored one.
      if (!mirror.provisioning && !(await ensurePaired({ mirrorName: mirror.name }))) {
        setConnectionError('This phone needs to be paired with the mirror before it can set it up. Tap the mirror to try again.');
        return;
      }

      // Register user with mirror
      const result = await registerUserWithMirror(mirror);
      // Remember the id with the address so the client can find this mirror
      // again if its address changes.
      api.setBaseUrl(mirror.host, mirror.port, result.mirrorId);

      // Save linked mirror
      const linkedMirror: LinkedMirror = {
        mirrorId: result.mirrorId,
        mirrorName: result.mirrorName,
        host: api.getConnectionState().host,
        port: api.getConnectionState().port,
        faceEnrolled: false,
        lastConnected: new Date().toISOString(),
      };

      await addMirror(linkedMirror);
      setCurrentMirror(linkedMirror);

      // This screen is also reached by the QR deep link, which the dev client
      // replays on every reload. Once onboarding has finished, connecting is
      // just connecting: never move the phase backwards.
      const onboardingComplete = await storage.isOnboardingComplete();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const status = await api.getSetupStatus();
      if (onboardingComplete) {
        goToDashboard();
        return;
      }

      const phase = status.step === 'complete' ? 'template' : 'setup';
      try {
        await storage.setOnboardingState({ phase, mirrorIdForSetup: result.mirrorId });
      } catch (storageErr) {
        logError('DiscoverScreen.handleConnect.setOnboardingState', storageErr);
        // Continue anyway - not critical
      }

      if (phase === 'template') {
        // Mirror already set up, go to template selection
        router.push('/onboarding/template');
      } else {
        // Mirror needs setup
        router.push('/setup');
      }
    } catch (err) {
      logError('DiscoverScreen.handleConnect', err, { mirrorId: mirror.id });

      const errorType = classifyError(err);
      let message: string;

      switch (errorType) {
        case ErrorType.NETWORK_TIMEOUT:
          message = 'Connection timed out. The mirror may be busy or unreachable.';
          break;
        case ErrorType.NETWORK_OFFLINE:
          message = 'No internet connection. Please check your network.';
          break;
        case ErrorType.NETWORK_ERROR:
          message = 'Network error. Make sure you\'re on the same network as the mirror.';
          break;
        default:
          message = ERROR_MESSAGES[errorType] || 'Connection failed. Please try again.';
      }

      setConnectionError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setConnecting(null);
    }
  };

  const handleManualConnect = async () => {
    const host = manualHost.trim();
    if (!host) return;

    setConnecting('manual');
    setConnectionError(null);

    try {
      const mirror = await manualConnect(host);

      if (mirror) {
        await handleConnect(mirror);
      } else {
        setConnectionError(`Could not connect to ${host}. Check the IP address and try again.`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err) {
      logError('DiscoverScreen.handleManualConnect', err, { host });
      const errorType = classifyError(err);
      setConnectionError(ERROR_MESSAGES[errorType] || 'Connection failed. Check the IP address.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setConnecting(null);
    }
  };

  const handleSkip = async () => {
    try {
      // Mark onboarding as complete but skip mirror setup
      await storage.setOnboardingState({ phase: 'complete' });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      goHome();
    } catch (err) {
      logError('DiscoverScreen.handleSkip', err);
      // Still navigate - onboarding state isn't critical
      goHome();
    }
  };

  return (
    <View style={styles.container}>
      {/* Back + Progress Indicator */}
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <View style={styles.topBar}>
          <HeaderBackButton onPress={() => goBack('/onboarding/profile')} />
        </View>
        <OnboardingProgress currentPhase="discover" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="search" size={40} color={colors.primary} />
          </View>
          <Text style={styles.title}>Find Your Mirror</Text>
          <Text style={styles.subtitle}>
            We'll search for SkyGlass devices on your network
          </Text>
        </View>

        {/* Scanning indicator */}
        {scanning && (
          <View style={styles.scanningContainer}>
            <View style={styles.scanningAnimation}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
            <Text style={styles.scanningText}>Scanning network...</Text>
            <Text style={styles.scanningHint}>This may take a moment</Text>
          </View>
        )}

        {/* Scan error message */}
        {error && !scanning && (
          <View style={styles.errorContainer}>
            <Ionicons name="warning-outline" size={20} color={colors.warning} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Connection error message */}
        {connectionError && (
          <InlineError
            message={connectionError}
            onDismiss={() => setConnectionError(null)}
            onRetry={connecting ? undefined : () => setConnectionError(null)}
          />
        )}

        {/* Discovered Mirrors */}
        {discoveredMirrors.length > 0 && (
          <View style={styles.mirrorsSection}>
            <Text style={styles.sectionLabel}>FOUND MIRRORS</Text>
            {discoveredMirrors.map((mirror) => (
              <TouchableOpacity
                key={mirror.id}
                style={styles.mirrorCard}
                onPress={() => handleConnect(mirror)}
                disabled={connecting !== null}
              >
                <View style={styles.mirrorIcon}>
                  <Ionicons name="tv-outline" size={24} color={colors.primary} />
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
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* No mirrors found state */}
        {!scanning && discoveredMirrors.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="tv-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No mirrors found</Text>
            <Text style={styles.emptyText}>
              Make sure your SkyGlass is powered on and connected to the same network.
            </Text>

            <View style={styles.helpSteps}>
              <View style={styles.helpStep}>
                <View style={styles.helpStepNumber}>
                  <Text style={styles.helpStepNumberText}>1</Text>
                </View>
                <Text style={styles.helpStepText}>
                  For new mirrors, connect to the "SkyGlass-Setup" WiFi network
                </Text>
              </View>
              <View style={styles.helpStep}>
                <View style={styles.helpStepNumber}>
                  <Text style={styles.helpStepNumberText}>2</Text>
                </View>
                <Text style={styles.helpStepText}>
                  For configured mirrors, make sure you're on the same network
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
            style={styles.scanButton}
            onPress={startScan}
            disabled={scanning}
          >
            <Ionicons name="refresh" size={20} color={colors.primary} />
            <Text style={styles.scanButtonText}>Scan Again</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipButtonText}>Set up later</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  scanningContainer: {
    alignItems: 'center',
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  scanningAnimation: {
    marginBottom: spacing.lg,
  },
  scanningText: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  scanningHint: {
    ...typography.caption,
    color: colors.textMuted,
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
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  helpSteps: {
    alignSelf: 'stretch',
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
    alignItems: 'center',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  scanButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  skipButton: {
    alignItems: 'center',
    padding: spacing.md,
  },
  skipButtonText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
