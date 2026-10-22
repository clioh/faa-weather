/**
 * 56pt outlined circle with a centred icon (accent by default). Used as the
 * lead visual on status screens: connect error, setup complete, face done.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { IconName } from './Button';
import { colors } from '@/lib/theme';

interface IconCircleProps {
  icon: IconName;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function IconCircle({ icon, color = colors.primary, style }: IconCircleProps) {
  return (
    <View style={[styles.circle, style]}>
      <Ionicons name={icon} size={26} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
