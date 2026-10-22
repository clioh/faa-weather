/**
 * Segmented progress: equal 3pt bars with a 4pt gap. Done = accent,
 * current = white, pending = white 18%. Optional 10pt labels under the bars.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors } from '@/lib/theme';

interface StepProgressProps {
  /** Number of bars when there are no labels. */
  steps?: number;
  labels?: string[];
  /** Index of the current step. Steps before it are done. */
  current: number;
  style?: StyleProp<ViewStyle>;
}

export function StepProgress({ steps, labels, current, style }: StepProgressProps) {
  const count = labels?.length ?? steps ?? 5;
  const label = labels?.[current];

  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={label ? `Step ${current + 1} of ${count}: ${label}` : `Step ${current + 1} of ${count}`}
      accessibilityValue={{ min: 0, max: count, now: current + 1 }}
    >
      {Array.from({ length: count }, (_, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'pending';
        return (
          <View key={i} style={styles.step}>
            <View style={[styles.bar, styles[state]]} />
            {labels ? (
              <Text style={[styles.label, state === 'current' && styles.labelCurrent]} numberOfLines={1}>
                {labels[i]}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  step: {
    flex: 1,
    gap: 6,
  },
  bar: {
    height: 3,
    borderRadius: 2,
  },
  done: {
    backgroundColor: colors.primary,
  },
  current: {
    backgroundColor: colors.text,
  },
  pending: {
    backgroundColor: colors.progressPending,
  },
  label: {
    fontSize: 10,
    color: colors.progressLabel,
  },
  labelCurrent: {
    color: colors.text,
  },
});
