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

export function Toolbar({
  onAdd,
  onTemplates,
  onTidy,
  onUndo,
  onRedo,
  canTidy,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <ToolButton icon="add-circle-outline" label="Add widget" onPress={onAdd} primary />
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
  const color = primary ? colors.primary : colors.chipText;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  button: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  disabled: {
    opacity: 0.35,
  },
  label: {
    fontSize: 11,
  },
});
