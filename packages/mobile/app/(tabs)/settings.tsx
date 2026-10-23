/**
 * Settings Screen
 * Configure mirror options and manage the app
 */

import { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { isDevBuild } from '@/lib/devBuild';
import { api, type LicenseStatus, type LicenseState, type MirrorOrientation, type UpdateConfig } from '@/lib/api';
import { LICENSE_MANAGE_URL } from '@/lib/license';
import { logError } from '@/lib/errors';
import {
  Button,
  Row,
  RowGroup,
  SectionLabel,
  Spinner,
  Switch,
  Text,
} from '@/components/ui';
import { colors, spacing, typography, fonts } from '@/lib/theme';
import { goHome } from '@/lib/navigation';
import { useUser } from '@/context/UserContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ORIENTATION_LABELS: Record<MirrorOrientation, string> = {
  landscape: 'Landscape',
  'portrait-cw': 'Portrait, right',
  'portrait-ccw': 'Portrait, left',
};

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
  const insets = useSafeAreaInsets();
  const { resetAppData, currentMirror } = useUser();
  const [updateConfig, setUpdateConfig] = useState<UpdateConfig | null>(null);
  const [faces, setFaces] = useState<RegisteredFace[]>([]);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [airport, setAirport] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<MirrorOrientation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  // The license row links to setup/license, which can change the key; re-read
  // the status whenever this screen comes back into focus.
  useFocusEffect(
    useCallback(() => {
      api.getLicenseStatus().then(setLicense).catch(() => {});
      // Shown next to Home airport and Orientation, which can be changed from here.
      api
        .getConfig()
        .then((config) => {
          setAirport(config.airport || null);
          setOrientation(config.display?.orientation ?? null);
        })
        .catch(() => {});
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
        <Spinner size="large" />
      </View>
    );
  }

  const chevron = <Ionicons name="chevron-forward" size={14} color={colors.chevron} />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
    >
      {/* Reached from the tab bar, so a large title instead of a nav header. */}
      <View style={styles.titleBlock}>
        {currentMirror ? <Text style={styles.mirrorName}>{currentMirror.mirrorName}</Text> : null}
        <Text style={styles.largeTitle} accessibilityRole="header">
          Settings
        </Text>
      </View>

      {/* Mirror */}
      <View>
        <SectionLabel>MIRROR</SectionLabel>
        <RowGroup>
          <Row
            title="Home Airport"
            caption={airport ? undefined : 'Change your primary airport'}
            value={airport ?? undefined}
            valueMono
            onPress={() => router.push('/setup/airport')}
          />
          <Row
            title="Orientation"
            caption="How the mirror is mounted"
            value={orientation ? ORIENTATION_LABELS[orientation] : undefined}
            onPress={() => router.push('/setup/orientation')}
          />
          <Row
            title="Location"
            caption="Update location for sun times"
            onPress={() => router.push('/setup/location')}
          />
          <Row
            title="WiFi Network"
            caption="Change WiFi connection"
            onPress={() => router.push('/setup/wifi')}
          />
          <Row
            title="Calendars"
            caption="Connect Google, Outlook, iCloud or a calendar link"
            onPress={() => router.push('/calendars')}
            accessibilityLabel="Calendars"
            accessibilityHint="Connect and manage the calendars shown on the mirror"
          />
        </RowGroup>
      </View>

      {/* Registered Faces */}
      <View>
        <SectionLabel>REGISTERED FACES</SectionLabel>
        <RowGroup>
          {faces.length > 0 ? (
            faces.map((face) => (
              <Row
                key={face.id}
                leading={
                  <View style={styles.faceInitial}>
                    <Text style={styles.faceInitialText}>{face.name.charAt(0).toUpperCase()}</Text>
                  </View>
                }
                title={face.name}
                caption={`Added ${new Date(face.createdAt).toLocaleDateString()}`}
                trailing={
                  <Pressable
                    style={styles.iconButton}
                    onPress={() => deleteFace(face)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${face.name}'s face registration`}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
                  </Pressable>
                }
              />
            ))
          ) : (
            <Row title="No faces registered" style={styles.emptyRow} />
          )}
          <Row
            icon="add"
            title="Add New Face"
            tone="accent"
            onPress={() => router.push('/setup/face')}
          />
        </RowGroup>
      </View>

      {/* Software Updates */}
      <View>
        <SectionLabel>SOFTWARE UPDATES</SectionLabel>
        <RowGroup>
          <Row
            title="Auto-Download Updates"
            caption="Download updates automatically in the background"
            trailing={
              <Switch
                value={updateConfig?.autoDownload ?? true}
                onValueChange={(value) => updateSetting('autoDownload', value)}
                accessibilityLabel="Auto-Download Updates"
              />
            }
          />
          <Row
            title="Auto-Install Updates"
            caption="Automatically install updates when downloaded (requires restart)"
            trailing={
              <Switch
                value={updateConfig?.autoUpdate ?? false}
                onValueChange={(value) => updateSetting('autoUpdate', value)}
                accessibilityLabel="Auto-Install Updates"
              />
            }
          />
          <Row
            title="Check for Updates"
            caption="View available updates and install manually"
            onPress={() => router.push('/updates')}
          />
        </RowGroup>
      </View>

      {/* Access & license */}
      <View>
        <SectionLabel>ACCESS & LICENSE</SectionLabel>
        <RowGroup>
          <Row
            title="Paired phones"
            caption="Phones that can control this mirror"
            onPress={() => router.push('/paired-phones')}
            accessibilityLabel="Paired phones"
            accessibilityHint="See which phones can control this mirror, rename this phone or remove others"
          />
          <Pressable
            onPress={() => router.push('/setup/license')}
            accessibilityRole="button"
            accessibilityLabel="License"
            accessibilityHint="View the license status or enter a different license key"
            style={({ pressed }) => [styles.licenseRow, pressed && styles.pressed]}
          >
            <View style={styles.licenseText}>
              <Text style={styles.rowTitle}>License</Text>
              <Text style={[styles.caption, licenseNeedsAttention && styles.warningText]}>
                {licenseSummary(license)}
              </Text>
            </View>
            {licenseNeedsAttention ? (
              <Ionicons name="warning-outline" size={16} color={colors.warning} />
            ) : null}
            {chevron}
          </Pressable>
          <Row
            title="Manage license"
            caption="Move it to another mirror or have the key re-sent"
            onPress={openLicenseManagement}
            accessibilityHint="Opens skyglass.dev to release the license or re-send the key"
            trailing={<Ionicons name="open-outline" size={14} color={colors.chevron} />}
          />
        </RowGroup>
      </View>

      {/* About & Support */}
      <View>
        <SectionLabel>ABOUT</SectionLabel>
        <View style={styles.rows}>
          <View style={styles.dataRow}>
            <Text style={styles.dataLabel}>App Version</Text>
            <Text style={styles.dataValue}>1.0.0</Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={styles.dataLabel}>Connected To</Text>
            <Text style={[styles.dataValue, styles.dataValueSmall]} numberOfLines={1}>
              {api.getBaseUrl() || 'Not connected'}
            </Text>
          </View>
        </View>
      </View>

      {/* Disconnect */}
      <View style={styles.dangerZone}>
        <Button label="Disconnect Mirror" variant="danger" icon="log-out-outline" onPress={disconnectMirror} />

        {isDevBuild && (
          <Button
            label="Reset App Data (dev)"
            variant="danger"
            size="small"
            icon="refresh-outline"
            onPress={confirmResetAppData}
            style={styles.devReset}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: 28,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  titleBlock: {
    gap: spacing.xs,
  },
  mirrorName: {
    ...typography.label,
    fontFamily: fonts.mono,
    color: colors.textMuted,
  },
  largeTitle: {
    ...typography.h1,
    color: colors.text,
  },
  faceInitial: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grabber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceInitialText: {
    fontSize: 13,
    color: colors.text,
  },
  iconButton: {
    width: 44,
    height: 44,
    marginRight: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRow: {
    opacity: 0.6,
  },
  licenseRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  licenseText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  warningText: {
    color: colors.warning,
  },
  rows: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  dataRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  dataLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
  },
  dataValue: {
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.text,
    flexShrink: 1,
  },
  dataValueSmall: {
    fontSize: 13,
  },
  dangerZone: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  devReset: {
    alignSelf: 'center',
  },
});
