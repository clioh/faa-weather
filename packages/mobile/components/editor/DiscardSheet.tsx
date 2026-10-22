/**
 * Small bottom confirm shown when leaving the editor with unsaved changes.
 */

import { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';

interface DiscardSheetProps {
  visible: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
  /**
   * Called once the sheet has fully gone away. Navigation must wait for this:
   * on iOS, popping the screen while its modal is still dismissing can leave
   * the modal stuck or swallow the navigation.
   */
  onDismissed: () => void;
}

export function DiscardSheet({ visible, onDiscard, onKeepEditing, onDismissed }: DiscardSheetProps) {
  const insets = useSafeAreaInsets();

  // Modal's onDismiss is iOS-only; elsewhere the modal is gone as soon as
  // `visible` flips back to false.
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (Platform.OS !== 'ios' && wasVisible.current && !visible) onDismissed();
    wasVisible.current = visible;
  }, [visible, onDismissed]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onKeepEditing}
      onDismiss={Platform.OS === 'ios' ? onDismissed : undefined}
    >
      <Pressable style={styles.backdrop} onPress={onKeepEditing} accessibilityLabel="Keep editing">
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Discard changes?</Text>
          <Text style={styles.body}>
            Your edits haven’t been saved. The mirror will go back to its saved layout.
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.discard]}
            onPress={onDiscard}
            accessibilityRole="button"
            accessibilityLabel="Discard changes"
          >
            <Text style={styles.discardText}>Discard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.keep]}
            onPress={onKeepEditing}
            accessibilityRole="button"
            accessibilityLabel="Keep editing"
          >
            <Text style={styles.keepText}>Keep editing</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
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
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.text,
  },
  body: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  button: {
    minHeight: 50,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discard: {
    backgroundColor: 'rgba(255, 68, 68, 0.15)',
  },
  discardText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.error,
  },
  keep: {
    backgroundColor: colors.surfaceHighlight,
  },
  keepText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
});
