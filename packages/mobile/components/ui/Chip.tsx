/**
 * 34pt filter/size chip. Selected = white fill with black text; disabled
 * chips drop to 40% opacity but stay pressable when `onPress` should explain
 * why (pass `blocked` instead of `disabled` for that).
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors, sizes } from '@/lib/theme';

interface ChipProps {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  /** Not pressable, 40% opacity. */
  disabled?: boolean;
  /** Pressable but drawn at 40% opacity (e.g. a size that doesn't fit). */
  blocked?: boolean;
  /** Extra content after the label, e.g. a dimension in mono. */
  trailing?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function Chip({
  label,
  onPress,
  selected,
  disabled,
  blocked,
  trailing,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!selected, disabled: !!disabled || !!blocked }}
      hitSlop={{ top: 5, bottom: 5 }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        (disabled || blocked) && styles.dimmed,
        pressed && !selected && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: sizes.chip,
    paddingHorizontal: 14,
    borderRadius: sizes.chip / 2,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  dimmed: {
    opacity: 0.4,
  },
  pressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  text: {
    fontSize: 13,
    color: colors.chipText,
  },
  selectedText: {
    color: colors.background,
    fontWeight: '500',
  },
});
