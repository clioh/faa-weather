/**
 * Mirrors Management Screen
 *
 * Lists the mirrors this phone is linked to, to reconnect to or unlink
 * them. Faces are managed per mirror in Settings.
 */

import { useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { api } from '@/lib/api';
import { LinkedMirror } from '@/lib/storage';
import { Badge, Button, Notice, Text, TextButton } from '@/components/ui';
import { colors, fonts, spacing, typography } from '@/lib/theme';
import { ScreenHeader, goToManualEntry } from '@/components';
import { goHome, goToDashboard } from '@/lib/navigation';
import { ensurePaired } from '@/lib/pairing';

export default function MirrorsScreen() {
  const { linkedMirrors, removeMirror, setCurrentMirror } = useUser();
  const [expandedMirror, setExpandedMirror] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleRemoveMirror = async (mirror: LinkedMirror) => {
    Alert.alert(
      'Remove mirror',
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
      <ScreenHeader title="My mirrors" fallbackHref="/" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Mirror Count */}
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{linkedMirrors.length}</Text>
            <Text style={styles.statLabel}>
              Mirror{linkedMirrors.length !== 1 ? 's' : ''} Linked
            </Text>
          </View>
          <View style={[styles.stat, styles.statSecond]}>
            <Text style={styles.statValue}>
              {linkedMirrors.filter((m) => m.faceEnrolled).length}
            </Text>
            <Text style={styles.statLabel}>Face enrolled</Text>
          </View>
        </View>

        {/* Mirrors List */}
        {linkedMirrors.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="tv-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No mirrors linked</Text>
            <Text style={styles.emptyText}>
              Link a mirror to control it from your phone and enable personalized features.
            </Text>
            <Button label="Find a mirror" icon="add" onPress={goHome} />
          </View>
        ) : (
          <View style={styles.mirrorsList}>
            {linkedMirrors.map((mirror) => {
              const expanded = expandedMirror === mirror.mirrorId;
              return (
                <View key={mirror.mirrorId} style={styles.mirrorItem}>
                  <Pressable
                    style={({ pressed }) => [styles.mirrorRow, pressed && styles.pressed]}
                    onPress={() => setExpandedMirror(expanded ? null : mirror.mirrorId)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                  >
                    <Ionicons
                      name={mirror.faceEnrolled ? 'person-circle-outline' : 'tv-outline'}
                      size={22}
                      color={colors.text}
                    />
                    <View style={styles.mirrorInfo}>
                      <Text style={styles.mirrorName}>{mirror.mirrorName}</Text>
                      <Text style={styles.mirrorMeta}>
                        <Text style={styles.mono}>{`${mirror.host}:${mirror.port}`}</Text>
                        {` · Last: ${formatLastConnected(mirror.lastConnected)}`}
                      </Text>
                    </View>
                    {mirror.faceEnrolled ? (
                      <Badge
                        label={
                          mirror.enrolledAt
                            ? `Enrolled ${formatEnrollmentDate(mirror.enrolledAt)}`
                            : 'Face enrolled'
                        }
                      />
                    ) : (
                      <Badge label="No Face Data" tone="warning" />
                    )}
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={colors.chevron}
                    />
                  </Pressable>

                  {/* Expanded Actions */}
                  {expanded && (
                    <View style={styles.actionsContainer}>
                      <Button
                        label="Connect"
                        size="small"
                        onPress={() => handleConnect(mirror)}
                        disabled={
                          loadingAction !== null && loadingAction !== `connect-${mirror.mirrorId}`
                        }
                        loading={loadingAction === `connect-${mirror.mirrorId}`}
                      />
                      <Button
                        label="Unlink"
                        size="small"
                        variant="danger"
                        onPress={() => handleRemoveMirror(mirror)}
                        disabled={
                          loadingAction !== null && loadingAction !== `remove-${mirror.mirrorId}`
                        }
                        loading={loadingAction === `remove-${mirror.mirrorId}`}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Add Another Mirror */}
        {linkedMirrors.length > 0 && (
          <TextButton
            label="Add another mirror"
            icon="add"
            onPress={goHome}
            style={styles.addAnother}
          />
        )}

        <View style={styles.spacer} />

        {/* Info Box */}
        <Notice
          tone="info"
          message="Each mirror stores its face data locally. Unlinking a mirror leaves that data on the device; to add or remove faces, connect to the mirror and open Settings."
        />
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
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  stat: {
    flex: 1,
    paddingVertical: spacing.md,
    gap: 2,
  },
  statSecond: {
    paddingLeft: spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: colors.hairline,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '200',
    color: colors.text,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  mirrorsList: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  mirrorItem: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  mirrorRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  mirrorInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  mirrorName: {
    fontSize: 15,
    color: colors.text,
  },
  mirrorMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingLeft: 36,
    paddingBottom: 14,
  },
  addAnother: {
    alignSelf: 'flex-start',
  },
  spacer: {
    flex: 1,
  },
});
