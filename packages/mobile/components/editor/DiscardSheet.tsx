/**
 * Small bottom confirm shown when leaving the editor with unsaved changes.
 */

import { StyleSheet, View } from 'react-native';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { spacing } from '@/lib/theme';

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
  return (
    <BottomSheet
      visible={visible}
      onClose={onKeepEditing}
      onDismissed={onDismissed}
      closeLabel="Keep editing"
      title="Discard changes?"
      body="Your edits haven’t been saved. The mirror will go back to its saved layout."
    >
      <View style={styles.buttons}>
        <Button label="Discard" variant="danger" onPress={onDiscard} accessibilityLabel="Discard changes" />
        <Button label="Keep editing" variant="secondary" onPress={onKeepEditing} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  buttons: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
