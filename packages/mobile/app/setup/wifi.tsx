/**
 * WiFi Setup Screen
 * Connect mirror to home WiFi network
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
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

interface WifiNetwork {
  ssid: string;
  signal: number;
  secure: boolean;
}

export default function WifiSetupScreen() {
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [scanning, setScanning] = useState(true);
  const [selectedNetwork, setSelectedNetwork] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    try {
      const result = await api.connectWifi(selectedNetwork.ssid, password);

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        Alert.alert(
          'WiFi Connected',
          `Your mirror is now connected to ${selectedNetwork.ssid}. The mirror will restart and join your home network.`,
          [
            {
              text: 'Continue',
              onPress: () => router.back(),
            },
          ]
        );
      } else {
        throw new Error('Connection failed');
      }
    } catch (err) {
      setError('Failed to connect to network. Check the password and try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setConnecting(false);
    }
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

  return (
    <View style={styles.container}>
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
      <View style={styles.footer}>
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
    </View>
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
    padding: spacing.md,
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
    paddingBottom: spacing.xl,
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
