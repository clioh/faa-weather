/**
 * Header for page sheets (Library, Configure, pickers): close X or a spacer
 * on the left, centred 16/500 title, "Done" (or another text action) right.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, sizes, spacing } from '@/lib/theme';

interface PageSheetHeaderProps {
  title: string;
  /** Small icon before the title (e.g. the widget being configured). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Shows the close X on the left. */
  onClose?: () => void;
  closeLabel?: string;
  /** Text action on the right, e.g. "Done". */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  /** Custom right slot instead of `action`. */
  right?: ReactNode;
}

const HIT = { top: 4, bottom: 4, left: 4, right: 4 };

export function PageSheetHeader({ title, icon, onClose, closeLabel = 'Close', action, right }: PageSheetHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {onClose ? (
          <Pressable
            onPress={onClose}
            hitSlop={HIT}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.center}>
        {icon ? <Ionicons name={icon} size={16} color={colors.text} /> : null}
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={[styles.side, styles.right]}>
        {right ??
          (action ? (
            <Pressable
              onPress={action.onPress}
              disabled={action.disabled}
              hitSlop={HIT}
              style={styles.textButton}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!action.disabled }}
            >
              <Text style={[styles.actionText, action.disabled && styles.actionDisabled]}>{action.label}</Text>
            </Pressable>
          ) : null)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  side: {
    minWidth: 76,
    flexDirection: 'row',
    alignItems: 'center',
  },
  right: {
    justifyContent: 'flex-end',
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  iconButton: {
    width: sizes.touch,
    height: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    minHeight: sizes.touch,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.primary,
  },
  actionDisabled: {
    color: colors.textDisabled,
  },
});
