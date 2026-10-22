/**
 * Bottom sheet over a 66% black scrim: surfaceElevated, top radius 22, 36×5
 * grabber, 24 padding (34 + safe area at the bottom). Tapping the scrim
 * closes it. Used for confirms (discard, remove, unpair) and short forms.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  body?: string;
  children?: ReactNode;
  /** Read out for the scrim. Defaults to "Close". */
  closeLabel?: string;
  /**
   * Called once the sheet has fully gone. Navigate from here, not from the
   * button handler: on iOS, popping the screen while its modal is still
   * dismissing can leave the modal stuck or swallow the navigation.
   */
  onDismissed?: () => void;
}

export function BottomSheet({ visible, onClose, title, body, children, closeLabel = 'Close', onDismissed }: BottomSheetProps) {
  const insets = useSafeAreaInsets();

  // Modal's onDismiss is iOS-only; elsewhere the modal is gone as soon as
  // `visible` flips back to false.
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (Platform.OS !== 'ios' && wasVisible.current && !visible) onDismissed?.();
    wasVisible.current = visible;
  }, [visible, onDismissed]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={Platform.OS === 'ios' ? onDismissed : undefined}
    >
      {/* Padding on Android too: edge-to-edge windows don't resize for the keyboard. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={closeLabel}>
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]} onPress={() => {}}>
            <View style={styles.grabber} />
            {title || body ? (
              <View style={styles.heading}>
                {title ? (
                  <Text style={styles.title} accessibilityRole="header">
                    {title}
                  </Text>
                ) : null}
                {body ? <Text style={styles.body}>{body}</Text> : null}
              </View>
            ) : null}
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderTopWidth: 1,
    borderColor: colors.sheetBorder,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    gap: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabber,
  },
  heading: {
    gap: 6,
  },
  title: {
    ...typography.h3,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
