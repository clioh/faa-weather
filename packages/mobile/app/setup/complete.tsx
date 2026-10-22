/**
 * Setup Complete Screen
 * Shown when all setup steps are finished
 */

import { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import { goToDashboard } from '@/lib/navigation';
import { Button, Footer, Row, RowGroup, SectionLabel, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/lib/theme';

const tick = <Ionicons name="checkmark" size={20} color={colors.success} />;

export default function SetupCompleteScreen() {
  const insets = useSafeAreaInsets();
  const [isOnboarding, setIsOnboarding] = useState(false);
  /** Only list the license when the mirror actually uses one (not with licensing off). */
  const [licenseActive, setLicenseActive] = useState(false);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Check if we're in the onboarding flow
    const checkOnboardingState = async () => {
      const state = await storage.getOnboardingState();
      if (state && state.phase !== 'complete') {
        setIsOnboarding(true);
      }
    };
    checkOnboardingState();
    api
      .getLicenseStatus()
      .then((license) => setLicenseActive(license.state === 'active'))
      .catch(() => setLicenseActive(false));
  }, []);

  const handleContinue = async () => {
    if (isOnboarding) {
      // Update onboarding state and go to template selection
      await storage.setOnboardingState({ phase: 'template' });
      router.replace('/onboarding/template');
    } else {
      // Normal flow - go to dashboard
      goToDashboard();
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 48 }]}>
        {/* Success icon */}
        <View style={styles.icon}>
          <Ionicons name="checkmark" size={32} color={colors.primary} />
        </View>

        {/* Success message */}
        <View style={styles.heading}>
          <Text style={styles.title}>You're All Set!</Text>
          <Text style={styles.subtitle}>
            Your SkyGlass is configured and ready to use
          </Text>
        </View>

        {/* Feature highlights */}
        <RowGroup>
          <Row leading={tick} title="Connected to WiFi" />
          {licenseActive && <Row leading={tick} title="License activated" />}
          <Row leading={tick} title="Home airport configured" />
          <Row leading={tick} title="Location set for sun times" />
          <Row leading={tick} title="Face registered" />
        </RowGroup>

        {/* Next steps */}
        <View>
          <SectionLabel>What's Next?</SectionLabel>
          <Text style={styles.nextStepsText}>
            Your mirror will now activate when it detects your face, displaying METAR/TAF data,
            your schedule, and astronomical information. Use this app anytime to manage settings
            or check for updates.
          </Text>
        </View>
      </ScrollView>

      {/* Done button */}
      <Footer>
        <Button
          label={isOnboarding ? 'Choose Layout' : 'Go to Dashboard'}
          trailingIcon="arrow-forward"
          onPress={handleContinue}
        />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: 28,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    gap: 10,
  },
  title: {
    ...typography.h1,
    fontSize: 36,
    fontWeight: '200',
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  nextStepsText: {
    ...typography.bodySmall,
    lineHeight: 21,
    color: colors.textSecondary,
  },
});
