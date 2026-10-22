/**
 * Six-digit code entry for pairing. One real TextInput (so one-time-code
 * autofill, paste and the number pad all work) drawn as six boxes. Anything
 * that isn't a digit is dropped, so pasting "123 456" or "Code: 123456"
 * fills it; onComplete fires once all six digits are in.
 */

import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { colors, borderRadius, spacing } from '@/lib/theme';

export const CODE_LENGTH = 6;

interface CodeInputProps {
  value: string;
  onChange: (digits: string) => void;
  onComplete: (digits: string) => void;
  disabled?: boolean;
  error?: boolean;
}

export interface CodeInputHandle {
  focus: () => void;
}

export const CodeInput = forwardRef<CodeInputHandle, CodeInputProps>(function CodeInput(
  { value, onChange, onComplete, disabled, error },
  ref
) {
  const input = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    onChange(digits);
    if (digits.length === CODE_LENGTH && digits !== value) onComplete(digits);
  };

  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <Pressable
      onPress={() => input.current?.focus()}
      disabled={disabled}
      accessible={false}
      style={styles.wrap}
    >
      <View style={styles.boxes} pointerEvents="none">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const digit = value[i] ?? '';
          const focused = !disabled && i === activeIndex && value.length < CODE_LENGTH;
          return (
            <View
              key={i}
              style={[
                styles.box,
                digit ? styles.boxFilled : null,
                focused ? styles.boxFocused : null,
                error ? styles.boxError : null,
                disabled ? styles.boxDisabled : null,
              ]}
            >
              <Text style={styles.digit}>{digit}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={handleChange}
        editable={!disabled}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        importantForAutofill="yes"
        // Room for a pasted code with spaces or a label; digits are extracted.
        maxLength={32}
        caretHidden
        selectionColor="transparent"
        style={styles.hiddenInput}
        accessibilityLabel="6-digit pairing code"
        accessibilityHint="Enter the code shown on your mirror"
        accessibilityValue={{ text: value ? value.split('').join(' ') : 'empty' }}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  box: {
    flex: 1,
    maxWidth: 52,
    aspectRatio: 0.82,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.textMuted },
  boxFocused: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  boxError: { borderColor: colors.error },
  boxDisabled: { opacity: 0.5 },
  digit: { fontSize: 28, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  // Covers the boxes so taps, long-press paste and autofill land on the real input.
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    color: 'transparent',
    backgroundColor: 'transparent',
    fontSize: 1,
  },
});
