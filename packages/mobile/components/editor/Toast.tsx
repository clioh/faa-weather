/**
 * Small transient status pill ("Saved to mirror", "No room…").
 *
 * The shared ErrorToast is built for errors with a dismiss button and a long
 * timeout; editor feedback should be glanceable and get out of the way, and
 * it needs to work inside the library sheet's own modal too.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';

export type EditorToastKind = 'success' | 'info' | 'error';

export interface EditorToastState {
  id: number;
  message: string;
  kind: EditorToastKind;
}

const ICONS: Record<EditorToastKind, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  success: { name: 'checkmark-circle', color: colors.success },
  info: { name: 'information-circle', color: colors.info },
  error: { name: 'alert-circle', color: colors.error },
};

export function useEditorToast(durationMs = 2400) {
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, kind: EditorToastKind = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), message, kind });
      timer.current = setTimeout(() => setToast(null), kind === 'error' ? durationMs * 1.6 : durationMs);
    },
    [durationMs]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { toast, show };
}

interface EditorToastProps {
  toast: EditorToastState | null;
  /** Distance from the bottom of the parent. */
  bottom: number;
}

export function EditorToast({ toast, bottom }: EditorToastProps) {
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom }]}>
      {toast && (
        <Animated.View
          key={toast.id}
          entering={FadeInDown.duration(180)}
          exiting={FadeOutDown.duration(160)}
          style={styles.toast}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          <Ionicons name={ICONS[toast.kind].name} size={18} color={ICONS[toast.kind].color} />
          <Text style={styles.text} numberOfLines={2}>
            {toast.message}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    maxWidth: 420,
  },
  text: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '500',
    flexShrink: 1,
  },
});
