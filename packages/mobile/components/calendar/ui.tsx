/**
 * Building blocks used by the calendar, pairing and connect screens. They
 * keep their original names and props but now render the shared primitives
 * in components/ui.
 */

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  BottomSheet,
  Button,
  Field as UIField,
  Notice as UINotice,
  type FieldProps,
  type IconName,
} from '@/components/ui';
import type { Tone } from '@/lib/theme';

// ------------------------------------------------------------------ Sheet

interface SheetProps {
  visible: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet over a dimmed backdrop; tapping the backdrop closes it. */
export function Sheet({ visible, title, body, onClose, children }: SheetProps) {
  return (
    <BottomSheet visible={visible} title={title} body={body} onClose={onClose}>
      {children}
    </BottomSheet>
  );
}

// ------------------------------------------------------------------ Buttons

interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** Read out instead of the label, e.g. with the account name added. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} variant="primary" />;
}

export function SecondaryButton({
  tone = 'default',
  ...props
}: ButtonProps & { tone?: 'default' | 'danger' }) {
  return <Button {...props} variant={tone === 'danger' ? 'danger' : 'secondary'} />;
}

// ------------------------------------------------------------------ Field

export function Field(props: FieldProps & { label: string }) {
  return <UIField {...props} />;
}

// ------------------------------------------------------------------ Notice

interface NoticeProps {
  tone: Tone;
  message: string;
  action?: { label: string; onPress: () => void };
}

export function Notice(props: NoticeProps) {
  return <UINotice {...props} />;
}

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
