/**
 * ScreenHeader
 *
 * Shared header for screens that draw their own chrome instead of using the
 * native stack header. Handles the status-bar inset, a 44pt back/close
 * target, a centred title and an optional right-hand slot, so every screen
 * gets the same spacing and an obvious way out.
 */

import type { ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Href } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';

export const HEADER_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

interface HeaderIconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  color?: string;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 44x44 icon button used in headers and toolbars. */
export function HeaderIconButton({
  icon,
  onPress,
  color = colors.text,
  accessibilityLabel,
  disabled,
  style,
}: HeaderIconButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      hitSlop={HEADER_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.iconButton, style]}
    >
      <Ionicons name={icon} size={24} color={color} />
    </TouchableOpacity>
  );
}

interface HeaderBackButtonProps {
  onPress: () => void;
  /** Text next to the chevron. Defaults to "Back". */
  label?: string;
  color?: string;
}

/**
 * The app's one back control: a chevron plus a label, at least 44pt tall.
 * Used by ScreenHeader and passed as `headerLeft` to native stack headers so
 * every screen's back button looks and behaves the same.
 */
export function HeaderBackButton({
  onPress,
  label = 'Back',
  color = colors.text,
}: HeaderBackButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={HEADER_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label === 'Back' ? 'Back' : `Back to ${label}`}
      style={styles.backButton}
    >
      <Ionicons name="chevron-back" size={24} color={color} style={styles.backChevron} />
      <Text style={[styles.backLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface HeaderTextButtonProps {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}

/** Text button (Edit, Save, Cancel…) with a full-height touch target. */
export function HeaderTextButton({
  label,
  onPress,
  color = colors.primary,
  disabled,
}: HeaderTextButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      hitSlop={HEADER_HIT_SLOP}
      accessibilityRole="button"
      style={styles.textButton}
    >
      <Text style={[styles.textButtonLabel, { color: disabled ? colors.textDisabled : color }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** 'back' shows a chevron + label, 'close' an X, 'none' hides the left control. */
  leftIcon?: 'back' | 'close' | 'none';
  /** Label next to the back chevron. Defaults to "Back". */
  backLabel?: string;
  /** Override the default pop-or-fallback behaviour. */
  onLeftPress?: () => void;
  /** Where to go when there is nothing on the stack to pop to. */
  fallbackHref?: Href;
  /** Rendered on the right, e.g. a Save button. Keep it ~44pt wide. */
  right?: ReactNode;
  /** Set false inside modals/sheets that already clear the status bar. */
  useTopInset?: boolean;
}

export function ScreenHeader({
  title,
  subtitle,
  leftIcon = 'back',
  backLabel = 'Back',
  onLeftPress,
  fallbackHref = '/',
  right,
  useTopInset = true,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const handleLeft = onLeftPress ?? (() => goBack(fallbackHref));

  return (
    <View style={[styles.header, { paddingTop: (useTopInset ? insets.top : 0) + spacing.xs }]}>
      <View style={styles.side}>
        {leftIcon === 'back' && <HeaderBackButton onPress={handleLeft} label={backLabel} />}
        {leftIcon === 'close' && (
          <HeaderIconButton icon="close" onPress={handleLeft} accessibilityLabel="Close" />
        )}
      </View>
      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  side: {
    minWidth: 76,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    ...typography.header,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  backButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: spacing.xs,
    paddingRight: spacing.sm,
  },
  backChevron: {
    marginLeft: -2,
  },
  backLabel: {
    fontSize: 15,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
});
