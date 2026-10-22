/**
 * Settings Screen
 * Configure mirror options and manage the app
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { api, type LicenseStatus, type LicenseState, type UpdateConfig } from '@/lib/api';
import { LICENSE_MANAGE_URL } from '@/lib/license';
import { logError } from '@/lib/errors';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { goHome } from '@/lib/navigation';
import { useUser } from '@/context/UserContext';

const LICENSE_STATE_LABELS: Record<LicenseState, string> = {
  active: 'Active',
  disabled: 'Not required',
  unlicensed: 'Not activated',
  expired: 'Reconnect to verify',
  released: 'Released from this mirror',
  revoked: 'Revoked',
  bound_elsewhere: 'In use on another mirror',
};

function licenseSummary(license: LicenseStatus | null): string {
  if (!license) return "Couldn't check the license";
  const label = LICENSE_STATE_LABELS[license.state] ?? license.state;
  return license.keyLast4 ? `${label} · key …${license.keyLast4}` : label;
}

interface RegisteredFace {
  id: string;
  name: string;
  createdAt: string;
}

export default function SettingsScreen() {
  const { resetAppData } = useUser();
  const [updateConfig, setUpdateConfig] = useState<UpdateConfig | null>(null);
  const [faces, setFaces] = useState<RegisteredFace[]>([]);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  // The license row links to setup/license, which can change the key; re-read
  // the status whenever this screen comes back into focus.
  useFocusEffect(
    useCallback(() => {
      api.getLicenseStatus().then(setLicense).catch(() => {});
    }, [])
  );

  const loadSettings = async () => {
    try {
      const [configResponse, facesResponse] = await Promise.all([
        api.getUpdateConfig().catch(() => null),
        api.getRegisteredFaces().catch(() => []),
      ]);
      setUpdateConfig(configResponse);
      setFaces(facesResponse);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: keyof UpdateConfig, value: boolean | number) => {
    if (!updateConfig) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newConfig = { ...updateConfig, [key]: value };
    setUpdateConfig(newConfig);

    try {
      await api.setUpdateConfig({ [key]: value });
    } catch {
      // Revert on error
      setUpdateConfig(updateConfig);
    }
  };

  const openLicenseManagement = () => {
    WebBrowser.openBrowserAsync(license?.manageUrl || LICENSE_MANAGE_URL).catch((err) =>
      logError('Settings.openLicenseManagement', err)
    );
  };

  const licenseNeedsAttention =
    license !== null && license.state !== 'active' && license.state !== 'disabled';

  const deleteFace = async (face: RegisteredFace) => {
    Alert.alert(
      'Delete Face',
      `Are you sure you want to remove ${face.name}'s face registration?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              await api.deleteFace(face.id);
              setFaces(faces.filter(f => f.id !== face.id));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert('Error', 'Failed to delete face registration');
            }
          },
        },
      ]
    );
  };

  const disconnectMirror = () => {
    Alert.alert(
      'Disconnect Mirror',
      'This will disconnect from the current mirror. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            goHome();
          },
        },
      ]
    );
  };

  // Dev builds only: start over from registration without reinstalling Expo Go.
  const confirmResetAppData = () => {
    Alert.alert(
      'Reset App Data',
      'Deletes your profile, linked mirrors and pairing tokens on this phone. The mirror is not changed (npm run setup:dev -- reset does that).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetAppData().catch((err) => logError('Settings.resetAppData', err));
            router.replace('/onboarding');
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Update Settings */}
      <Text style={styles.sectionTitle}>SOFTWARE UPDATES</Text>
      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto-Download Updates</Text>
            <Text style={styles.settingDescription}>
              Download updates automatically in the background
            </Text>
          </View>
          <Switch
            value={updateConfig?.autoDownload ?? true}
            onValueChange={(value) => updateSetting('autoDownload', value)}
            trackColor={{ false: colors.surfaceHighlight, true: colors.primaryMuted }}
            thumbColor={updateConfig?.autoDownload ? colors.primary : colors.textMuted}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto-Install Updates</Text>
            <Text style={styles.settingDescription}>
              Automatically install updates when downloaded (requires restart)
            </Text>
          </View>
          <Switch
            value={updateConfig?.autoUpdate ?? false}
            onValueChange={(value) => updateSetting('autoUpdate', value)}
            trackColor={{ false: colors.surfaceHighlight, true: colors.primaryMuted }}
            thumbColor={updateConfig?.autoUpdate ? colors.primary : colors.textMuted}
          />
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/updates')}
        >
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Check for Updates</Text>
            <Text style={styles.settingDescription}>
              View available updates and install manually
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Registered Faces */}
      <Text style={styles.sectionTitle}>REGISTERED FACES</Text>
      <View style={styles.card}>
        {faces.length > 0 ? (
          faces.map((face, index) => (
            <View key={face.id}>
              {index > 0 && <View style={styles.divider} />}
              <View style={styles.faceRow}>
                <View style={styles.faceIcon}>
                  <Ionicons name="person-circle" size={36} color={colors.primary} />
                </View>
                <View style={styles.faceInfo}>
                  <Text style={styles.faceName}>{face.name}</Text>
                  <Text style={styles.faceDate}>
                    Added {new Date(face.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => deleteFace(face)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${face.name}'s face registration`}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyFaces}>
            <Text style={styles.emptyFacesText}>No faces registered</Text>
          </View>
        )}

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.addFaceButton}
          onPress={() => router.push('/setup/face')}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.addFaceButtonText}>Add New Face</Text>
        </TouchableOpacity>
      </View>

      {/* Calendars */}
      <Text style={styles.sectionTitle}>CALENDARS</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/calendars')}
          accessibilityRole="button"
          accessibilityLabel="Calendars"
          accessibilityHint="Connect and manage the calendars shown on the mirror"
        >
          <View style={styles.settingIconContainer}>
            <Ionicons name="calendar-outline" size={20} color="#ff6b6b" />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Calendars</Text>
            <Text style={styles.settingDescription}>Connect Google, Outlook, iCloud or a calendar link</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Mirror Settings */}
      <Text style={styles.sectionTitle}>MIRROR CONFIGURATION</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/setup/airport')}
        >
          <View style={styles.settingIconContainer}>
            <Ionicons name="airplane-outline" size={20} color={colors.warning} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Home Airport</Text>
            <Text style={styles.settingDescription}>Change your primary airport</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/setup/location')}
        >
          <View style={styles.settingIconContainer}>
            <Ionicons name="location-outline" size={20} color={colors.accent} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Location</Text>
            <Text style={styles.settingDescription}>Update location for sun times</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/setup/wifi')}
        >
          <View style={styles.settingIconContainer}>
            <Ionicons name="wifi-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>WiFi Network</Text>
            <Text style={styles.settingDescription}>Change WiFi connection</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Paired phones */}
      <Text style={styles.sectionTitle}>PAIRED PHONES</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/paired-phones')}
          accessibilityRole="button"
          accessibilityLabel="Paired phones"
          accessibilityHint="See which phones can control this mirror, rename this phone or remove others"
        >
          <View style={styles.settingIconContainer}>
            <Ionicons name="phone-portrait-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Paired phones</Text>
            <Text style={styles.settingDescription}>Phones that can control this mirror</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* License */}
      <Text style={styles.sectionTitle}>LICENSE</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/setup/license')}
          accessibilityRole="button"
          accessibilityLabel="License"
          accessibilityHint="View the license status or enter a different license key"
        >
          <View style={styles.settingIconContainer}>
            <Ionicons
              name="key-outline"
              size={20}
              color={licenseNeedsAttention ? colors.warning : colors.primary}
            />
          </View>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>License</Text>
            <Text
              style={[
                styles.settingDescription,
                licenseNeedsAttention && { color: colors.warning },
              ]}
            >
              {licenseSummary(license)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.settingRow}
          onPress={openLicenseManagement}
          accessibilityRole="link"
          accessibilityHint="Opens skyglass.dev to release the license or re-send the key"
        >
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Manage license</Text>
            <Text style={styles.settingDescription}>
              Move it to another mirror or have the key re-sent
            </Text>
          </View>
          <Ionicons name="open-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* About & Support */}
      <Text style={styles.sectionTitle}>ABOUT</Text>
      <View style={styles.card}>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>App Version</Text>
          <Text style={styles.aboutValue}>1.0.0</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Connected To</Text>
          <Text style={styles.aboutValue}>{api.getBaseUrl() || 'Not connected'}</Text>
        </View>
      </View>

      {/* Disconnect */}
      <TouchableOpacity style={styles.disconnectButton} onPress={disconnectMirror}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.disconnectButtonText}>Disconnect Mirror</Text>
      </TouchableOpacity>

      {__DEV__ && (
        <TouchableOpacity style={styles.disconnectButton} onPress={confirmResetAppData}>
          <Ionicons name="refresh-outline" size={20} color={colors.error} />
          <Text style={styles.disconnectButtonText}>Reset App Data (dev)</Text>
        </TouchableOpacity>
      )}

      {/* Footer spacing */}
      <View style={styles.footerSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  settingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
    marginBottom: 2,
  },
  settingDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  faceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  faceIcon: {
    marginRight: spacing.md,
  },
  faceInfo: {
    flex: 1,
  },
  faceName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
  },
  faceDate: {
    ...typography.caption,
    color: colors.textMuted,
  },
  deleteButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyFaces: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyFacesText: {
    ...typography.body,
    color: colors.textMuted,
  },
  addFaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  addFaceButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '500',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  aboutLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  aboutValue: {
    ...typography.body,
    color: colors.text,
    fontFamily: 'monospace',
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 68, 68, 0.3)',
  },
  disconnectButtonText: {
    ...typography.body,
    color: colors.error,
    fontWeight: '500',
  },
  footerSpace: {
    height: spacing.xxl,
  },
});
