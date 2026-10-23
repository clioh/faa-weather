/**
 * Hairline row lists: the app's replacement for card-style setting rows.
 *
 * <SectionLabel>Mirror</SectionLabel>
 * <RowGroup>
 *   <Row icon="airplane-outline" title="Home airport" value="KJFK" valueMono onPress={…} />
 *   <Row title="Auto-download" caption="…" trailing={<Switch … />} />
 * </RowGroup>
 *
 * Each row draws its own top hairline; the group adds the bottom one.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import type { IconName } from './Button';
import { colors, fonts, sizes, spacing, typography } from '@/lib/theme';

export function RowGroup({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.group, style]}>{children}</View>;
}

export function SectionLabel({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.labelWrap, style]}>
      <Text style={styles.label} accessibilityRole="header">
        {children}
      </Text>
    </View>
  );
}

export interface RowProps {
  title: string;
  /** String, or Text-nestable content (e.g. a mono span). */
  caption?: ReactNode;
  /** Caption is data (address, version): set it in mono. */
  captionMono?: boolean;
  icon?: IconName;
  /** Custom leading content instead of an icon (e.g. a mono ICAO column). */
  leading?: ReactNode;
  /** Trailing value text; `valueMono` for data (codes, versions, addresses). */
  value?: string;
  valueMono?: boolean;
  badge?: ReactNode;
  /** Switch, icon button, tick… Rendered after the value and badge. */
  trailing?: ReactNode;
  /** Defaults to true when the row is pressable and has no `trailing`. */
  chevron?: boolean;
  /** 'accent' for action rows ("Add a person"), 'danger' for destructive ones. */
  tone?: 'default' | 'accent' | 'danger';
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

const TONE_COLOR = {
  default: colors.text,
  accent: colors.primary,
  danger: colors.danger,
};

export function Row({
  title,
  caption,
  captionMono,
  icon,
  leading,
  value,
  valueMono,
  badge,
  trailing,
  chevron,
  tone = 'default',
  selected,
  disabled,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
}: RowProps) {
  const tint = TONE_COLOR[tone];
  const showChevron = chevron ?? (!!onPress && !trailing && tone === 'default');

  const content = (
    <>
      {leading ??
        (icon ? (
          <Ionicons name={icon} size={22} color={tone === 'default' ? colors.text : tint} />
        ) : null)}
      <View style={styles.text}>
        <Text style={[styles.title, { color: tint }]}>{title}</Text>
        {caption ? (
          <Text style={[styles.caption, captionMono && styles.mono]}>{caption}</Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.value, valueMono && styles.mono]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {badge}
      {trailing}
      {showChevron ? <Ionicons name="chevron-forward" size={14} color={colors.chevron} /> : null}
    </>
  );

  const rowStyle = [styles.row, selected && styles.selected, disabled && styles.disabled, style];

  if (!onPress) {
    return (
      <View style={rowStyle} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${title}, ${value}` : title)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  labelWrap: {
    marginBottom: 6,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
  row: {
    minHeight: sizes.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  selected: {
    backgroundColor: colors.primarySelected,
    borderTopColor: 'transparent',
    borderRadius: 12,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  pressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  value: {
    fontSize: 13,
    color: colors.textSecondary,
    flexShrink: 1,
    maxWidth: '45%',
  },
  mono: {
    fontFamily: fonts.mono,
  },
});
