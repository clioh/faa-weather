/**
 * Size preset chips for one tile. Sizes that would collide stay visible but
 * dimmed; tapping one explains why instead of silently doing nothing.
 */

import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SIZE_DIMENSIONS, SIZE_LABELS, type ModuleSize } from '@/lib/modules';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';

export interface SizeOption {
  size: ModuleSize;
  fits: boolean;
}

interface SizeChipsProps {
  options: SizeOption[];
  current: ModuleSize;
  onSelect: (size: ModuleSize) => void;
  onBlocked: (size: ModuleSize) => void;
  /** Wrap onto several lines (sheet) instead of scrolling (action bar). */
  wrap?: boolean;
}

export function SizeChips({ options, current, onSelect, onBlocked, wrap }: SizeChipsProps) {
  const chips = options.map(({ size, fits }) => {
    const active = size === current;
    const d = SIZE_DIMENSIONS[size];
    return (
      <TouchableOpacity
        key={size}
        onPress={() => (active ? undefined : fits ? onSelect(size) : onBlocked(size))}
        style={[styles.chip, active && styles.chipActive, !fits && !active && styles.chipBlocked]}
        accessibilityRole="button"
        accessibilityLabel={`${SIZE_LABELS[size]}, ${d.cols} by ${d.rows}`}
        accessibilityState={{ selected: active, disabled: !fits && !active }}
        accessibilityHint={!fits && !active ? 'Not enough room at this spot' : undefined}
      >
        <Text style={[styles.label, active && styles.labelActive, !fits && !active && styles.labelBlocked]}>
          {SIZE_LABELS[size]}
        </Text>
        <Text style={[styles.dims, active && styles.labelActive, !fits && !active && styles.labelBlocked]}>
          {d.cols}×{d.rows}
        </Text>
      </TouchableOpacity>
    );
  });

  if (wrap) {
    return <View style={styles.wrap}>{chips}</View>;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  chipBlocked: {
    opacity: 0.45,
    borderStyle: 'dashed',
  },
  label: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.primary,
  },
  labelBlocked: {
    color: colors.textMuted,
  },
  dims: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
