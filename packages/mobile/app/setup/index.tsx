/**
 * Setup Index
 * Shows setup progress and navigates to current step
 */

import { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, SetupStatus } from '@/lib/api';
import { LICENSE_SETUP_ROUTE } from '@/lib/setupSteps';
import { storage } from '@/lib/storage';
import { logError } from '@/lib/errors';
import { HeaderBackButton, MirrorNotFound } from '@/components';
import { goToDashboard } from '@/lib/navigation';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

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
    title: 'WiFi Network',
    description: 'Connect your mirror to your home network',
    icon: 'wifi-outline',
    route: { pathname: '/setup/wifi', params: { flow: 'setup' } },
    isComplete: (status) => status.wifiConfigured,
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
    title: 'Home Airport',
    description: 'Pick from airports near you, or search',
    icon: 'airplane-outline',
    route: '/setup/airport',
    isComplete: (status) => status.airportConfigured,
  },
  {
    id: 'face',
    title: 'Face Registration',
    description: 'Register your face for presence detection',
    icon: 'person-circle-outline',
    route: '/setup/face',
    isComplete: (status) => status.faceEnrolled,
  },
];

export default function SetupIndex() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<SetupStatus | null>(null);
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
      const [setupStatus, license] = await Promise.all([
        api.getSetupStatus(),
        // Only used to hide the License row; failing to read it just keeps the row.
        api.getLicenseStatus().catch(() => null),
      ]);
      setStatus(setupStatus);
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

  const completedSteps = status
    ? steps.filter((step) => step.isComplete(status)).length
    : 0;
  const progressPercent = (completedSteps / steps.length) * 100;
  const allComplete = completedSteps === steps.length;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <View style={[styles.errorBackButton, { top: insets.top + spacing.sm }]}>
          {backButton}
        </View>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading setup status...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="warning-outline" size={48} color={colors.warning} />
        <View style={[styles.errorBackButton, { top: insets.top + spacing.sm }]}>
          {backButton}
        </View>
        <Text style={styles.errorTitle}>Connection Error</Text>
        <Text style={styles.errorText}>{error}</Text>
        {unreachable ? (
          <MirrorNotFound visible onFound={loadStatus} />
        ) : (
          <TouchableOpacity style={styles.retryButton} onPress={loadStatus}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      {backButton}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Setup Your Mirror</Text>
        <Text style={styles.subtitle}>
          Complete these steps to get your SkyGlass ready
        </Text>

        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${progressPercent}%` }]}
            />
          </View>
          <Text style={styles.progressText}>
            {completedSteps} of {steps.length} complete
          </Text>
        </View>
      </View>

      {/* Steps */}
      <View style={styles.stepsContainer}>
        {steps.map((step, index) => {
          const stepStatus = getStepStatus(step);
          const locked = isLocked(step);
          const isLast = index === steps.length - 1;

          return (
            <View key={step.id}>
              <TouchableOpacity
                style={[
                  styles.stepCard,
                  stepStatus === 'current' && styles.stepCardCurrent,
                  stepStatus === 'complete' && styles.stepCardComplete,
                ]}
                onPress={() => handleStepPress(step)}
              >
                <View
                  style={[
                    styles.stepIcon,
                    stepStatus === 'complete' && styles.stepIconComplete,
                    stepStatus === 'current' && styles.stepIconCurrent,
                  ]}
                >
                  {stepStatus === 'complete' ? (
                    <Ionicons name="checkmark" size={24} color={colors.background} />
                  ) : (
                    <Ionicons
                      name={step.icon}
                      size={24}
                      color={
                        stepStatus === 'current' ? colors.primary : colors.textMuted
                      }
                    />
                  )}
                </View>

                <View style={styles.stepContent}>
                  <Text
                    style={[
                      styles.stepTitle,
                      stepStatus === 'pending' && styles.stepTitlePending,
                    ]}
                  >
                    {step.title}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {locked ? 'Activate your license first' : step.description}
                  </Text>
                </View>

                <Ionicons
                  name={locked ? 'lock-closed-outline' : 'chevron-forward'}
                  size={20}
                  color={stepStatus === 'pending' ? colors.textDisabled : colors.textMuted}
                />
              </TouchableOpacity>

              {/* Connector line */}
              {!isLast && (
                <View style={styles.connector}>
                  <View
                    style={[
                      styles.connectorLine,
                      stepStatus === 'complete' && styles.connectorLineComplete,
                    ]}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Skip for now / Done button */}
      <TouchableOpacity
        style={styles.skipButton}
        onPress={leaveSetup}
      >
        <Text style={styles.skipButtonText}>
          {allComplete ? 'Done' : 'Skip for now'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    marginLeft: -spacing.sm,
    marginBottom: spacing.sm,
  },
  errorBackButton: {
    position: 'absolute',
    left: spacing.lg,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorTitle: {
    ...typography.h2,
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
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
  },
  retryButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  progressContainer: {
    marginTop: spacing.sm,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
  progressText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  stepsContainer: {
    flex: 1,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepCardCurrent: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  stepCardComplete: {
    borderColor: colors.primary,
  },
  stepIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stepIconComplete: {
    backgroundColor: colors.primary,
  },
  stepIconCurrent: {
    backgroundColor: colors.primaryMuted,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  stepTitlePending: {
    color: colors.textMuted,
  },
  stepDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  connector: {
    paddingLeft: 40,
    height: 20,
  },
  connectorLine: {
    width: 2,
    height: '100%',
    backgroundColor: colors.border,
    marginLeft: 23,
  },
  connectorLineComplete: {
    backgroundColor: colors.primary,
  },
  skipButton: {
    alignItems: 'center',
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  skipButtonText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
