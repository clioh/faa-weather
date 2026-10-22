/**
 * Home Screen
 * Mirror discovery and connection with user profile
 */

import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useMirrorDiscovery } from '@/hooks/useMirrorDiscovery';
import { api, MirrorDevice } from '@/lib/api';
import { storage, LinkedMirror } from '@/lib/storage';
import {
  Badge,
  Button,
  Field,
  Footer,
  Notice,
  Row,
  RowGroup,
  SectionLabel,
  Spinner,
  Text,
} from '@/components/ui';
import { colors, fonts, spacing, typography } from '@/lib/theme';
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
        <Spinner size="large" />
      </View>
    );
  }

  const newMirrors = discoveredMirrors.filter(
    (d) => !linkedMirrors.some((l) => l.host === d.host && l.port === d.port)
  );

  // Merge linked mirrors with discovered (prioritize linked)
  const allMirrors = [
    ...linkedMirrors.map((m) => ({ ...m, isLinked: true })),
    ...newMirrors.map((m) => ({ ...m, isLinked: false })),
  ];

  const chevron = <Ionicons name="chevron-forward" size={14} color={colors.chevron} />;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.md }]}
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
          <Pressable
            style={({ pressed }) => [styles.profileHeader, pressed && styles.pressed]}
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel={`Hello, ${user.name}. Open profile`}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.greeting}>Hello, {user.name}</Text>
              <Text style={styles.caption}>
                {linkedMirrors.length} mirror{linkedMirrors.length !== 1 ? 's' : ''} linked
              </Text>
            </View>
            {chevron}
          </Pressable>
        )}

        {/* Title */}
        <View style={styles.header}>
          <Text style={styles.title}>Connect to Mirror</Text>
          <Text style={styles.subtitle}>
            {linkedMirrors.length > 0
              ? 'Select a mirror to connect'
              : 'Find your mirror on the network'}
          </Text>
        </View>

        {/* Error message */}
        {error && !scanning && linkedMirrors.length === 0 && (
          <Notice tone="warning" message={error} />
        )}

        {/* Linked Mirrors (saved) */}
        {linkedMirrors.length > 0 && (
          <View>
            <SectionLabel>MY MIRRORS</SectionLabel>
            <RowGroup>
              {linkedMirrors.map((mirror) => (
                <Row
                  key={mirror.mirrorId}
                  icon={mirror.faceEnrolled ? 'person-circle-outline' : 'tv-outline'}
                  title={mirror.mirrorName}
                  caption={
                    <>
                      <Text style={styles.mono}>{`${mirror.host}:${mirror.port}`}</Text>
                      {mirror.faceEnrolled && ' • Face enrolled'}
                    </>
                  }
                  onPress={() => handleConnect(mirror)}
                  disabled={connecting !== null}
                  trailing={connecting === mirror.mirrorId ? <Spinner /> : chevron}
                  style={connecting === mirror.mirrorId ? styles.active : undefined}
                />
              ))}
            </RowGroup>
          </View>
        )}

        {/* Discovered Mirrors (not yet linked); the scan indicator sits in the label row */}
        {(newMirrors.length > 0 || scanning) && (
          <View>
            <View style={styles.labelRow}>
              <SectionLabel style={styles.labelInRow}>DISCOVERED ON NETWORK</SectionLabel>
              {scanning && (
                <View style={styles.scanning}>
                  <Spinner />
                  <Text style={styles.caption}>Scanning network...</Text>
                </View>
              )}
            </View>
            {newMirrors.length > 0 && (
              <RowGroup>
                {newMirrors.map((mirror) => (
                  <Row
                    key={mirror.id}
                    icon={mirror.setupComplete ? 'tv-outline' : 'construct-outline'}
                    title={mirror.name}
                    caption={`${mirror.host}:${mirror.port}${mirror.version ? ` • v${mirror.version}` : ''}`}
                    captionMono
                    onPress={() => handleConnect(mirror)}
                    disabled={connecting !== null}
                    trailing={connecting === mirror.id ? <Spinner /> : <Badge label="NEW" />}
                    style={connecting === mirror.id ? styles.active : undefined}
                  />
                ))}
              </RowGroup>
            )}
          </View>
        )}

        {/* Instructions when no mirrors found */}
        {!scanning && allMirrors.length === 0 && (
          <View style={styles.instructions}>
            <View style={styles.header}>
              <Text style={styles.instructionsTitle}>No mirrors found</Text>
              <Text style={styles.subtitle}>
                Make sure your SkyGlass is powered on and connected to the same network,
                or connect to its WiFi hotspot for initial setup.
              </Text>
            </View>

            <RowGroup>
              <View style={styles.helpStep}>
                <Text style={styles.helpStepNumber}>01</Text>
                <Text style={styles.helpStepText}>
                  For new mirrors: Connect to the "<Text style={styles.mono}>SkyGlass-Setup</Text>" WiFi network
                </Text>
              </View>
              <View style={styles.helpStep}>
                <Text style={styles.helpStepNumber}>02</Text>
                <Text style={styles.helpStepText}>
                  For configured mirrors: Make sure you're on the same WiFi network
                </Text>
              </View>
            </RowGroup>
          </View>
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

      {/* Action buttons */}
      <Footer style={styles.footer}>
        <Button
          label="Scan Again"
          variant="secondary"
          icon="refresh"
          onPress={startScan}
          disabled={scanning}
          style={styles.footerButton}
        />
        {linkedMirrors.length > 0 && (
          <Button
            label="Manage Mirrors"
            variant="secondary"
            icon="layers-outline"
            onPress={() => router.push('/mirrors')}
            style={styles.footerButton}
          />
        )}
      </Footer>
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
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: 26,
  },
  pressed: {
    opacity: 0.7,
  },
  profileHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.switchOffBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    color: colors.text,
  },
  profileInfo: {
    flex: 1,
    gap: 2,
  },
  greeting: {
    fontSize: 15,
    color: colors.text,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  active: {
    opacity: 1,
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
  instructions: {
    gap: spacing.lg,
  },
  instructionsTitle: {
    ...typography.h3,
    color: colors.text,
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
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerButton: {
    flex: 1,
    alignSelf: 'auto',
  },
});
