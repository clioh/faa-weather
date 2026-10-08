/**
 * Setup Index
 * Shows setup progress and navigates to current step
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, SetupStatus } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

interface SetupStep {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  isComplete: (status: SetupStatus) => boolean;
}

const SETUP_STEPS: SetupStep[] = [
  {
    id: 'wifi',
    title: 'WiFi Network',
    description: 'Connect your mirror to your home network',
    icon: 'wifi-outline',
    route: '/setup/wifi',
    isComplete: (status) => status.wifi_configured,
  },
  {
    id: 'airport',
    title: 'Home Airport',
    description: 'Set your primary airport for weather data',
    icon: 'airplane-outline',
    route: '/setup/airport',
    isComplete: (status) => status.airport_configured,
  },
  {
    id: 'location',
    title: 'Location',
    description: 'Enable sunrise/sunset and local weather',
    icon: 'location-outline',
    route: '/setup/location',
    isComplete: (status) => status.location_configured,
  },
  {
    id: 'face',
    title: 'Face Registration',
    description: 'Register your face for presence detection',
    icon: 'person-circle-outline',
    route: '/setup/face',
    isComplete: (status) => status.face_registered,
  },
];

export default function SetupIndex() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const setupStatus = await api.getSetupStatus();
      setStatus(setupStatus);

      // If all steps complete, go to complete screen
      if (setupStatus.step === 'complete') {
        router.replace('/setup/complete');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load setup status');
    } finally {
      setLoading(false);
    }
  };

  const getStepStatus = (step: SetupStep): 'complete' | 'current' | 'pending' => {
    if (!status) return 'pending';
    if (step.isComplete(status)) return 'complete';

    // Find first incomplete step
    const firstIncomplete = SETUP_STEPS.find((s) => !s.isComplete(status));
    if (firstIncomplete?.id === step.id) return 'current';

    return 'pending';
  };

  const handleStepPress = (step: SetupStep) => {
    router.push(step.route as any);
  };

  const completedSteps = status
    ? SETUP_STEPS.filter((step) => step.isComplete(status)).length
    : 0;
  const progressPercent = (completedSteps / SETUP_STEPS.length) * 100;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading setup status...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="warning-outline" size={48} color={colors.warning} />
        <Text style={styles.errorTitle}>Connection Error</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadStatus}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
            {completedSteps} of {SETUP_STEPS.length} complete
          </Text>
        </View>
      </View>

      {/* Steps */}
      <View style={styles.stepsContainer}>
        {SETUP_STEPS.map((step, index) => {
          const stepStatus = getStepStatus(step);
          const isLast = index === SETUP_STEPS.length - 1;

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
                  <Text style={styles.stepDescription}>{step.description}</Text>
                </View>

                <Ionicons
                  name="chevron-forward"
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

      {/* Skip for now button */}
      <TouchableOpacity
        style={styles.skipButton}
        onPress={() => router.replace('/dashboard')}
      >
        <Text style={styles.skipButtonText}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingTop: 60,
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
