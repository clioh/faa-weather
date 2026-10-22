/**
 * Setup Complete Screen
 * Shown when all setup steps are finished
 */

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import { goToDashboard } from '@/lib/navigation';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

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
      <LinearGradient
        colors={['rgba(0, 255, 136, 0.15)', 'transparent']}
        style={styles.gradient}
      />

      <View style={styles.content}>
        {/* Success icon */}
        <View style={styles.iconContainer}>
          <View style={styles.iconOuter}>
            <View style={styles.iconInner}>
              <Ionicons name="checkmark" size={64} color={colors.primary} />
            </View>
          </View>
        </View>

        {/* Success message */}
        <Text style={styles.title}>You're All Set!</Text>
        <Text style={styles.subtitle}>
          Your SkyGlass is configured and ready to use
        </Text>

        {/* Feature highlights */}
        <View style={styles.features}>
          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name="wifi" size={20} color={colors.primary} />
            </View>
            <Text style={styles.featureText}>Connected to WiFi</Text>
          </View>

          {licenseActive && (
            <View style={styles.feature}>
              <View style={styles.featureIcon}>
                <Ionicons name="key" size={20} color={colors.primary} />
              </View>
              <Text style={styles.featureText}>License activated</Text>
            </View>
          )}

          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name="airplane" size={20} color={colors.primary} />
            </View>
            <Text style={styles.featureText}>Home airport configured</Text>
          </View>

          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name="location" size={20} color={colors.primary} />
            </View>
            <Text style={styles.featureText}>Location set for sun times</Text>
          </View>

          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name="person" size={20} color={colors.primary} />
            </View>
            <Text style={styles.featureText}>Face registered</Text>
          </View>
        </View>

        {/* Next steps */}
        <View style={styles.nextSteps}>
          <Text style={styles.nextStepsTitle}>What's Next?</Text>
          <Text style={styles.nextStepsText}>
            Your mirror will now activate when it detects your face, displaying METAR/TAF data,
            your schedule, and astronomical information. Use this app anytime to manage settings
            or check for updates.
          </Text>
        </View>
      </View>

      {/* Done button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={handleContinue}
        >
          <Text style={styles.doneButtonText}>
            {isOnboarding ? 'Choose Layout' : 'Go to Dashboard'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.background} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  gradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 400,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  iconContainer: {
    marginBottom: spacing.xl,
  },
  iconOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.primary,
  },
  title: {
    ...typography.hero,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  features: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    ...typography.body,
    color: colors.text,
  },
  nextSteps: {
    alignSelf: 'stretch',
    padding: spacing.lg,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.lg,
  },
  nextStepsTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  nextStepsText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  footer: {
    padding: spacing.lg,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  doneButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
