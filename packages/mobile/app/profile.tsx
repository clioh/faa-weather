/**
 * Profile Screen
 *
 * Allows users to view and edit their profile, and see their linked mirrors.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
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
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

export default function ProfileScreen() {
  const { user, updateProfile, linkedMirrors } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }

    if (trimmedName.length < 2) {
      Alert.alert('Error', 'Name must be at least 2 characters');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({ name: trimmedName });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsEditing(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to save profile');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setName(user?.name || '');
    setIsEditing(false);
  };

  if (!user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

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
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.headerRight}>
          {!isEditing ? (
            <TouchableOpacity onPress={() => setIsEditing(true)}>
              <Text style={styles.editButton}>Edit</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleCancel}>
              <Text style={styles.cancelButton}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.userId}>ID: {user.id.slice(0, 8)}...</Text>
        </View>

        {/* Profile Info */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>NAME</Text>
          {isEditing ? (
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              maxLength={50}
            />
          ) : (
            <Text style={styles.cardValue}>{user.name}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>MEMBER SINCE</Text>
          <Text style={styles.cardValue}>
            {new Date(user.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </Text>
        </View>

        {/* Save Button */}
        {isEditing && (
          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Linked Mirrors Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Linked Mirrors</Text>
            <TouchableOpacity onPress={() => router.push('/mirrors')}>
              <Text style={styles.sectionAction}>Manage</Text>
            </TouchableOpacity>
          </View>

          {linkedMirrors.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="tv-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyText}>No mirrors linked yet</Text>
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => router.push('/')}
              >
                <Text style={styles.linkButtonText}>Find a Mirror</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.mirrorsList}>
              {linkedMirrors.map((mirror) => (
                <View key={mirror.mirrorId} style={styles.mirrorItem}>
                  <View style={styles.mirrorIcon}>
                    <Ionicons
                      name={mirror.faceEnrolled ? 'person-circle' : 'tv-outline'}
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                  <View style={styles.mirrorInfo}>
                    <Text style={styles.mirrorName}>{mirror.mirrorName}</Text>
                    <Text style={styles.mirrorDetails}>
                      {mirror.faceEnrolled ? 'Face enrolled' : 'Face not enrolled'}
                    </Text>
                  </View>
                  {mirror.faceEnrolled && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Privacy Info */}
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          <Text style={styles.infoText}>
            Your face data is stored locally on each mirror and never leaves the device.
            Your profile info syncs between your phone and linked mirrors.
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 60,
    alignItems: 'flex-end',
  },
  editButton: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  cancelButton: {
    ...typography.body,
    color: colors.textMuted,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.background,
  },
  userId: {
    ...typography.caption,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  cardValue: {
    ...typography.body,
    color: colors.text,
    fontSize: 17,
  },
  input: {
    ...typography.body,
    color: colors.text,
    fontSize: 17,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingBottom: spacing.xs,
  },
  saveButton: {
    height: 50,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  buttonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  saveButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  section: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionAction: {
    ...typography.body,
    color: colors.primary,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  linkButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
  },
  linkButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  mirrorsList: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  mirrorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mirrorIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
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
    fontWeight: '500',
  },
  mirrorDetails: {
    ...typography.caption,
    color: colors.textMuted,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
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
