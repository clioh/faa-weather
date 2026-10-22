/**
 * Small mono tag: "NEW", "THIS PHONE", an update version, "NO FACE DATA".
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { colors, fonts } from '@/lib/theme';

interface BadgeProps {
  label: string;
  tone?: 'accent' | 'warning';
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'accent', style }: BadgeProps) {
  const warning = tone === 'warning';
  return (
    <View style={[styles.badge, warning && styles.warning, style]}>
      <Text style={[styles.text, warning && styles.warningText]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.badgeBorder,
  },
  warning: {
    borderColor: colors.badgeWarningBorder,
  },
  text: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  warningText: {
    color: colors.warning,
  },
});
