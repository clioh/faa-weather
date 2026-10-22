/**
 * Error Toast Component
 * Displays error messages with optional retry action
 */

import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

const TOAST_COLORS: Record<ToastType, { bg: string; icon: string; iconName: keyof typeof Ionicons.glyphMap }> = {
  error: {
    bg: 'rgba(255, 68, 68, 0.15)',
    icon: colors.error,
    iconName: 'alert-circle',
  },
  warning: {
    bg: 'rgba(255, 170, 0, 0.15)',
    icon: colors.warning,
    iconName: 'warning',
  },
  info: {
    bg: 'rgba(0, 136, 255, 0.15)',
    icon: colors.info,
    iconName: 'information-circle',
  },
  success: {
    bg: 'rgba(0, 255, 136, 0.15)',
    icon: colors.success,
    iconName: 'checkmark-circle',
  },
};

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

  const toastStyle = TOAST_COLORS[type];

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
      <View style={[styles.toast, { backgroundColor: toastStyle.bg }]}>
        <Ionicons
          name={toastStyle.iconName}
          size={24}
          color={toastStyle.icon}
          style={styles.icon}
        />

        <Text style={styles.message} numberOfLines={3}>
          {message}
        </Text>

        <View style={styles.actions}>
          {onRetry && (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={handleRetry}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="refresh" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
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

  return (
    <View style={styles.inlineContainer}>
      <Ionicons name="alert-circle" size={18} color={colors.error} />
      <Text style={styles.inlineMessage}>{message}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.inlineAction}>
          <Ionicons name="refresh" size={16} color={colors.primary} />
        </TouchableOpacity>
      )}
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} style={styles.inlineAction}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: spacing.md,
    right: spacing.md,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: SCREEN_WIDTH - spacing.md * 2,
  },
  icon: {
    marginRight: spacing.sm,
  },
  message: {
    ...typography.bodySmall,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  retryButton: {
    padding: spacing.xs,
  },
  dismissButton: {
    padding: spacing.xs,
  },

  // Inline error styles
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  inlineMessage: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
  },
  inlineAction: {
    padding: spacing.xs,
  },
});
