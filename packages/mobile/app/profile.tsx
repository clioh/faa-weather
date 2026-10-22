/**
 * Profile Screen
 *
 * Allows users to view and edit their profile, and see their linked mirrors.
 */

import { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { ScreenHeader, HeaderTextButton } from '@/components';
import {
  Button,
  Field,
  Footer,
  Notice,
  Row,
  RowGroup,
  SectionLabel,
  Spinner,
  Text,
  TextButton,
} from '@/components/ui';
import { colors, spacing, typography, fonts } from '@/lib/theme';
import { goHome } from '@/lib/navigation';

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
      <View style={styles.container}>
        <ScreenHeader title="Profile" fallbackHref="/" />
        <View style={[styles.container, styles.centered]}>
          <Spinner size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Profile"
        fallbackHref="/"
        right={
          isEditing ? (
            <HeaderTextButton label="Cancel" color={colors.textMuted} onPress={handleCancel} />
          ) : (
            <HeaderTextButton label="Edit" onPress={() => setIsEditing(true)} />
          )
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.displayName}>{user.name}</Text>
            <Text style={styles.userId}>ID: {user.id.slice(0, 8)}...</Text>
          </View>
        </View>

        {/* Profile Info */}
        {isEditing ? (
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            maxLength={50}
          />
        ) : null}
        <View style={styles.rows}>
          {!isEditing && (
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Name</Text>
              <Text style={styles.dataValue}>{user.name}</Text>
            </View>
          )}
          <View style={styles.dataRow}>
            <Text style={styles.dataLabel}>Member since</Text>
            <Text style={styles.dataValue}>
              {new Date(user.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
        </View>

        {/* Linked Mirrors Section */}
        <View>
          <View style={styles.sectionHeader}>
            <SectionLabel style={styles.labelInRow}>Linked Mirrors</SectionLabel>
            <TextButton label="Manage" onPress={() => router.push('/mirrors')} />
          </View>

          {linkedMirrors.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="tv-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyText}>No mirrors linked yet</Text>
              <TextButton label="Find a Mirror" onPress={goHome} />
            </View>
          ) : (
            <RowGroup>
              {linkedMirrors.map((mirror) => (
                <Row
                  key={mirror.mirrorId}
                  icon={mirror.faceEnrolled ? 'person-circle-outline' : 'tv-outline'}
                  title={mirror.mirrorName}
                  caption={mirror.faceEnrolled ? 'Face enrolled' : 'Face not enrolled'}
                  trailing={
                    mirror.faceEnrolled ? (
                      <Ionicons name="checkmark" size={18} color={colors.success} />
                    ) : undefined
                  }
                />
              ))}
            </RowGroup>
          )}
        </View>

        <View style={styles.spacer} />

        {/* Privacy Info */}
        <Notice
          tone="info"
          icon="shield-checkmark-outline"
          message="Your face data is stored locally on each mirror and never leaves the device. Your profile info syncs between your phone and linked mirrors."
        />
      </ScrollView>

      {/* Save Button */}
      {isEditing && (
        <Footer>
          <Button label="Save Changes" onPress={handleSave} loading={isSaving} />
        </Footer>
      )}
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
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 20,
    paddingBottom: spacing.lg,
    gap: 26,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.switchOffBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '300',
    color: colors.text,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  displayName: {
    fontSize: 22,
    fontWeight: '300',
    color: colors.text,
  },
  userId: {
    ...typography.caption,
    fontFamily: fonts.mono,
    color: colors.textMuted,
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
    fontSize: 15,
    color: colors.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelInRow: {
    marginBottom: 0,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
  spacer: {
    flex: 1,
  },
});
