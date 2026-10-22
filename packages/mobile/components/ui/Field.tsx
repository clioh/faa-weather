/**
 * Labelled text field: label (12, textSecondary) → 52pt input (radius 14,
 * borderStrong; accent when focused, danger on error) → hint or error line.
 * Optional leading icon, mono input text and a show/hide toggle for secure
 * fields.
 */

import { useState, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from './Text';
import type { IconName } from './Button';
import { borderRadius, colors, fonts, sizes, spacing } from '@/lib/theme';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Hint under the input; a string is styled as a caption. */
  help?: ReactNode;
  error?: string | null;
  icon?: IconName;
  mono?: boolean;
  /** Adds a show/hide toggle for secure fields. */
  revealable?: boolean;
  inputRef?: Ref<TextInput>;
  /** Extra style for the input text (e.g. a larger mono key). */
  inputTextStyle?: TextInputProps['style'];
  style?: StyleProp<ViewStyle>;
}

export function Field({
  label,
  help,
  error,
  icon,
  mono,
  revealable,
  secureTextEntry,
  inputRef,
  inputTextStyle,
  style,
  onFocus,
  onBlur,
  ...input
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hidden = !!secureTextEntry && !revealed;
  const name = label ?? input.placeholder ?? 'field';

  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.box, focused && styles.focused, error ? styles.error : null]}>
        {icon ? <Ionicons name={icon} size={18} color={colors.textMuted} /> : null}
        <TextInput
          ref={inputRef}
          {...input}
          secureTextEntry={hidden}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, mono && styles.mono, inputTextStyle]}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          accessibilityLabel={input.accessibilityLabel ?? label}
        />
        {revealable && secureTextEntry ? (
          <Pressable
            style={styles.reveal}
            onPress={() => setRevealed((r) => !r)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${name}` : `Show ${name}`}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {help ? typeof help === 'string' ? <Text style={styles.help}>{help}</Text> : help : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  box: {
    minHeight: sizes.input,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  focused: {
    borderColor: colors.borderFocus,
  },
  error: {
    borderColor: colors.error,
  },
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  reveal: {
    width: sizes.touch,
    height: sizes.touch,
    marginRight: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.error,
  },
  help: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
});
