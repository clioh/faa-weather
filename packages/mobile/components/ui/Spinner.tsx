/**
 * Activity indicator in the accent colour. Use `onAccent` inside a primary
 * (accent-filled) button.
 */

import { ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/lib/theme';

interface SpinnerProps {
  size?: 'small' | 'large';
  onAccent?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Spinner({ size = 'small', onAccent, color, style, accessibilityLabel }: SpinnerProps) {
  return (
    <ActivityIndicator
      size={size}
      color={color ?? (onAccent ? colors.onPrimary : colors.primary)}
      style={style}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
