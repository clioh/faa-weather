/**
 * Mirrors Management Screen
 *
 * Allows users to view and manage their linked mirrors,
 * remove mirrors, and manage face enrollment.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { api } from '@/lib/api';
import { LinkedMirror } from '@/lib/storage';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

interface FaceStatus {
  enrolled: boolean;
  enrolledAt?: string;
  samples?: number;
}

export default function MirrorsScreen() {
  const { user, linkedMirrors, removeMirror, setCurrentMirror, updateMirror } = useUser();
  const [expandedMirror, setExpandedMirror] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [faceStatuses, setFaceStatuses] = useState<Record<string, FaceStatus>>({});

  // Fetch face status when a mirror is expanded
  const fetchFaceStatus = useCallback(async (mirror: LinkedMirror) => {
    if (!user) return;

    try {
      api.setBaseUrl(mirror.host, mirror.port);
      const response = await fetch(
        `http://${mirror.host}:5000/api/users/${user.id}/face`
      );

      if (response.ok) {
        const data = await response.json();
        setFaceStatuses(prev => ({
          ...prev,
          [mirror.mirrorId]: {
            enrolled: data.enrolled || false,
            enrolledAt: data.enrolledAt || data.enrolled_at,
            samples: data.samples || 5,
          },
        }));
      } else {
        setFaceStatuses(prev => ({
          ...prev,
          [mirror.mirrorId]: { enrolled: false },
        }));
      }
    } catch (error) {
      // Mirror might be offline
      setFaceStatuses(prev => ({
        ...prev,
        [mirror.mirrorId]: { enrolled: mirror.faceEnrolled },
      }));
    }
  }, [user]);

  // Fetch face status when mirror is expanded
  useEffect(() => {
    if (expandedMirror) {
      const mirror = linkedMirrors.find(m => m.mirrorId === expandedMirror);
      if (mirror && !faceStatuses[mirror.mirrorId]) {
        fetchFaceStatus(mirror);
      }
    }
  }, [expandedMirror, linkedMirrors, faceStatuses, fetchFaceStatus]);

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

  const handleDeleteFaceData = async (mirror: LinkedMirror) => {
    Alert.alert(
      'Delete Face Data',
      `This will permanently delete your face data from "${mirror.mirrorName}". The mirror will no longer recognize you. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoadingAction(`delete-face-${mirror.mirrorId}`);
            try {
              // Connect to the mirror
              api.setBaseUrl(mirror.host, mirror.port);

              // Delete face data
              const response = await fetch(
                `${api.getBaseUrl()}/api/presence/users/${user?.id}/face`,
                { method: 'DELETE' }
              );

              if (response.ok) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Success', 'Face data deleted from this mirror');
              } else {
                throw new Error('Failed to delete');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to delete face data. Make sure the mirror is reachable.');
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
      api.setBaseUrl(mirror.host, mirror.port);
      await api.ping();
      setCurrentMirror(mirror);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/dashboard');
    } catch (error) {
      Alert.alert('Error', 'Unable to connect to mirror. Make sure it\'s online and on the same network.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleEnrollFace = async (mirror: LinkedMirror) => {
    setLoadingAction(`enroll-${mirror.mirrorId}`);
    try {
      api.setBaseUrl(mirror.host, mirror.port);
      await api.ping();
      setCurrentMirror(mirror);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push('/setup/face');
    } catch (error) {
      Alert.alert('Error', 'Unable to connect to mirror for face enrollment.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleUpdateFace = async (mirror: LinkedMirror) => {
    Alert.alert(
      'Update Face Data',
      'This will replace your current face data with new photos. The mirror will use your updated appearance for recognition.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            setLoadingAction(`update-face-${mirror.mirrorId}`);
            try {
              api.setBaseUrl(mirror.host, mirror.port);

              // First delete existing face data
              const deleteResponse = await fetch(
                `http://${mirror.host}:5000/api/users/${user?.id}/face`,
                { method: 'DELETE' }
              );

              if (!deleteResponse.ok) {
                throw new Error('Failed to delete existing face data');
              }

              // Update local state
              setFaceStatuses(prev => ({
                ...prev,
                [mirror.mirrorId]: { enrolled: false },
              }));

              // Update mirror's faceEnrolled status
              if (updateMirror) {
                await updateMirror(mirror.mirrorId, { faceEnrolled: false });
              }

              setCurrentMirror(mirror);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Navigate to face enrollment with re-enrollment flag
              router.push({
                pathname: '/setup/face',
                params: { reenroll: 'true' },
              });
            } catch (error) {
              Alert.alert('Error', 'Failed to start face update. Make sure the mirror is reachable.');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoadingAction(null);
            }
          },
        },
      ]
    );
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Mirrors</Text>
        <View style={styles.headerRight} />
      </View>

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
              onPress={() => router.push('/')}
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
                            {faceStatuses[mirror.mirrorId]?.enrolledAt
                              ? `Enrolled ${formatEnrollmentDate(faceStatuses[mirror.mirrorId].enrolledAt!)}`
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

                    {!mirror.faceEnrolled && (
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleEnrollFace(mirror)}
                        disabled={loadingAction !== null}
                      >
                        {loadingAction === `enroll-${mirror.mirrorId}` ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Ionicons name="scan-outline" size={18} color={colors.primary} />
                            <Text style={styles.actionButtonText}>Enroll Face</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}

                    {mirror.faceEnrolled && (
                      <>
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => handleUpdateFace(mirror)}
                          disabled={loadingAction !== null}
                        >
                          {loadingAction === `update-face-${mirror.mirrorId}` ? (
                            <ActivityIndicator size="small" color={colors.accent} />
                          ) : (
                            <>
                              <Ionicons name="refresh-outline" size={18} color={colors.accent} />
                              <Text style={[styles.actionButtonText, { color: colors.accent }]}>
                                Update Face
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.actionButtonDanger]}
                          onPress={() => handleDeleteFaceData(mirror)}
                          disabled={loadingAction !== null}
                        >
                          {loadingAction === `delete-face-${mirror.mirrorId}` ? (
                            <ActivityIndicator size="small" color={colors.error} />
                          ) : (
                            <>
                              <Ionicons name="trash-outline" size={18} color={colors.error} />
                              <Text style={[styles.actionButtonText, styles.actionButtonTextDanger]}>
                                Delete Face
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    )}

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
            onPress={() => router.push('/')}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.addAnotherText}>Add Another Mirror</Text>
          </TouchableOpacity>
        )}

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
          <Text style={styles.infoText}>
            Each mirror stores your face data locally. When you unlink a mirror, your face data
            remains on that device. Use "Delete Face" to remove it completely.
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.text,
  },
  headerRight: {
    width: 40,
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
