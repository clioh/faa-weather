/**
 * Software Updates Screen
 * Manage mirror software updates from the mobile app
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { api, UpdateStatus } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

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
function CircularProgress({ percent, size = 120 }: { percent: number; size?: number }) {
  const strokeWidth = 8;
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
          stroke={colors.surfaceHighlight}
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
        <ActivityIndicator size="large" color={colors.primary} />
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={checking}
          onRefresh={checkForUpdates}
          tintColor={colors.primary}
        />
      }
    >
      {/* Current version */}
      <View style={styles.versionCard}>
        <View style={styles.versionIcon}>
          <Ionicons name="tv-outline" size={32} color={colors.primary} />
        </View>
        <View style={styles.versionInfo}>
          <Text style={styles.versionLabel}>Current Version</Text>
          <Text style={styles.versionNumber}>v{status?.currentVersion || '0.0.0'}</Text>
        </View>
      </View>

      {/* Update status */}
      {status?.updateAvailable ? (
        <View style={styles.updateCard}>
          {/* Progress indicator when active */}
          {isActive ? (
            <View style={styles.progressContainer}>
              <CircularProgress percent={downloadProgress.percent} />

              <Text style={styles.phaseText}>
                {phaseLabels[downloadProgress.phase]}
              </Text>

              {downloadProgress.phase === 'downloading' && (
                <>
                  <Text style={styles.progressDetail}>
                    {formatBytes(downloadProgress.bytesDownloaded || 0)} / {formatBytes(status.downloadSize)}
                  </Text>
                  <Text style={styles.progressMeta}>
                    {formatSpeed(downloadProgress.speed || 0)}
                    {downloadProgress.eta ? ` • ${formatEta(downloadProgress.eta)}` : ''}
                  </Text>
                </>
              )}
            </View>
          ) : (
            <>
              {/* Update available header */}
              <View style={styles.updateHeader}>
                <View style={styles.updateBadge}>
                  <Ionicons name="arrow-up-circle" size={20} color={colors.primary} />
                  <Text style={styles.updateBadgeText}>Update Available</Text>
                </View>
              </View>

              {/* Version comparison */}
              <View style={styles.versionCompare}>
                <View style={styles.versionBox}>
                  <Text style={styles.versionBoxLabel}>Current</Text>
                  <Text style={styles.versionBoxValue}>v{status.currentVersion}</Text>
                </View>
                <Ionicons name="arrow-forward" size={24} color={colors.textMuted} />
                <View style={[styles.versionBox, styles.versionBoxNew]}>
                  <Text style={styles.versionBoxLabel}>New</Text>
                  <Text style={[styles.versionBoxValue, styles.versionBoxValueNew]}>
                    v{status.latestVersion}
                  </Text>
                </View>
              </View>

              {/* Release info */}
              {status.releaseName && (
                <Text style={styles.releaseName}>{status.releaseName}</Text>
              )}

              {status.publishedAt && (
                <Text style={styles.releaseDate}>
                  Released {formatDate(status.publishedAt)}
                </Text>
              )}

              {/* Download size */}
              <View style={styles.downloadInfo}>
                <Ionicons name="download-outline" size={16} color={colors.textMuted} />
                <Text style={styles.downloadSize}>{formatBytes(status.downloadSize)}</Text>
              </View>

              {/* Downloaded badge */}
              {status.downloadReady && (
                <View style={styles.readyBadge}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  <Text style={styles.readyBadgeText}>Downloaded - Ready to install</Text>
                </View>
              )}

              {/* Release notes */}
              {status.releaseNotes && (
                <View style={styles.releaseNotes}>
                  <Text style={styles.releaseNotesTitle}>What's New</Text>
                  <Text style={styles.releaseNotesText}>
                    {status.releaseNotes.slice(0, 500)}
                    {status.releaseNotes.length > 500 ? '...' : ''}
                  </Text>
                </View>
              )}

              {/* Action buttons */}
              <View style={styles.actions}>
                {status.downloadReady ? (
                  <TouchableOpacity style={styles.installButton} onPress={installUpdate}>
                    <Ionicons name="rocket-outline" size={20} color={colors.background} />
                    <Text style={styles.installButtonText}>Install Now</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.downloadButton} onPress={downloadUpdate}>
                    <Ionicons name="cloud-download-outline" size={20} color={colors.text} />
                    <Text style={styles.downloadButtonText}>Download Update</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={styles.upToDateCard}>
          <View style={styles.upToDateIcon}>
            <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
          </View>
          <Text style={styles.upToDateTitle}>You're Up to Date</Text>
          <Text style={styles.upToDateText}>
            Your SkyGlass is running the latest version
          </Text>
        </View>
      )}

      {/* Error message */}
      {error && (
        <View style={styles.errorCard}>
          <Ionicons name="warning-outline" size={20} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Check for updates button */}
      <TouchableOpacity
        style={styles.checkButton}
        onPress={checkForUpdates}
        disabled={checking || isActive}
      >
        {checking ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <>
            <Ionicons name="refresh" size={20} color={colors.text} />
            <Text style={styles.checkButtonText}>Check for Updates</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Last checked */}
      {status?.lastChecked && (
        <Text style={styles.lastChecked}>
          Last checked: {new Date(status.lastChecked).toLocaleString()}
        </Text>
      )}
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
    paddingBottom: spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  versionIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  versionInfo: {
    flex: 1,
  },
  versionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 2,
  },
  versionNumber: {
    ...typography.h2,
    color: colors.text,
  },
  updateCard: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  progressContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  progressPercent: {
    ...typography.h1,
    color: colors.primary,
  },
  phaseText: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.lg,
  },
  progressDetail: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  progressMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  updateHeader: {
    marginBottom: spacing.lg,
  },
  updateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.full,
  },
  updateBadgeText: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '600',
  },
  versionCompare: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  versionBox: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  versionBoxNew: {
    backgroundColor: colors.primaryMuted,
  },
  versionBoxLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 2,
  },
  versionBoxValue: {
    ...typography.h3,
    color: colors.text,
  },
  versionBoxValueNew: {
    color: colors.primary,
  },
  releaseName: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  releaseDate: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  downloadInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  downloadSize: {
    ...typography.caption,
    color: colors.textMuted,
  },
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  readyBadgeText: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '600',
  },
  releaseNotes: {
    padding: spacing.md,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  releaseNotesTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  releaseNotesText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  actions: {
    gap: spacing.sm,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    backgroundColor: colors.accentMuted,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  downloadButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
  },
  installButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  upToDateCard: {
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upToDateIcon: {
    marginBottom: spacing.md,
  },
  upToDateTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  upToDateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
  },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 48,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  checkButtonText: {
    ...typography.body,
    color: colors.text,
  },
  lastChecked: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
