/**
 * Onboarding Progress Component
 * Visual indicator showing progress through the onboarding flow
 */

import { StyleSheet, View } from 'react-native';
import { StepProgress } from '@/components/ui/StepProgress';
import { spacing } from '@/lib/theme';

export type OnboardingPhase = 'profile' | 'discover' | 'setup' | 'template' | 'complete';

const PHASES: { id: OnboardingPhase; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'discover', label: 'Mirror' },
  { id: 'setup', label: 'Setup' },
  { id: 'template', label: 'Template' },
  { id: 'complete', label: 'Ready' },
];

const LABELS = PHASES.map((p) => p.label);

interface OnboardingProgressProps {
  currentPhase: OnboardingPhase;
}

export function OnboardingProgress({ currentPhase }: OnboardingProgressProps) {
  const currentIndex = PHASES.findIndex((p) => p.id === currentPhase);

  return (
    <View style={styles.container}>
      <StepProgress labels={LABELS} current={currentIndex} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});
