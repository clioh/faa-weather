/**
 * Bottom toolbar: the editor's global actions. Per-tile actions live in the
 * SelectionBar above it.
 */

import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/lib/theme';

interface ToolbarProps {
  onAdd: () => void;
  onTemplates: () => void;
  onTidy: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canTidy: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export function Toolbar({ onAdd, onTemplates, onTidy, onUndo, onRedo, canTidy, canUndo, canRedo }: ToolbarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <ToolButton icon="add-circle" label="Add widget" onPress={onAdd} primary />
      <ToolButton icon="albums-outline" label="Templates" onPress={onTemplates} />
      <ToolButton icon="grid-outline" label="Tidy" onPress={onTidy} disabled={!canTidy} />
      <ToolButton icon="arrow-undo-outline" label="Undo" onPress={onUndo} disabled={!canUndo} />
      <ToolButton icon="arrow-redo-outline" label="Redo" onPress={onRedo} disabled={!canRedo} />
    </View>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
  disabled,
  primary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const color = disabled ? colors.textDisabled : primary ? colors.primary : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={primary ? 26 : 22} color={color} />
      <Text style={[styles.label, { color: disabled ? colors.textDisabled : primary ? colors.primary : colors.textSecondary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  button: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
