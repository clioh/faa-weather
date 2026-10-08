/**
 * Onboarding Progress Component
 * Visual indicator showing progress through the onboarding flow
 */

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/lib/theme';

export type OnboardingPhase = 'profile' | 'discover' | 'setup' | 'template' | 'complete';

const PHASES: { id: OnboardingPhase; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'discover', label: 'Mirror' },
  { id: 'setup', label: 'Setup' },
  { id: 'template', label: 'Template' },
  { id: 'complete', label: 'Ready' },
];

interface OnboardingProgressProps {
  currentPhase: OnboardingPhase;
}

export function OnboardingProgress({ currentPhase }: OnboardingProgressProps) {
  const currentIndex = PHASES.findIndex((p) => p.id === currentPhase);

  return (
    <View style={styles.container}>
      <View style={styles.stepsRow}>
        {PHASES.map((phase, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;
          const isLast = index === PHASES.length - 1;

          return (
            <View key={phase.id} style={styles.stepWrapper}>
              <View style={styles.stepContainer}>
                {/* Dot/Checkmark */}
                <View
                  style={[
                    styles.dot,
                    isComplete && styles.dotComplete,
                    isCurrent && styles.dotCurrent,
                    isPending && styles.dotPending,
                  ]}
                >
                  {isComplete && (
                    <Ionicons name="checkmark" size={12} color={colors.background} />
                  )}
                </View>

                {/* Label */}
                <Text
                  style={[
                    styles.label,
                    isComplete && styles.labelComplete,
                    isCurrent && styles.labelCurrent,
                    isPending && styles.labelPending,
                  ]}
                >
                  {phase.label}
                </Text>
              </View>

              {/* Connector line */}
              {!isLast && (
                <View style={styles.connectorContainer}>
                  <View
                    style={[
                      styles.connector,
                      isComplete && styles.connectorComplete,
                    ]}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  stepWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepContainer: {
    alignItems: 'center',
    width: 56,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  dotComplete: {
    backgroundColor: colors.primary,
  },
  dotCurrent: {
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.primaryMuted,
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  dotPending: {
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 2,
    borderColor: colors.border,
  },
  label: {
    ...typography.caption,
    textAlign: 'center',
  },
  labelComplete: {
    color: colors.primary,
  },
  labelCurrent: {
    color: colors.text,
    fontWeight: '600',
  },
  labelPending: {
    color: colors.textMuted,
  },
  connectorContainer: {
    paddingTop: 9,
    width: 20,
  },
  connector: {
    height: 2,
    backgroundColor: colors.border,
  },
  connectorComplete: {
    backgroundColor: colors.primary,
  },
});
