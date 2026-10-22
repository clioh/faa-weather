/**
 * KeyboardAvoidingScreen
 *
 * Drop-in screen container that keeps bottom-anchored inputs and buttons
 * above the keyboard.
 *
 * React Native's KeyboardAvoidingView measures itself relative to its parent,
 * so under a native navigation header (or inside a page-sheet modal) it pads
 * too little by exactly the header's height. This wrapper measures its own
 * position in the window and feeds that in as `keyboardVerticalOffset`, so it
 * works the same whether or not the screen has a header.
 *
 * On Android the window already resizes for the keyboard (Expo's default
 * `softwareKeyboardLayoutMode` is "resize"), so no behavior is applied there.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface KeyboardAvoidingScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function KeyboardAvoidingScreen({ children, style }: KeyboardAvoidingScreenProps) {
  const outerRef = useRef<View>(null);
  const [offset, setOffset] = useState(0);

  const handleLayout = useCallback(() => {
    outerRef.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y) && y !== offset) setOffset(y);
    });
  }, [offset]);

  return (
    <View ref={outerRef} onLayout={handleLayout} style={[styles.flex, style]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={offset}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
