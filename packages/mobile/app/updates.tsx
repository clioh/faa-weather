/**
 * Software Updates Screen
 * Manage mirror software updates from the mobile app
 */

import { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { api, UpdateStatus } from '@/lib/api';
import { Button, Footer, Notice, SectionLabel, Spinner, Text, TextButton } from '@/components/ui';
import { colors, fonts, spacing, typography } from '@/lib/theme';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s';
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s remaining`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m remaining`;
  return `${Math.round(seconds / 3600)}h remaining`;
}

function formatDate(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Circular progress component
function CircularProgress({ percent, size = 200 }: { percent: number; size?: number }) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        {/* Background circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.ringTrack}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.primary}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={styles.progressPercent}>{percent}%</Text>
        </View>
      </View>
    </View>
  );
}

export default function UpdatesScreen() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A pull shows the RefreshControl spinner; the button shows its own when
  // tapped. Never both.
  const [pulled, setPulled] = useState(false);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const updateStatus = await api.getUpdateStatus();
      setStatus(updateStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load update status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Poll while downloading/installing
  useEffect(() => {
    if (status?.downloadProgress.phase === 'downloading' ||
        status?.downloadProgress.phase === 'extracting' ||
        status?.downloadProgress.phase === 'installing') {
      const interval = setInterval(loadStatus, 1000);
      setPollInterval(interval);
      return () => clearInterval(interval);
    } else if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [status?.downloadProgress.phase]);

  const checkForUpdates = async () => {
    setChecking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const updateStatus = await api.checkForUpdates();
      setStatus(updateStatus);

      if (!updateStatus.updateAvailable) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setChecking(false);
    }
  };

  const downloadUpdate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await api.downloadUpdate();
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download update');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const installUpdate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      await api.applyUpdate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install update');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Spinner size="large" />
      </View>
    );
  }

  const { downloadProgress } = status || { downloadProgress: { phase: 'idle', percent: 0 } };
  const isActive = ['downloading', 'extracting', 'installing'].includes(downloadProgress.phase);

  const phaseLabels: Record<string, string> = {
    idle: 'Ready',
    downloading: 'Downloading Update',
    extracting: 'Extracting Files',
    installing: 'Installing Update',
    complete: 'Complete',
    error: 'Error',
  };

  const updateAvailable = !!status?.updateAvailable;
  const lastChecked = status?.lastChecked ? (
    <Text style={styles.lastChecked}>
      Last checked: {new Date(status.lastChecked).toLocaleString()}
    </Text>
  ) : null;
  const currentVersionRow = (
    <View style={styles.rows}>
      <View style={styles.dataRow}>
        <Text style={styles.dataLabel}>Current Version</Text>
        <Text style={styles.dataValue}>v{status?.currentVersion || '0.0.0'}</Text>
      </View>
    </View>
  );
  const phaseIndex = PHASES.indexOf(downloadProgress.phase as (typeof PHASES)[number]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={pulled}
            onRefresh={async () => {
              setPulled(true);
              try {
                await checkForUpdates();
              } finally {
                setPulled(false);
              }
            }}
            tintColor={colors.primary}
          />
        }
      >
        {updateAvailable && status && isActive ? (
          /* Progress while downloading / extracting / installing */
          <View style={styles.progressContainer}>
            <CircularProgress percent={downloadProgress.percent} />

            <View style={styles.progressText}>
              <Text style={styles.phaseText}>{phaseLabels[downloadProgress.phase]}</Text>
              {downloadProgress.phase === 'downloading' && (
                <>
                  <Text style={styles.monoCaption}>
                    {formatBytes(downloadProgress.bytesDownloaded || 0)} / {formatBytes(status.downloadSize)}
                  </Text>
                  <Text style={styles.monoCaption}>
                    {formatSpeed(downloadProgress.speed || 0)}
                    {downloadProgress.eta ? ` • ${formatEta(downloadProgress.eta)}` : ''}
                  </Text>
                </>
              )}
            </View>

            {/* Phase bar */}
            <View style={styles.phaseBar}>
              {PHASES.map((phase, i) => (
                <View key={phase} style={styles.phaseStep}>
                  <View style={[styles.phaseSegment, i <= phaseIndex && styles.phaseSegmentDone]} />
                  <Text style={[styles.phaseLabel, i === phaseIndex && styles.phaseLabelCurrent]}>
                    {PHASE_STEP_LABELS[phase]}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.spacer} />
            {currentVersionRow}
          </View>
        ) : updateAvailable && status ? (
          <>
            {/* Update available header */}
            <View style={styles.statusLabel}>
              <Ionicons name="arrow-up-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.statusLabelText}>Update Available</Text>
            </View>

            {/* Version comparison */}
            <View style={styles.versionCompare}>
              <View style={styles.versionBox}>
                <Text style={styles.caption}>Current</Text>
                <Text style={[styles.versionValue, styles.versionValueOld]}>v{status.currentVersion}</Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color={colors.progressLabel} />
              <View style={styles.versionBox}>
                <Text style={styles.caption}>New</Text>
                <Text style={styles.versionValue}>v{status.latestVersion}</Text>
              </View>
            </View>

            {/* Release info */}
            <View style={styles.releaseInfo}>
              {status.releaseName && <Text style={styles.releaseName}>{status.releaseName}</Text>}
              <Text style={styles.caption}>
                {status.publishedAt ? `Released ${formatDate(status.publishedAt)} · ` : ''}
                <Text style={styles.mono}>{formatBytes(status.downloadSize)}</Text>
              </Text>
            </View>

            {/* Downloaded badge */}
            {status.downloadReady && (
              <View style={styles.statusLabel}>
                <Ionicons name="checkmark" size={18} color={colors.success} />
                <Text style={styles.readyText}>Downloaded - Ready to install</Text>
              </View>
            )}

            {/* Release notes */}
            {status.releaseNotes && (
              <View style={styles.releaseNotes}>
                <SectionLabel>What's New</SectionLabel>
                <Text style={styles.releaseNotesText}>
                  {status.releaseNotes.slice(0, 500)}
                  {status.releaseNotes.length > 500 ? '...' : ''}
                </Text>
              </View>
            )}

            <View style={styles.spacer} />
            {lastChecked}
          </>
        ) : (
          <>
            <View style={styles.upToDate}>
              <View style={styles.upToDateIcon}>
                <Ionicons name="checkmark" size={32} color={colors.primary} />
              </View>
              <View style={styles.upToDateText}>
                <Text style={styles.upToDateTitle}>You're Up to Date</Text>
                <Text style={styles.body}>Your SkyGlass is running the latest version</Text>
              </View>
            </View>
            {currentVersionRow}
            <View style={styles.spacer} />
            {lastChecked}
          </>
        )}

        {/* Error message */}
        {error && <Notice tone="error" message={error} />}
      </ScrollView>

      <Footer>
        {updateAvailable && status && !isActive ? (
          <>
            {status.downloadReady ? (
              <Button label="Install Now" icon="rocket-outline" onPress={installUpdate} />
            ) : (
              <Button label="Download Update" icon="cloud-download-outline" onPress={downloadUpdate} />
            )}
            <TextButton label="Check for Updates" onPress={checkForUpdates} disabled={checking} />
          </>
        ) : (
          <Button
            label="Check for Updates"
            variant="secondary"
            icon="refresh"
            onPress={checkForUpdates}
            disabled={isActive}
            loading={checking && !pulled}
          />
        )}
      </Footer>
    </View>
  );
}

