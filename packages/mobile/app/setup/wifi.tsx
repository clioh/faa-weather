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
import { View, StyleSheet, FlatList } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/lib/api';
import { KeyboardAvoidingScreen, MirrorHandoff } from '@/components';
import { useUser } from '@/context/UserContext';
import { goBack } from '@/lib/navigation';
import { continueSetup } from '@/lib/setupSteps';
import { ensurePaired } from '@/lib/pairing';
import { isSetupHotspot, type FoundMirror } from '@/lib/mirrorLocator';
import { logError } from '@/lib/errors';
import { Button, Field, Footer, Notice, Row, Spinner, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/lib/theme';

interface WifiNetwork {
  ssid: string;
  signal: number;
  secure: boolean;
}

export default function WifiSetupScreen() {
  // 'setup' when opened from the setup checklist; absent from Settings.
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [scanning, setScanning] = useState(true);
  const [selectedNetwork, setSelectedNetwork] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
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
    // In setup, Orientation comes next (then License, which skips itself
    // when licensing is off).
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

  const renderNetwork = ({ item, index }: { item: WifiNetwork; index: number }) => {
    const selected = selectedNetwork?.ssid === item.ssid;
    return (
      <Row
        icon={getSignalIcon(item.signal)}
        title={item.ssid}
        caption={`${item.secure ? 'Secured' : 'Open'} • Signal: ${item.signal}%`}
        selected={selected}
        onPress={() => {
          setSelectedNetwork(item);
          setPassword('');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        trailing={item.secure ? <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} /> : undefined}
        chevron={false}
        // A row under the selected one keeps its hairline hidden too.
        style={index > 0 && networks[index - 1]?.ssid === selectedNetwork?.ssid ? styles.afterSelected : undefined}
      />
    );
  };

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
      <Text style={styles.instructionsText}>
        Select your home WiFi network to connect your mirror to the internet
      </Text>

      {/* Network list */}
      {scanning ? (
        <View style={styles.loadingContainer}>
          <Spinner size="large" />
          <Text style={styles.loadingText}>Scanning for networks...</Text>
        </View>
      ) : (
        <FlatList
          data={networks}
          renderItem={renderNetwork}
          keyExtractor={(item) => item.ssid}
          style={styles.networkList}
          contentContainerStyle={[styles.networkListContent, networks.length > 0 && styles.networkListRows]}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="wifi-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No networks found</Text>
              <Button label="Scan Again" variant="secondary" size="small" icon="refresh" onPress={scanNetworks} style={styles.rescanButton} />
            </View>
          }
        />
      )}

      <View style={styles.form}>
        {/* Password input */}
        {selectedNetwork?.secure && (
          <Field
            label={`Password for "${selectedNetwork.ssid}"`}
            placeholder="Enter WiFi password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            revealable
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleConnect}
          />
        )}

        {/* Error message */}
        {error && <Notice tone="error" message={error} />}
      </View>

      {/* Connect button */}
      <Footer>
        <Button
          label="Connect"
          icon="link"
          onPress={handleConnect}
          disabled={!selectedNetwork}
          loading={connecting}
        />
      </Footer>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  instructionsText: {
    ...typography.body,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  networkListRows: {
    // Bottom hairline under the last row, like a RowGroup.
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    marginHorizontal: spacing.lg,
    paddingHorizontal: 0,
    marginBottom: spacing.md,
  },
  afterSelected: {
    borderTopColor: 'transparent',
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
    alignSelf: 'center',
  },
  form: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
});
