/**
 * Pill buttons and the plain accent text button.
 *
 * Button variants (DESIGN_SYSTEM.md → Components):
 * - primary: accent fill, onPrimary 16/600 text. One per screen.
 * - secondary: transparent with a borderStrong outline, white 16/500.
 * - danger: transparent with a danger outline and danger text.
 * Disabled buttons of any variant get the white 10% fill and disabled text.
 * Sizes: 'large' (52, stretches to the container) and 'small' (40, hugs its
 * content). While loading, a spinner takes the icon's place.
 */

import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Spinner } from './Spinner';
import { colors, sizes, spacing, typography } from '@/lib/theme';

export type IconName = keyof typeof Ionicons.glyphMap;
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'large' | 'small';
  icon?: IconName;
  /** Icon after the label, e.g. an arrow on "Get started". */
  trailingIcon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Read out instead of the label. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

const TEXT_COLOR: Record<ButtonVariant, string> = {
  primary: colors.onPrimary,
  secondary: colors.text,
  danger: colors.danger,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  icon,
  trailingIcon,
  loading,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const off = !!disabled || !!loading;
  // A loading button keeps its variant's look; only a disabled one greys out.
  const greyed = !!disabled && !loading;
  const tint = greyed ? colors.textDisabled : TEXT_COLOR[variant];
  const small = size === 'small';

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.large,
        greyed ? styles.disabled : styles[variant],
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <Spinner onAccent={variant === 'primary'} color={variant === 'primary' ? undefined : tint} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={tint} />
      ) : null}
      <Text
        style={[
          small ? styles.labelSmall : styles.label,
          { color: tint },
          variant !== 'primary' && styles.labelOutline,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {trailingIcon && !loading ? <Ionicons name={trailingIcon} size={18} color={tint} /> : null}
    </Pressable>
  );
}

interface TextButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  color?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Accent text with a 44pt touch target: "Set up later", "Skip for now", links. */
export function TextButton({ label, onPress, icon, color = colors.primary, disabled, accessibilityLabel, style }: TextButtonProps) {
  const tint = disabled ? colors.textDisabled : color;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.textButton, pressed && styles.pressed, style]}
    >
      {icon ? <Ionicons name={icon} size={16} color={tint} /> : null}
      <Text style={[styles.textButtonLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  large: {
    alignSelf: 'stretch',
    height: sizes.button,
    borderRadius: sizes.button / 2,
    paddingHorizontal: 20,
  },
  small: {
    alignSelf: 'flex-start',
    height: sizes.buttonSmall,
    borderRadius: sizes.buttonSmall / 2,
    paddingHorizontal: spacing.md,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  danger: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  disabled: {
    backgroundColor: colors.disabledFill,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  labelSmall: {
    fontSize: 14,
    fontWeight: '600',
  },
  labelOutline: {
    fontWeight: '500',
  },
  textButton: {
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  textButtonLabel: {
    ...typography.body,
  },
});
