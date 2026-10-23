/**
 * Setup Index
 * Shows setup progress and navigates to current step
 */

import { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, SetupStatus, type MirrorOrientation } from '@/lib/api';
import { LICENSE_SETUP_ROUTE, ORIENTATION_SETUP_ROUTE } from '@/lib/setupSteps';
import { storage } from '@/lib/storage';
import { logError } from '@/lib/errors';
import { HeaderBackButton, MirrorNotFound } from '@/components';
import { goToDashboard } from '@/lib/navigation';
import { Badge, Button, Footer, Spinner, Text, TextButton } from '@/components/ui';
import { colors, fonts, spacing, typography } from '@/lib/theme';

interface SetupStep {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: Href;
  isComplete: (status: SetupStatus) => boolean;
}

const SETUP_STEPS: SetupStep[] = [
  {
    id: 'wifi',
    title: 'WiFi network',
    description: 'Connect your mirror to your home network',
    icon: 'wifi-outline',
    route: { pathname: '/setup/wifi', params: { flow: 'setup' } },
    isComplete: (status) => status.wifiConfigured,
  },
  {
    id: 'orientation',
    title: 'Orientation',
    description: 'How the mirror is mounted',
    icon: 'tablet-landscape-outline',
    route: ORIENTATION_SETUP_ROUTE,
    isComplete: (status) => status.orientationConfigured,
  },
  {
    id: 'license',
    title: 'License',
    description: 'Activate your SkyGlass license key',
    icon: 'key-outline',
    route: LICENSE_SETUP_ROUTE,
    isComplete: (status) => status.licenseActivated,
  },
  {
    id: 'location',
    title: 'Location',
    description: 'Enable sunrise/sunset and local weather',
    icon: 'location-outline',
    route: '/setup/location',
    isComplete: (status) => status.locationConfigured,
  },
  {
    id: 'airport',
    title: 'Home airport',
    description: 'Pick from airports near you, or search',
    icon: 'airplane-outline',
    route: '/setup/airport',
    isComplete: (status) => status.airportConfigured,
  },
  {
    id: 'face',
    title: 'Face registration',
    description: 'Register your face for presence detection',
    icon: 'person-circle-outline',
    route: '/setup/face',
    isComplete: (status) => status.faceEnrolled,
  },
];

