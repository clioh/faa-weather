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
 * Android uses the same padding. Apps are edge-to-edge there (mandatory with
 * Expo's target SDK on Android 15+), and an edge-to-edge window does not
 * resize for the keyboard, so `adjustResize` alone leaves inputs covered.
 * Padding is the overlap between this view's bottom and the keyboard's top,
 * so on older devices where the window does still resize it comes out as 0
 * rather than doubling up.
 *
 * Inside iOS page-sheet modals, pass `avoidOnIOS={false}` and let the
 * ScrollView handle it with `automaticallyAdjustKeyboardInsets`, which is
 * exact there; Android still gets the padding.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';

interface KeyboardAvoidingScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** False when an inner ScrollView already adjusts its insets on iOS. */
  avoidOnIOS?: boolean;
}

export function KeyboardAvoidingScreen({
  children,
  style,
  avoidOnIOS = true,
}: KeyboardAvoidingScreenProps) {
  const outerRef = useRef<ViewInstance>(null);
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
        behavior={Platform.OS === 'ios' && !avoidOnIOS ? undefined : 'padding'}
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
