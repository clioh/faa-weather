/**
 * Inline notice: info, warning or error. Tinted fill, tone border, light
 * tone-coloured text. Optional bold title, accent action link under the
 * text, and retry / dismiss icon buttons on the right.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import type { IconName } from './Button';
import { colors, tones, type Tone } from '@/lib/theme';

export interface NoticeProps {
  tone: Tone;
  /** Text, or Text-nestable content (e.g. a bold span). */
  message?: ReactNode;
  title?: string;
  /** Extra content under the message (not wrapped in Text). */
  children?: ReactNode;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
  onRetry?: () => void;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

const HIT = { top: 6, bottom: 6, left: 6, right: 6 };

export function Notice({
  tone,
  message,
  title,
  children,
  icon,
  action,
  onRetry,
  onDismiss,
  style,
}: NoticeProps) {
  const t = tones[tone];
  const textColor = { color: t.text };

  return (
    <View
      style={[styles.notice, { backgroundColor: t.fill, borderColor: t.border }, style]}
      accessibilityRole={tone === 'info' ? undefined : 'alert'}
    >
      {icon ? <Ionicons name={icon} size={16} color={t.icon} style={styles.icon} /> : null}
      <View style={styles.body}>
        {title ? <Text style={[styles.title, textColor]}>{title}</Text> : null}
        {message ? <Text style={[styles.text, textColor]}>{message}</Text> : null}
        {children}
        {action ? (
          <Pressable
            onPress={action.onPress}
            style={styles.action}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Text style={styles.actionText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={styles.iconButton}
          hitSlop={HIT}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Ionicons name="refresh" size={16} color={t.text} />
        </Pressable>
      ) : null}
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          style={styles.iconButton}
          hitSlop={HIT}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={16} color={t.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  icon: {
    marginTop: 2,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  text: {
    fontSize: 13,
    lineHeight: 19,
  },
  action: {
    minHeight: 28,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  actionText: {
    fontSize: 13,
    color: colors.primary,
  },
  iconButton: {
    width: 32,
    height: 32,
    marginVertical: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
