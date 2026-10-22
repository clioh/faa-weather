/**
 * Floating status pill: surfaceHighlight fill, 1px white 12% border, radius
 * 16, 14pt text, icon in the tone colour (success uses the accent).
 *
 * This is the look only. Positioning, animation and timing stay with the
 * callers (ErrorToast, EditorToast), which have different needs.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import type { IconName } from './Button';
import { colors } from '@/lib/theme';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

const ICONS: Record<ToastTone, { name: IconName; color: string }> = {
  success: { name: 'checkmark', color: colors.success },
  info: { name: 'information-circle-outline', color: colors.info },
  warning: { name: 'warning-outline', color: colors.warning },
  error: { name: 'alert-circle-outline', color: colors.error },
};

interface ToastProps {
  message: string;
  tone?: ToastTone;
  numberOfLines?: number;
  /** Icon buttons on the right (retry, dismiss). */
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Toast({ message, tone = 'info', numberOfLines = 2, actions, style }: ToastProps) {
  const icon = ICONS[tone];
  return (
    <View style={[styles.toast, actions ? styles.withActions : null, style]}>
      <Ionicons name={icon.name} size={18} color={icon.color} />
      <Text style={styles.text} numberOfLines={numberOfLines}>
        {message}
      </Text>
      {actions}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.sheetBorder,
    shadowColor: colors.background,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  withActions: {
    paddingRight: 4,
  },
  text: {
    flexShrink: 1,
    flexGrow: 1,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
});
