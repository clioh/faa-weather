/**
 * Size preset chips for one tile. Sizes that would collide stay visible but
 * dimmed; tapping one explains why instead of silently doing nothing.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Text } from '@/components/ui';
import { SIZE_DIMENSIONS, SIZE_LABELS, type ModuleSize } from '@/lib/modules';
import { colors, fonts, spacing } from '@/lib/theme';

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
    const blocked = !fits && !active;
    return (
      <Chip
        key={size}
        label={SIZE_LABELS[size]}
        selected={active}
        blocked={blocked}
        onPress={() => (active ? undefined : fits ? onSelect(size) : onBlocked(size))}
        trailing={
          <Text style={[styles.dims, active && styles.dimsActive]}>
            {d.cols}×{d.rows}
          </Text>
        }
        accessibilityLabel={`${SIZE_LABELS[size]}, ${d.cols} by ${d.rows}`}
        accessibilityHint={blocked ? 'Not enough room at this spot' : undefined}
      />
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
    paddingHorizontal: spacing.lg,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dims: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.chipText,
    opacity: 0.7,
  },
  dimsActive: {
    color: colors.background,
    opacity: 1,
  },
});
