/**
 * Styles shared by the config form controls so every field type lines up:
 * same 44pt minimum touch height, same input surface, same chip shape.
 */

import { StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography, fonts, sizes } from '@/lib/theme';

export const TOUCH = 44;

export const fieldStyles = StyleSheet.create({
  // Same box as components/ui Field: 52pt, radius 14, borderStrong outline.
  input: {
    minHeight: sizes.input,
    borderRadius: borderRadius.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    ...typography.body,
    fontSize: 16,
  },
  inputError: {
    borderColor: colors.error,
  },
  pickerRow: {
    minHeight: sizes.input,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingLeft: 14,
    gap: spacing.sm,
  },
  pickerRowMain: {
    flex: 1,
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pickerValue: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  // "Mirror default" and other empty values read as data.
  pickerPlaceholder: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  pickerSubvalue: {
    ...typography.caption,
    color: colors.textMuted,
  },
  iconButton: {
    width: TOUCH,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same as components/ui Chip: 34pt pill; selected = white fill, black text.
  chip: {
    minHeight: sizes.chip,
    paddingHorizontal: 14,
    borderRadius: sizes.chip / 2,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: colors.text,
    backgroundColor: colors.text,
  },
  chipText: {
    fontSize: 13,
    color: colors.chipText,
  },
  chipTextActive: {
    color: colors.background,
    fontWeight: '500',
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
