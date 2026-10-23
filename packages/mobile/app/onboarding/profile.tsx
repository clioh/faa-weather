/**
 * Profile Creation Screen
 * Part of the onboarding flow - creates user profile
 */

import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { KeyboardAvoidingScreen, HeaderBackButton } from '@/components';
import { goBack } from '@/lib/navigation';
import { Button, Field, Footer, Notice, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/lib/theme';

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
      <View style={{ paddingTop: insets.top + spacing.xs }}>
        <View style={styles.topBar}>
          <HeaderBackButton onPress={() => goBack('/onboarding')} />
        </View>
        <OnboardingProgress currentPhase="profile" />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Title */}
        <View style={styles.heading}>
          <Text style={styles.title}>Create your profile</Text>
          <Text style={styles.subtitle}>
            Your profile lets the mirror recognize you and show your personalized layout.
          </Text>
        </View>

        {/* Name Input */}
        <Field
          label="What should we call you?"
          placeholder="Enter your name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (error) setError(null);
          }}
          error={error}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleContinue}
          maxLength={50}
        />

        {/* Info Box: right under the field, so the keyboard never covers it */}
        <Notice
          tone="info"
          icon="shield-checkmark-outline"
          message="Your profile stays on your device. Face data is stored locally on each mirror for privacy."
        />
      </ScrollView>

      {/* Continue Button */}
      <Footer>
        <Button
          label="Continue"
          trailingIcon="arrow-forward"
          onPress={handleContinue}
          disabled={!name.trim()}
          loading={isCreating}
        />
      </Footer>
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
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: 28,
  },
  heading: {
    gap: 10,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
