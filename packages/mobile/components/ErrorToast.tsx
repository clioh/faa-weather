/**
 * Error Toast Component
 * Displays error messages with optional retry action
 */

import { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Notice } from '@/components/ui/Notice';
import { Toast } from '@/components/ui/Toast';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing } from '@/lib/theme';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

interface ErrorToastProps {
  visible: boolean;
  message: string;
  type?: ToastType;
  onDismiss: () => void;
  onRetry?: () => void;
  autoDismiss?: boolean;
  dismissAfter?: number;
}

export function ErrorToast({
  visible,
  message,
  type = 'error',
  onDismiss,
  onRetry,
  autoDismiss = true,
  dismissAfter = 5000,
}: ErrorToastProps) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Trigger haptic feedback
      if (type === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (type === 'warning') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }

      // Animate in
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto dismiss
      if (autoDismiss) {
        const timer = setTimeout(() => {
          handleDismiss();
        }, dismissAfter);

        return () => clearTimeout(timer);
      }
    } else {
      // Reset position when hidden
      translateY.setValue(-100);
      opacity.setValue(0);
    }
  }, [visible, autoDismiss, dismissAfter]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  const handleRetry = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    handleDismiss();
    if (onRetry) {
      // Small delay before retry to allow animation to complete
      setTimeout(onRetry, 250);
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Toast
        message={message}
        tone={type}
        numberOfLines={3}
        actions={
          <View style={styles.actions}>
            {onRetry && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleRetry}
                accessibilityRole="button"
                accessibilityLabel="Retry"
              >
                <Ionicons name="refresh" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        }
      />
    </Animated.View>
  );
}

/**
 * Inline error display for forms and lists
 */
interface InlineErrorProps {
  message: string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function InlineError({ message, onDismiss, onRetry }: InlineErrorProps) {
  if (!message) {
    return null;
  }

  return <Notice tone="error" message={message} onRetry={onRetry} onDismiss={onDismiss} />;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
