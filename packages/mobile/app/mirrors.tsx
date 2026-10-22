/**
 * Mirrors Management Screen
 *
 * Lists the mirrors this phone is linked to, to reconnect to or unlink
 * them. Faces are managed per mirror in Settings.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { api } from '@/lib/api';
import { LinkedMirror } from '@/lib/storage';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { ScreenHeader, goToManualEntry } from '@/components';
import { goHome, goToDashboard } from '@/lib/navigation';
import { ensurePaired } from '@/lib/pairing';

export default function MirrorsScreen() {
  const { linkedMirrors, removeMirror, setCurrentMirror } = useUser();
  const [expandedMirror, setExpandedMirror] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleRemoveMirror = async (mirror: LinkedMirror) => {
    Alert.alert(
      'Remove Mirror',
      `Are you sure you want to remove "${mirror.mirrorName}"? Your face data on this mirror will not be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setLoadingAction(`remove-${mirror.mirrorId}`);
            try {
              await removeMirror(mirror.mirrorId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              Alert.alert('Error', 'Failed to remove mirror');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoadingAction(null);
            }
          },
        },
      ]
    );
  };

  const handleConnect = async (mirror: LinkedMirror) => {
    setLoadingAction(`connect-${mirror.mirrorId}`);
    try {
      // With the id set, a failed ping searches for the mirror and follows it
      // to a new address (saved by the API client).
      api.setBaseUrl(mirror.host, mirror.port, mirror.mirrorId);
      await api.ping();
      // An unpaired (or revoked) phone pairs before anything else.
      if (!(await ensurePaired({ mirrorName: mirror.mirrorName }))) return;
      const { host, port } = api.getConnectionState();
      setCurrentMirror({ ...mirror, host, port });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      goToDashboard();
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Mirror not found',
        `${mirror.mirrorName} didn't answer at ${mirror.host} and wasn't found on this network. Make sure it's powered on and your phone is on the same WiFi.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Enter address manually', onPress: goToManualEntry },
          {
            text: 'Search again',
            onPress: () => {
              void handleConnect(mirror);
            },
          },
        ]
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const formatLastConnected = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatEnrollmentDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="My Mirrors" fallbackHref="/" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Mirror Count */}
        <View style={styles.statsCard}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{linkedMirrors.length}</Text>
            <Text style={styles.statLabel}>
              Mirror{linkedMirrors.length !== 1 ? 's' : ''} Linked
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {linkedMirrors.filter((m) => m.faceEnrolled).length}
            </Text>
            <Text style={styles.statLabel}>Face Enrolled</Text>
          </View>
        </View>

        {/* Mirrors List */}
        {linkedMirrors.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="tv-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No Mirrors Linked</Text>
            <Text style={styles.emptyText}>
              Link a mirror to control it from your phone and enable personalized features.
            </Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={goHome}
            >
              <Ionicons name="add" size={20} color={colors.background} />
              <Text style={styles.addButtonText}>Find a Mirror</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mirrorsList}>
            {linkedMirrors.map((mirror) => (
              <View key={mirror.mirrorId}>
                <TouchableOpacity
                  style={styles.mirrorCard}
                  onPress={() =>
                    setExpandedMirror(
                      expandedMirror === mirror.mirrorId ? null : mirror.mirrorId
                    )
                  }
                  activeOpacity={0.7}
                >
                  <View style={styles.mirrorIconContainer}>
                    <Ionicons
                      name={mirror.faceEnrolled ? 'person-circle' : 'tv'}
                      size={28}
                      color={colors.primary}
                    />
                  </View>
                  <View style={styles.mirrorInfo}>
                    <Text style={styles.mirrorName}>{mirror.mirrorName}</Text>
                    <Text style={styles.mirrorHost}>
                      {mirror.host}:{mirror.port}
                    </Text>
                    <View style={styles.mirrorMeta}>
                      {mirror.faceEnrolled ? (
                        <View style={styles.badge}>
                          <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                          <Text style={styles.badgeText}>
                            {mirror.enrolledAt
                              ? `Enrolled ${formatEnrollmentDate(mirror.enrolledAt)}`
                              : 'Face Enrolled'}
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.badge, styles.badgeWarning]}>
                          <Ionicons name="alert-circle" size={12} color={colors.warning} />
                          <Text style={[styles.badgeText, styles.badgeWarningText]}>
                            No Face Data
                          </Text>
                        </View>
                      )}
                      <Text style={styles.lastConnected}>
                        Last: {formatLastConnected(mirror.lastConnected)}
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={expandedMirror === mirror.mirrorId ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Expanded Actions */}
                {expandedMirror === mirror.mirrorId && (
                  <View style={styles.actionsContainer}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleConnect(mirror)}
                      disabled={loadingAction !== null}
                    >
                      {loadingAction === `connect-${mirror.mirrorId}` ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <>
                          <Ionicons name="enter-outline" size={18} color={colors.primary} />
                          <Text style={styles.actionButtonText}>Connect</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionButton, styles.actionButtonDanger]}
                      onPress={() => handleRemoveMirror(mirror)}
                      disabled={loadingAction !== null}
                    >
                      {loadingAction === `remove-${mirror.mirrorId}` ? (
                        <ActivityIndicator size="small" color={colors.error} />
                      ) : (
                        <>
                          <Ionicons name="unlink-outline" size={18} color={colors.error} />
                          <Text style={[styles.actionButtonText, styles.actionButtonTextDanger]}>
                            Unlink
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Add Another Mirror */}
        {linkedMirrors.length > 0 && (
          <TouchableOpacity
            style={styles.addAnotherButton}
            onPress={goHome}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.addAnotherText}>Add Another Mirror</Text>
          </TouchableOpacity>
        )}

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
          <Text style={styles.infoText}>
            Each mirror stores its face data locally. Unlinking a mirror leaves that data on the
            device; to add or remove faces, connect to the mirror and open Settings.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.h1,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl * 2,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: {
    marginBottom: spacing.lg,
    opacity: 0.5,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    lineHeight: 22,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  addButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  mirrorsList: {
    gap: spacing.md,
  },
  mirrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mirrorIconContainer: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.lg,
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
    marginBottom: spacing.xs,
  },
  mirrorMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: 'rgba(0, 255, 136, 0.15)',
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    ...typography.label,
    color: colors.success,
    fontSize: 10,
  },
  badgeWarning: {
    backgroundColor: 'rgba(255, 170, 0, 0.15)',
  },
  badgeWarningText: {
    color: colors.warning,
  },
  lastConnected: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  actionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomLeftRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.lg,
    marginTop: -spacing.sm,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonText: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '500',
  },
  actionButtonDanger: {
    borderColor: 'rgba(255, 82, 82, 0.3)',
  },
  actionButtonTextDanger: {
    color: colors.error,
  },
  addAnotherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addAnotherText: {
    ...typography.body,
    color: colors.primary,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
});