export default function SetupIndex() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  /** Saved orientation, shown on its row once done ("· Portrait"). */
  const [orientation, setOrientation] = useState<MirrorOrientation | null>(null);
  /** Licensing switched off on the mirror (local development): no License row. */
  const [licensingOff, setLicensingOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The error was "no response at all" (not an HTTP error). */
  const [unreachable, setUnreachable] = useState(false);

  // Steps push their own screens and pop back here, so this screen stays
  // mounted. Re-read the status on every focus so completed steps get ticked.
  useFocusEffect(
    useCallback(() => {
      loadStatus();
    }, [])
  );

  const loadStatus = async () => {
    try {
      // Only blank the screen on the first load; on later focuses keep the
      // checklist visible while the status refreshes behind it.
      setLoading((current) => current && status === null);
      setError(null);
      const [setupStatus, license, orientationState] = await Promise.all([
        api.getSetupStatus(),
        // Only used to hide the License row; failing to read it just keeps the row.
        api.getLicenseStatus().catch(() => null),
        // Only for the Orientation row's caption.
        api.getOrientation().catch(() => null),
      ]);
      setStatus(setupStatus);
      setOrientation(orientationState?.orientation ?? null);
      setLicensingOff(license?.state === 'disabled' || license?.enabled === false);

      // During onboarding, finishing the last step moves on to the celebration
      // screen. Once onboarding is over (opened from the dashboard's Setup
      // Wizard), show the checklist with every step ticked instead.
      if (setupStatus.step === 'complete') {
        const state = await storage.getOnboardingState();
        if (state?.phase === 'setup') {
          router.replace('/setup/complete');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load setup status');
      setUnreachable(err instanceof ApiError && err.status === undefined);
    } finally {
      setLoading(false);
    }
  };

  const steps = licensingOff ? SETUP_STEPS.filter((s) => s.id !== 'license') : SETUP_STEPS;

  /**
   * Steps after License wait for it: the mirror won't finish setup without a
   * license, so the checklist doesn't let Location/Airport/Face jump ahead.
   * (licenseActivated is always true when licensing is off.)
   */
  const isLocked = (step: SetupStep): boolean => {
    if (!status || status.licenseActivated || step.isComplete(status)) return false;
    const licenseIndex = SETUP_STEPS.findIndex((s) => s.id === 'license');
    return SETUP_STEPS.indexOf(step) > licenseIndex;
  };

  const getStepStatus = (step: SetupStep): 'complete' | 'current' | 'pending' => {
    if (!status) return 'pending';
    if (step.isComplete(status)) return 'complete';

    // Find first incomplete step
    const firstIncomplete = steps.find((s) => !s.isComplete(status));
    if (firstIncomplete?.id === step.id) return 'current';

    return 'pending';
  };

  const describe = (step: SetupStep, stepStatus: 'complete' | 'current' | 'pending'): string => {
    if (step.id === 'orientation' && stepStatus === 'complete' && orientation) {
      return `${step.description} · ${orientation === 'landscape' ? 'Landscape' : 'Portrait'}`;
    }
    return step.description;
  };

  const handleStepPress = (step: SetupStep) => {
    router.push(isLocked(step) ? LICENSE_SETUP_ROUTE : step.route);
  };

  // Leaving setup early still ends onboarding; otherwise app/index.tsx sees
  // phase 'setup' on the next launch and sends the user straight back here.
  const leaveSetup = async () => {
    try {
      await storage.setOnboardingState({ phase: 'complete' });
    } catch (err) {
      logError('SetupIndex.leaveSetup', err);
    }
    goToDashboard();
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else leaveSetup();
  };

  const backButton = (
    <View style={styles.topRow}>
      <HeaderBackButton onPress={handleBack} />
    </View>
  );

  const completedSteps = status ? steps.filter((step) => step.isComplete(status)).length : 0;
  const progressPercent = (completedSteps / steps.length) * 100;
  const allComplete = completedSteps === steps.length;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <View style={[styles.errorBackButton, { top: insets.top + spacing.xs }]}>{backButton}</View>
        <Spinner size="large" />
        <Text style={styles.loadingText}>Loading setup status...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="warning-outline" size={40} color={colors.warning} />
        <View style={[styles.errorBackButton, { top: insets.top + spacing.xs }]}>{backButton}</View>
        <Text style={styles.errorTitle}>Connection error</Text>
        <Text style={styles.errorText}>{error}</Text>
        {unreachable ? (
          <MirrorNotFound visible onFound={loadStatus} />
        ) : (
          <Button label="Retry" size="small" onPress={loadStatus} style={styles.retryButton} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xs }]}>
      {backButton}

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Setup your mirror</Text>
          <Text style={styles.subtitle}>Complete these steps to get your SkyGlass ready</Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {completedSteps} of {steps.length} complete
          </Text>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          {steps.map((step, index) => {
            const stepStatus = getStepStatus(step);
            const locked = isLocked(step);
            const current = stepStatus === 'current';
            const number = String(index + 1).padStart(2, '0');

            return (
              <Pressable
                key={step.id}
                style={({ pressed }) => [
                  styles.step,
                  current && styles.stepCurrent,
                  pressed && styles.pressed,
                ]}
                onPress={() => handleStepPress(step)}
                accessibilityRole="button"
                accessibilityLabel={`${step.title}, ${
                  stepStatus === 'complete'
                    ? 'done'
                    : locked
                      ? 'locked'
                      : current
                        ? 'next'
                        : 'not started'
                }`}
              >
                <View
                  style={[
                    styles.stepNumber,
                    stepStatus === 'complete' && styles.stepNumberComplete,
                    current && styles.stepNumberCurrent,
                  ]}
                >
                  {stepStatus === 'complete' ? (
                    <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
                  ) : (
                    <Text style={[styles.stepNumberText, current && styles.stepNumberTextCurrent]}>
                      {number}
                    </Text>
                  )}
                </View>

                <View style={styles.stepContent}>
                  <Text
                    style={[styles.stepTitle, stepStatus === 'pending' && styles.stepTitlePending]}
                  >
                    {step.title}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {locked ? 'Activate your license first' : describe(step, stepStatus)}
                  </Text>
                </View>

                {current && !locked ? (
                  <Badge label="NEXT" />
                ) : (
                  <Ionicons
                    name={locked ? 'lock-closed-outline' : 'chevron-forward'}
                    size={14}
                    color={colors.chevron}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Skip for now / Done button */}
      <Footer>
        <TextButton label={allComplete ? 'Done' : 'Skip for now'} onPress={leaveSetup} />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  errorBackButton: {
    position: 'absolute',
    left: 0,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorTitle: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryButton: {
    alignSelf: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  header: {
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
  progressContainer: {
    gap: spacing.sm,
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.progressPending,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  progressText: {
    ...typography.caption,
    fontFamily: fonts.mono,
    color: colors.textMuted,
  },
  steps: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  step: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  stepCurrent: {
    backgroundColor: colors.primarySelected,
    borderTopColor: 'transparent',
    borderRadius: 12,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  pressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberComplete: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepNumberCurrent: {
    borderColor: colors.text,
  },
  stepNumberText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.progressLabel,
  },
  stepNumberTextCurrent: {
    color: colors.text,
  },
  stepContent: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 15,
    color: colors.text,
  },
  stepTitlePending: {
    color: colors.textSecondary,
  },
  stepDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