const PHASES = ['downloading', 'extracting', 'installing'] as const;
const PHASE_STEP_LABELS: Record<(typeof PHASES)[number], string> = {
  downloading: 'Download',
  extracting: 'Extract',
  installing: 'Install',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  spacer: {
    flex: 1,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  monoCaption: {
    ...typography.caption,
    fontFamily: fonts.mono,
    color: colors.textMuted,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  progressContainer: {
    flexGrow: 1,
    alignItems: 'center',
    gap: 28,
    paddingTop: 40,
  },
  progressPercent: {
    ...typography.hero,
    fontSize: 52,
    color: colors.text,
  },
  progressText: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  phaseText: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
  },
  phaseBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 6,
  },
  phaseStep: {
    flex: 1,
    gap: 6,
  },
  phaseSegment: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.progressPending,
  },
  phaseSegmentDone: {
    backgroundColor: colors.primary,
  },
  phaseLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  phaseLabelCurrent: {
    color: colors.text,
  },
  rows: {
    alignSelf: 'stretch',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  dataRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
  },
  statusLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusLabelText: {
    ...typography.label,
    color: colors.primary,
  },
  readyText: {
    ...typography.bodySmall,
    color: colors.text,
  },
  versionCompare: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  versionBox: {
    gap: 2,
  },
  versionValue: {
    fontFamily: fonts.mono,
    fontSize: 22,
    color: colors.text,
  },
  versionValueOld: {
    color: colors.textSecondary,
  },
  releaseInfo: {
    gap: spacing.xs,
  },
  releaseName: {
    ...typography.h3,
    color: colors.text,
  },
  releaseNotes: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  releaseNotesText: {
    ...typography.bodySmall,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  upToDate: {
    gap: spacing.lg,
    paddingTop: spacing.xl,
  },
  upToDateIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upToDateText: {
    gap: 10,
  },
  upToDateTitle: {
    ...typography.h1,
    color: colors.text,
  },
  lastChecked: {
    ...typography.caption,
    fontFamily: fonts.mono,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
