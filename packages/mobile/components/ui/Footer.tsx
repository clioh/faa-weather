/**
 * Pinned screen footer for the primary action (and an optional secondary
 * button, text button or caption), padded above the home indicator.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '@/lib/theme';

export function Footer({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  footer: {
    paddingTop: 12,
    paddingHorizontal: spacing.lg,
    gap: 6,
  },
});
