/**
 * Small transient status pill ("Saved to mirror", "No room…").
 *
 * The shared ErrorToast is built for errors with a dismiss button and a long
 * timeout; editor feedback should be glanceable and get out of the way, and
 * it needs to work inside the library sheet's own modal too.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Toast } from '@/components/ui/Toast';
import { spacing } from '@/lib/theme';

export type EditorToastKind = 'success' | 'info' | 'error';

export interface EditorToastState {
  id: number;
  message: string;
  kind: EditorToastKind;
}

export function useEditorToast(durationMs = 2400) {
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, kind: EditorToastKind = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), message, kind });
      timer.current = setTimeout(
        () => setToast(null),
        kind === 'error' ? durationMs * 1.6 : durationMs
      );
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
          <Toast message={toast.message} tone={toast.kind} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    maxWidth: 420,
  },
});
