/**
 * On = accent track with an onPrimary knob; off = outline track with a light
 * knob. Same props as the react-native Switch the screens already use.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/lib/theme';

interface SwitchProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

const TRACK_W = 48;
const TRACK_H = 28;
const PAD = 3;
const KNOB_ON = 22;
const KNOB_OFF = 20;
// Off knob sits inside the 1px border; on knob is flush with the padding.
const TRAVEL = TRACK_W - PAD * 2 - KNOB_ON;

export function Switch({ value, onValueChange, disabled, accessibilityLabel, accessibilityHint, style }: SwitchProps) {
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(position, { toValue: value ? 1 : 0, duration: 150, useNativeDriver: true }).start();
  }, [value, position]);

  return (
    <Pressable
      onPress={() => onValueChange?.(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.track, value ? styles.trackOn : styles.trackOff, disabled && styles.disabled, style]}
    >
      <Animated.View
        style={[
          value ? styles.knobOn : styles.knobOff,
          { transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }] },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    padding: PAD,
    justifyContent: 'center',
  },
  trackOn: {
    backgroundColor: colors.primary,
  },
  trackOff: {
    borderWidth: 1,
    borderColor: colors.switchOffBorder,
    paddingHorizontal: PAD - 1,
  },
  disabled: {
    opacity: 0.4,
  },
  knobOn: {
    width: KNOB_ON,
    height: KNOB_ON,
    borderRadius: KNOB_ON / 2,
    backgroundColor: colors.onPrimary,
  },
  knobOff: {
    width: KNOB_OFF,
    height: KNOB_OFF,
    borderRadius: KNOB_OFF / 2,
    backgroundColor: colors.switchOffKnob,
  },
});
