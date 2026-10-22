/**
 * Profile Creation Screen
 * Part of the onboarding flow - creates user profile
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { KeyboardAvoidingScreen, HeaderBackButton } from '@/components';
import { goBack } from '@/lib/navigation';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { createProfile } = useUser();
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError('Please enter your name');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (trimmedName.length < 2) {
      setError('Name must be at least 2 characters');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      await createProfile(trimmedName);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate to mirror discovery
      router.push('/onboarding/discover');
    } catch (err) {
      console.error('Failed to create profile:', err);
      setError('Failed to create profile. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      {/* Back + Progress Indicator */}
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <View style={styles.topBar}>
          <HeaderBackButton onPress={() => goBack('/onboarding')} />
        </View>
        <OnboardingProgress currentPhase="profile" />
      </View>

      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <View style={styles.iconCircle}>
            <Ionicons name="person-add" size={40} color={colors.primary} />
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>Create Your Profile</Text>
        <Text style={styles.subtitle}>
          Your profile lets the mirror recognize you and show your personalized layout.
        </Text>

        {/* Name Input */}
        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>What should we call you?</Text>
          <TextInput
            style={[styles.input, error && styles.inputError]}
            placeholder="Enter your name"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (error) setError(null);
            }}
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleContinue}
            maxLength={50}
          />
          {error && (
            <View style={styles.errorContainer}>
              <Ionicons name="warning-outline" size={14} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          <Text style={styles.infoText}>
            Your profile stays on your device. Face data is stored locally on each mirror for privacy.
          </Text>
        </View>
      </View>

      {/* Continue Button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            (!name.trim() || isCreating) && styles.buttonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!name.trim() || isCreating}
          activeOpacity={0.8}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <>
              <Text style={styles.continueButtonText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color={colors.background} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  inputSection: {
    marginBottom: spacing.xl,
  },
  inputLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  input: {
    height: 56,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
    fontSize: 18,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
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
  footer: {
    padding: spacing.xl,
  },
  continueButton: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  continueButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
    fontSize: 17,
  },
});
