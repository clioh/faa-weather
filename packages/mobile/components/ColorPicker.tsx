/**
 * Color Picker Component
 * Select from preset colors or enter a custom hex value
 */

import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Keyboard,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, borderRadius, typography, fonts } from '@/lib/theme';
import { ScreenHeader } from './ScreenHeader';

// Preset color palettes
const COLOR_PRESETS = [
  // Primary colors
  { name: 'Green', value: '#00ff88' },
  { name: 'Blue', value: '#0088ff' },
  { name: 'Purple', value: '#9b59b6' },
  { name: 'Pink', value: '#e91e63' },
  { name: 'Red', value: '#ff4444' },
  { name: 'Orange', value: '#ffaa00' },
  { name: 'Yellow', value: '#f1c40f' },
  { name: 'Teal', value: '#1abc9c' },
  // Neutral colors
  { name: 'White', value: '#ffffff' },
  { name: 'Light Gray', value: '#bdc3c7' },
  { name: 'Gray', value: '#7f8c8d' },
  { name: 'Dark Gray', value: '#34495e' },
];

interface ColorPickerProps {
  visible: boolean;
  currentValue?: string;
  onSelect: (color: string) => void;
  onClose: () => void;
}

export function ColorPicker({
  visible,
  currentValue,
  onSelect,
  onClose,
}: ColorPickerProps) {
  const [selectedColor, setSelectedColor] = useState(currentValue || '#00ff88');
  const [customHex, setCustomHex] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    if (visible && currentValue) {
      setSelectedColor(currentValue);
      // Check if it's a custom color
      const isPreset = COLOR_PRESETS.some(
        (c) => c.value.toLowerCase() === currentValue.toLowerCase()
      );
      if (!isPreset) {
        setCustomHex(currentValue.replace('#', ''));
        setShowCustom(true);
      }
    }
  }, [visible, currentValue]);

  const handlePresetSelect = (color: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedColor(color);
    setShowCustom(false);
  };

  const handleCustomSubmit = () => {
    let hex = customHex.trim().replace('#', '');

    // Validate hex color
    if (!/^[0-9A-Fa-f]{6}$/.test(hex) && !/^[0-9A-Fa-f]{3}$/.test(hex)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Expand 3-character hex to 6
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }

    const color = `#${hex}`;
    setSelectedColor(color);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
  };

  const handleConfirm = () => {
    onSelect(selectedColor);
    onClose();
  };

  const handleClose = () => {
    setShowCustom(false);
    setCustomHex('');
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <ScreenHeader
          title="Choose Color"
          leftIcon="close"
          onLeftPress={handleClose}
          useTopInset={false}
        />

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* Preview */}
          <View style={styles.previewSection}>
            <View style={[styles.previewSwatch, { backgroundColor: selectedColor }]} />
            <Text style={styles.previewHex}>{selectedColor.toUpperCase()}</Text>
          </View>

          {/* Preset Colors */}
          <Text style={styles.sectionTitle}>Preset Colors</Text>
          <View style={styles.presetsGrid}>
            {COLOR_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.value}
                style={[
                  styles.presetItem,
                  selectedColor.toLowerCase() === preset.value.toLowerCase() &&
                    styles.presetItemSelected,
                ]}
                onPress={() => handlePresetSelect(preset.value)}
              >
                <View style={[styles.presetSwatch, { backgroundColor: preset.value }]}>
                  {selectedColor.toLowerCase() === preset.value.toLowerCase() && (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={isLightColor(preset.value) ? '#000' : '#fff'}
                    />
                  )}
                </View>
                <Text style={styles.presetName}>{preset.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Color Toggle */}
          <TouchableOpacity
            style={styles.customToggle}
            onPress={() => setShowCustom(!showCustom)}
          >
            <Ionicons name="color-palette-outline" size={20} color={colors.textMuted} />
            <Text style={styles.customToggleText}>Enter custom hex color</Text>
            <Ionicons
              name={showCustom ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {/* Custom Hex Input */}
          {showCustom && (
            <View style={styles.customForm}>
              <View style={styles.hexInputContainer}>
                <Text style={styles.hexPrefix}>#</Text>
                <TextInput
                  style={styles.hexInput}
                  value={customHex}
                  onChangeText={(text) => setCustomHex(text.replace(/[^0-9A-Fa-f]/g, ''))}
                  placeholder="FF5500"
                  placeholderTextColor={colors.textMuted}
                  maxLength={6}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleCustomSubmit}
                />
                <TouchableOpacity style={styles.applyButton} onPress={handleCustomSubmit}>
                  <Text style={styles.applyButtonText}>Apply</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hexHint}>
                Enter a 6-digit hex code (e.g., FF5500 for orange)
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
            <View style={[styles.confirmPreview, { backgroundColor: selectedColor }]} />
            <Text style={styles.confirmButtonText}>Use This Color</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Helper to determine if a color is light (for contrast)
function isLightColor(hex: string): boolean {
  const color = hex.replace('#', '');
  const r = parseInt(color.substr(0, 2), 16);
  const g = parseInt(color.substr(2, 2), 16);
  const b = parseInt(color.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  previewSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  previewSwatch: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  previewHex: {
    ...typography.body,
    color: colors.text,
    fontFamily: fonts.mono,
    fontWeight: '600',
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  presetItem: {
    width: '23%',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  presetSwatch: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetName: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  customToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  customToggleText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  customForm: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hexInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hexPrefix: {
    ...typography.h3,
    color: colors.textMuted,
  },
  hexInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
    fontFamily: fonts.mono,
  },
  applyButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.md,
  },
  applyButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  hexHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmButton: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  confirmPreview: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  confirmButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
