/**
 * Color Picker Component
 * Select from preset colors or enter a custom hex value
 */

import { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, ScrollView, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Footer, PageSheetHeader, Row, RowGroup, SectionLabel, Text, TextInput } from '@/components/ui';
import { colors, spacing, typography, fonts } from '@/lib/theme';
import { CALENDAR_PALETTE, colorName } from './calendar/meta';

// Preset colours: the mirror's palette (same as calendar colours), then neutrals.
const COLOR_PRESETS = [
  ...CALENDAR_PALETTE.map((value) => ({ name: colorName(value), value })),
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
  const [selectedColor, setSelectedColor] = useState(currentValue || COLOR_PRESETS[0].value);
  const [customHex, setCustomHex] = useState('');
  const [hexError, setHexError] = useState<string | null>(null);
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
      setHexError('Use 3 or 6 hex digits (0–9, A–F).');
      return;
    }
    setHexError(null);

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
    setHexError(null);
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
        <PageSheetHeader title="Choose Color" onClose={handleClose} />

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
          <View>
            <SectionLabel>Preset Colors</SectionLabel>
            <View style={styles.presetsGrid} accessibilityRole="radiogroup" accessibilityLabel="Preset colors">
              {COLOR_PRESETS.map((preset) => {
                const active = selectedColor.toLowerCase() === preset.value.toLowerCase();
                return (
                  <TouchableOpacity
                    key={preset.value}
                    style={[styles.presetItem, active && styles.presetItemSelected]}
                    onPress={() => handlePresetSelect(preset.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={preset.name}
                  >
                    <View style={[styles.presetSwatch, { backgroundColor: preset.value }]}>
                      {active && (
                        <Ionicons
                          name="checkmark"
                          size={22}
                          color={isLightColor(preset.value) ? colors.background : colors.text}
                        />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Custom Color Toggle */}
          <RowGroup>
            <Row
              icon="color-palette-outline"
              title="Enter custom hex color"
              onPress={() => setShowCustom(!showCustom)}
              trailing={
                <Ionicons name={showCustom ? 'chevron-up' : 'chevron-down'} size={14} color={colors.chevron} />
              }
            />
          </RowGroup>

          {/* Custom Hex Input */}
          {showCustom && (
            <View style={styles.customForm}>
              <View style={styles.hexRow}>
                <View style={[styles.hexInputContainer, hexError ? styles.hexInputError : null]}>
                  <Text style={styles.hexPrefix}>#</Text>
                  <TextInput
                    style={styles.hexInput}
                    value={customHex}
                    onChangeText={(text) => {
                      setCustomHex(text.replace(/[^0-9A-Fa-f]/g, ''));
                      if (hexError) setHexError(null);
                    }}
                    placeholder="FF5500"
                    placeholderTextColor={colors.textMuted}
                    maxLength={6}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleCustomSubmit}
                    accessibilityLabel="Custom hex color"
                  />
                </View>
                <Button label="Apply" size="small" onPress={handleCustomSubmit} style={styles.applyButton} />
              </View>
              {hexError ? (
                <Text style={styles.hexError} accessibilityRole="alert">
                  {hexError}
                </Text>
              ) : (
                <Text style={styles.hexHint}>Enter a 6-digit hex code (e.g., FF5500 for orange)</Text>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <Footer>
          <Button label="Use This Color" onPress={handleConfirm} />
        </Footer>
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
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: 22,
  },
  previewSection: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewSwatch: {
    width: 72,
    height: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  previewHex: {
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.text,
  },
  // Same grid as the calendar colour sheet.
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetItem: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  presetItemSelected: {
    borderColor: colors.text,
  },
  presetSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customForm: {
    gap: spacing.sm,
  },
  hexRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  hexInputContainer: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    gap: 4,
  },
  hexPrefix: {
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.textMuted,
  },
  hexInput: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  applyButton: {
    height: 48,
    borderRadius: 14,
    alignSelf: 'auto',
  },
  hexInputError: {
    borderColor: colors.error,
  },
  hexError: {
    ...typography.caption,
    color: colors.error,
  },
  hexHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
