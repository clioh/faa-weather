/**
 * Small building blocks for the calendar screens: a bottom sheet in the same
 * style as the app's confirm sheets, buttons with a loading state, a labelled
 * text field and an inline notice. Kept here rather than in components/ so
 * the shared config controls stay unchanged.
 */

import { useState, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { fieldStyles, TOUCH } from '@/components/config/fieldStyles';

type IconName = keyof typeof Ionicons.glyphMap;

// ------------------------------------------------------------------ Sheet

interface SheetProps {
  visible: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet over a dimmed backdrop; tapping the backdrop closes it. */
export function Sheet({ visible, title, body, onClose, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {title}
            </Text>
            {body ? <Text style={styles.sheetBody}>{body}</Text> : null}
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ------------------------------------------------------------------ Buttons

interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** Read out instead of the label, e.g. with the account name added. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function PrimaryButton({ label, onPress, loading, disabled, icon, accessibilityLabel, style }: ButtonProps) {
  const off = disabled || loading;
  return (
    <TouchableOpacity
      style={[styles.button, styles.primary, disabled && !loading && styles.primaryDisabled, style]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.background} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={disabled ? colors.textDisabled : colors.background} /> : null}
          <Text style={[styles.primaryText, disabled && styles.primaryTextDisabled]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  label,
  onPress,
  loading,
  disabled,
  icon,
  accessibilityLabel,
  style,
  tone = 'default',
}: ButtonProps & { tone?: 'default' | 'danger' }) {
  const off = disabled || loading;
  const tint = tone === 'danger' ? colors.error : colors.text;
  return (
    <TouchableOpacity
      style={[styles.button, tone === 'danger' ? styles.danger : styles.secondary, off && styles.dimmed, style]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={tint} /> : null}
          <Text style={[styles.secondaryText, { color: tint }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ------------------------------------------------------------------ Field

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  help?: ReactNode;
  error?: string | null;
  /** Adds a show/hide toggle for secure fields. */
  revealable?: boolean;
  inputRef?: Ref<TextInput>;
}

export function Field({ label, help, error, revealable, secureTextEntry, inputRef, ...input }: FieldProps) {
  const [revealed, setRevealed] = useState(false);
  const hidden = !!secureTextEntry && !revealed;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View>
        <TextInput
          ref={inputRef}
          {...input}
          secureTextEntry={hidden}
          style={[fieldStyles.input, revealable && styles.inputWithToggle, error ? fieldStyles.inputError : null]}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={input.accessibilityLabel ?? label}
        />
        {revealable && secureTextEntry ? (
          <TouchableOpacity
            style={styles.reveal}
            onPress={() => setRevealed((r) => !r)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={fieldStyles.errorText}>{error}</Text> : null}
      {help ? typeof help === 'string' ? <Text style={styles.fieldHelp}>{help}</Text> : help : null}
    </View>
  );
}

// ------------------------------------------------------------------ Notice

interface NoticeProps {
  tone: 'error' | 'warning' | 'info';
  message: string;
  action?: { label: string; onPress: () => void };
}

const NOTICE_TONES = {
  error: { color: colors.error, bg: 'rgba(255, 68, 68, 0.1)', icon: 'alert-circle' as IconName },
  warning: { color: colors.warning, bg: 'rgba(255, 170, 0, 0.1)', icon: 'warning' as IconName },
  info: { color: colors.info, bg: 'rgba(0, 136, 255, 0.1)', icon: 'information-circle' as IconName },
};

export function Notice({ tone, message, action }: NoticeProps) {
  const t = NOTICE_TONES[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]} accessibilityRole={tone === 'info' ? undefined : 'alert'}>
      <Ionicons name={t.icon} size={18} color={t.color} />
      <Text style={[styles.noticeText, { color: tone === 'info' ? colors.textSecondary : t.color }]}>{message}</Text>
      {action ? (
        <TouchableOpacity
          onPress={action.onPress}
          style={styles.noticeAction}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.noticeActionText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  sheetTitle: { ...typography.h3, color: colors.text },
  sheetBody: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.sm },
  button: {
    minHeight: 48,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.primary },
  primaryDisabled: { backgroundColor: colors.surfaceHighlight },
  primaryText: { ...typography.body, fontWeight: '600', color: colors.background },
  primaryTextDisabled: { color: colors.textDisabled },
  secondary: { borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: 'rgba(255, 68, 68, 0.15)' },
  dimmed: { opacity: 0.6 },
  secondaryText: { ...typography.body, fontWeight: '600' },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '500' },
  fieldHelp: { ...typography.caption, color: colors.textMuted },
  inputWithToggle: { paddingRight: TOUCH },
  reveal: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  noticeText: { ...typography.bodySmall, flex: 1 },
  noticeAction: { minHeight: 24, justifyContent: 'center', marginVertical: -spacing.xs, paddingVertical: spacing.xs },
  noticeActionText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
});
