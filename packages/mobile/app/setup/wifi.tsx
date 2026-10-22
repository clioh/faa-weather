/**
 * WiFi Setup Screen
 * Connect mirror to home WiFi network
 *
 * During first setup the phone talks to the mirror over its SkyGlass-Setup
 * hotspot (wifi_provisioning.py on 10.42.0.1:80). Sending the credentials
 * makes the mirror leave the hotspot and join the home network with a new
 * address, so after Connect this screen hands over to MirrorHandoff, which
 * finds the same mirror (by id) on the new network before setup continues.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/lib/api';
import { KeyboardAvoidingScreen, MirrorHandoff } from '@/components';
import { useUser } from '@/context/UserContext';
import { goBack } from '@/lib/navigation';
import { continueSetup } from '@/lib/setupSteps';
import { ensurePaired } from '@/lib/pairing';
import { isSetupHotspot, type FoundMirror } from '@/lib/mirrorLocator';
import { logError } from '@/lib/errors';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

interface WifiNetwork {
  ssid: string;
  signal: number;
  secure: boolean;
}

export default function WifiSetupScreen() {
  const insets = useSafeAreaInsets();
  // 'setup' when opened from the setup checklist; absent from Settings.
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [scanning, setScanning] = useState(true);
  const [selectedNetwork, setSelectedNetwork] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Credentials sent: waiting for the mirror to show up on the new network. */
  const [handoff, setHandoff] = useState<{
    ssid: string;
    mirrorId: string | null;
    fromHotspot: boolean;
  } | null>(null);
  const { user, refresh } = useUser();

  useEffect(() => {
    scanNetworks();
  }, []);

  const scanNetworks = async () => {
    setScanning(true);
    setError(null);

    try {
      const wifiNetworks = await api.getWifiNetworks();
      setNetworks(wifiNetworks);
    } catch (err) {
      setError('Failed to scan for networks');
    } finally {
      setScanning(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedNetwork) return;

    if (selectedNetwork.secure && !password) {
      setError('Password is required for this network');
      return;
    }

    setConnecting(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // The id is what lets us recognise the mirror at its new address.
    let mirrorId = api.getMirrorId();
    const { host, port } = api.getConnectionState();
    if (!mirrorId) {
      mirrorId = (await api.getDiscoveryInfo().catch(() => null))?.mirrorId ?? null;
      if (mirrorId) api.setBaseUrl(host, port, mirrorId);
    }
    const ssid = selectedNetwork.ssid;
    const startHandoff = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHandoff({ ssid, mirrorId, fromHotspot: isSetupHotspot(host, port) });
    };

    try {
      const result = await api.connectWifi(ssid, password);
      if (result.success) {
        startHandoff();
      } else {
        setError(
          result.message || result.error || 'Failed to connect to network. Check the password and try again.'
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === undefined) {
        // No response: the mirror most likely dropped the hotspot as soon as
        // it had the credentials. Look for it on the new network.
        startHandoff();
      } else {
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'Failed to connect to network. Check the password and try again.'
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setConnecting(false);
    }
  };

  /** The mirror answered on the new network: adopt its address and move on. */
  const handleMirrorOnline = async (found: FoundMirror) => {
    await api.moveTo(found.host, found.port);
    // The hotspot has no pairing, so a phone set up through it pairs here,
    // before the first protected call (createUser, setup status, license).
    let paired = false;
    try {
      paired = await ensurePaired({ mirrorName: found.name });
    } catch (err) {
      logError('WifiSetup.ensurePaired', err);
    }
    if (!paired) {
      setHandoff(null);
      setError(
        'The mirror is on your network now, but this phone isn’t paired with it yet. Select the mirror again from the mirror list to pair and finish setup.'
      );
      return;
    }
    // The hotspot's provisioning server can't register users, so this is the
    // first time the mirror hears about this phone's user.
    if (user) {
      try {
        await api.createUser({ id: user.id, name: user.name, preferences: user.preferences });
      } catch (err) {
        logError('WifiSetup.createUser', err);
      }
    }
    await refresh();
    // In setup, License comes next. That screen skips itself when licensing
    // is off and moves on to Location.
    if (flow === 'setup') await continueSetup('wifi');
    else goBack('/dashboard');
  };

  const chooseNetworkAgain = () => {
    setHandoff(null);
    setPassword('');
    scanNetworks();
  };

  const getSignalIcon = (signal: number): keyof typeof Ionicons.glyphMap => {
    if (signal >= 75) return 'wifi';
    if (signal >= 50) return 'wifi';
    if (signal >= 25) return 'wifi';
    return 'wifi-outline';
  };

  const renderNetwork = ({ item }: { item: WifiNetwork }) => (
    <TouchableOpacity
      style={[
        styles.networkItem,
        selectedNetwork?.ssid === item.ssid && styles.networkItemSelected,
      ]}
      onPress={() => {
        setSelectedNetwork(item);
        setPassword('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
    >
      <Ionicons
        name={getSignalIcon(item.signal)}
        size={24}
        color={selectedNetwork?.ssid === item.ssid ? colors.primary : colors.textMuted}
      />
      <View style={styles.networkInfo}>
        <Text
          style={[
            styles.networkName,
            selectedNetwork?.ssid === item.ssid && styles.networkNameSelected,
          ]}
        >
          {item.ssid}
        </Text>
        <Text style={styles.networkMeta}>
          {item.secure ? 'Secured' : 'Open'} • Signal: {item.signal}%
        </Text>
      </View>
      {item.secure && (
        <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );

  if (handoff) {
    return (
      <View style={styles.container}>
        <MirrorHandoff
          ssid={handoff.ssid}
          mirrorId={handoff.mirrorId}
          fromHotspot={handoff.fromHotspot}
          onConnected={handleMirrorOnline}
          onChooseNetwork={chooseNetworkAgain}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      {/* Instructions */}
      <View style={styles.instructions}>
        <Ionicons name="wifi" size={20} color={colors.accent} />
        <Text style={styles.instructionsText}>
          Select your home WiFi network to connect your mirror to the internet
        </Text>
      </View>

      {/* Network list */}
      {scanning ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Scanning for networks...</Text>
        </View>
      ) : (
        <FlatList
          data={networks}
          renderItem={renderNetwork}
          keyExtractor={(item) => item.ssid}
          style={styles.networkList}
          contentContainerStyle={styles.networkListContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="wifi-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>No networks found</Text>
              <TouchableOpacity style={styles.rescanButton} onPress={scanNetworks}>
                <Text style={styles.rescanButtonText}>Scan Again</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Password input */}
      {selectedNetwork?.secure && (
        <View style={styles.passwordContainer}>
          <Text style={styles.passwordLabel}>
            Password for "{selectedNetwork.ssid}"
          </Text>
          <View style={styles.passwordInputContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Enter WiFi password"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleConnect}
            />
            <TouchableOpacity
              style={styles.showPasswordButton}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Ionicons
                name={showPassword ? 'eye-off' : 'eye'}
                size={20}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Error message */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={16} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Connect button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          style={[styles.connectButton, !selectedNetwork && styles.connectButtonDisabled]}
          onPress={handleConnect}
          disabled={!selectedNetwork || connecting}
        >
          {connecting ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <>
              <Ionicons name="link" size={20} color={colors.background} />
              <Text style={styles.connectButtonText}>Connect</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  instructions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    margin: spacing.lg,
    marginBottom: 0,
    backgroundColor: colors.accentMuted,
    borderRadius: borderRadius.md,
  },
  instructionsText: {
    ...typography.bodySmall,
    color: colors.accent,
    flex: 1,
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  networkList: {
    flex: 1,
  },
  networkListContent: {
    padding: spacing.lg,
  },
  networkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  networkItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  networkInfo: {
    flex: 1,
  },
  networkName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
  },
  networkNameSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  networkMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
  rescanButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.md,
  },
  rescanButtonText: {
    ...typography.bodySmall,
    color: colors.text,
  },
  passwordContainer: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  passwordLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  showPasswordButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: borderRadius.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
  },
  footer: {
    padding: spacing.lg,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  connectButtonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  connectButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
