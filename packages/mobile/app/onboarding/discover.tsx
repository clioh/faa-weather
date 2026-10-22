/**
 * Mirror Discovery Screen
 * Part of the onboarding flow - finds and connects to a mirror
 */

import { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
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
import {
  Button,
  Field,
  Footer,
  Notice,
  Row,
  RowGroup,
  SectionLabel,
  Spinner,
  Text,
  TextButton,
} from '@/components/ui';
import { colors, fonts, spacing, typography } from '@/lib/theme';

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

  const emptyState = !scanning && discoveredMirrors.length === 0;

  return (
    <View style={styles.container}>
      {/* Back + Progress Indicator */}
      <View style={{ paddingTop: insets.top + spacing.xs }}>
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
        {/* Header (the empty state's message takes its place) */}
        <View style={styles.header}>
          <Text style={styles.title}>{emptyState ? 'No mirrors found' : 'Find Your Mirror'}</Text>
          <Text style={styles.subtitle}>
            {emptyState
              ? 'Make sure your SkyGlass is powered on and connected to the same network.'
              : "We'll search for SkyGlass devices on your network"}
          </Text>
        </View>

        {/* Discovered mirrors, with the scanning indicator in the label row */}
        {!emptyState && (
          <View>
            <View style={styles.labelRow}>
              <SectionLabel style={styles.labelInRow}>FOUND MIRRORS</SectionLabel>
              {scanning && (
                <View style={styles.scanning}>
                  <Spinner />
                  <Text style={styles.caption}>Scanning network...</Text>
                </View>
              )}
            </View>
            {discoveredMirrors.length === 0 ? (
              <Text style={styles.caption}>This may take a moment</Text>
            ) : (
              <RowGroup>
                {discoveredMirrors.map((mirror) => (
                  <Row
                    key={mirror.id}
                    icon="tv-outline"
                    title={mirror.name}
                    caption={`${mirror.host}:${mirror.port}${mirror.version ? ` • v${mirror.version}` : ''}`}
                    captionMono
                    onPress={() => handleConnect(mirror)}
                    disabled={connecting !== null}
                    trailing={
                      connecting === mirror.id ? (
                        <Spinner />
                      ) : (
                        <Ionicons name="chevron-forward" size={14} color={colors.chevron} />
                      )
                    }
                    // The row being connected stays at full strength.
                    style={[styles.mirrorRow, connecting === mirror.id && styles.active]}
                  />
                ))}
              </RowGroup>
            )}
          </View>
        )}

        {/* Scan error message */}
        {error && !scanning && <Notice tone="warning" message={error} />}

        {/* Connection error message */}
        {connectionError && (
          <InlineError
            message={connectionError}
            onDismiss={() => setConnectionError(null)}
            onRetry={connecting ? undefined : () => setConnectionError(null)}
          />
        )}

        {/* No mirrors found: numbered help steps */}
        {emptyState && (
          <RowGroup>
            <View style={styles.helpStep}>
              <Text style={styles.helpStepNumber}>01</Text>
              <Text style={styles.helpStepText}>
                For new mirrors, connect to the "<Text style={styles.mono}>SkyGlass-Setup</Text>" WiFi network
              </Text>
            </View>
            <View style={styles.helpStep}>
              <Text style={styles.helpStepNumber}>02</Text>
              <Text style={styles.helpStepText}>
                For configured mirrors, make sure you're on the same network
              </Text>
            </View>
          </RowGroup>
        )}

        {/* Manual connection */}
        <View style={styles.manual}>
          <RowGroup>
            <Row
              title="Enter IP manually"
              onPress={() => setShowManual(!showManual)}
              trailing={
                <Ionicons name={showManual ? 'chevron-up' : 'chevron-down'} size={14} color={colors.chevron} />
              }
            />
          </RowGroup>

          {showManual && (
            <View style={styles.manualForm}>
              <Field
                style={styles.manualField}
                mono
                placeholder="IP address (e.g., 192.168.1.100)"
                accessibilityLabel="IP address"
                value={manualHost}
                onChangeText={setManualHost}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleManualConnect}
              />
              <Button
                label="Connect"
                size="small"
                style={styles.connectButton}
                onPress={handleManualConnect}
                disabled={!manualHost.trim() || (connecting !== null && connecting !== 'manual')}
                loading={connecting === 'manual'}
              />
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer */}
      <Footer>
        <Button label="Scan Again" variant="secondary" icon="refresh" onPress={startScan} disabled={scanning} />
        <TextButton label="Set up later" onPress={handleSkip} />
      </Footer>
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
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: 10,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
    marginBottom: 6,
  },
  labelInRow: {
    marginBottom: 0,
  },
  scanning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  mirrorRow: {
    minHeight: 60,
  },
  active: {
    opacity: 1,
  },
  helpStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  helpStepNumber: {
    width: 20,
    paddingTop: 1,
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.primary,
  },
  helpStepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  manual: {
    gap: 10,
  },
  manualForm: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  manualField: {
    flex: 1,
  },
  connectButton: {
    height: 52,
    borderRadius: 14,
    alignSelf: 'auto',
  },
});
