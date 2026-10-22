/**
 * Styles shared by the config form controls so every field type lines up:
 * same 44pt minimum touch height, same input surface, same chip shape.
 */

import { StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

export const TOUCH = 44;

export const fieldStyles = StyleSheet.create({
  input: {
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    ...typography.body,
  },
  inputError: {
    borderColor: colors.error,
  },
  pickerRow: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing.md,
    gap: spacing.sm,
  },
  pickerRowMain: {
    flex: 1,
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickerValue: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  pickerPlaceholder: {
    ...typography.body,
    color: colors.textMuted,
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
  chip: {
    minHeight: TOUCH - 8,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  chipText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
