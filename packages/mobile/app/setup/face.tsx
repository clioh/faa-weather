/**
 * Face Registration Screen
 *
 * Remote control for face registration - captures photos using the mirror's camera.
 * This provides a seamless experience where the user sees the same view on both
 * their phone and the mirror, creating a magical synchronized experience.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Image,
  Animated,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { useUser } from '@/context/UserContext';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

const REQUIRED_PHOTOS = 5;

// Guided instructions for each capture
const CAPTURE_INSTRUCTIONS = [
  { text: 'Look straight at the mirror', icon: 'person-outline' },
  { text: 'Turn your head slightly left', icon: 'arrow-back-outline' },
  { text: 'Turn your head slightly right', icon: 'arrow-forward-outline' },
  { text: 'Tilt your head up a little', icon: 'arrow-up-outline' },
  { text: 'Now smile naturally', icon: 'happy-outline' },
];

interface RegistrationState {
  active: boolean;
  samplesCollected: number;
  samplesNeeded: number;
  userName?: string;
  currentInstruction?: string;
  action?: string;
}

export default function FaceRegistrationScreen() {
  const params = useLocalSearchParams<{ reenroll?: string }>();
  const isReenrollment = params.reenroll === 'true';
  const { user, currentMirror, markFaceEnrolled } = useUser();

  // For re-enrollment, skip name step and use existing user name
  const [step, setStep] = useState<'name' | 'capture' | 'complete'>(
    isReenrollment && user ? 'capture' : 'name'
  );
  const [name, setName] = useState(isReenrollment && user ? user.name : '');
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [processing, setProcessing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mirrorHost, setMirrorHost] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Animation values
  const pulseAnim = useState(new Animated.Value(1))[0];
  const flashAnim = useState(new Animated.Value(0))[0];
  const successScale = useState(new Animated.Value(0))[0];

  // Get mirror host from API
  useEffect(() => {
    const baseUrl = api.getBaseUrl();
    if (baseUrl) {
      const host = baseUrl.replace('http://', '').replace(':3001', '');
      setMirrorHost(host);
    }
  }, []);

  // Auto-start registration for re-enrollment
  useEffect(() => {
    if (isReenrollment && user && mirrorHost && step === 'capture' && !registration) {
      startRegistration();
    }
  }, [isReenrollment, user, mirrorHost, step, registration]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!mirrorHost || step !== 'capture') return;

    const ws = new WebSocket(`ws://${mirrorHost}:3001`);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'registration') {
          const data = message.data as RegistrationState;
          setRegistration(data);

          if (data.action === 'capture-start') {
            // Start countdown animation
            setCountdown(3);
          } else if (data.action === 'captured') {
            // Flash effect and haptic feedback
            Animated.sequence([
              Animated.timing(flashAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
              }),
              Animated.timing(flashAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
              }),
            ]).start();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setCapturing(false);
          } else if (data.action === 'completed') {
            // Transition to success
            setStep('complete');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Animated.spring(successScale, {
              toValue: 1,
              tension: 50,
              friction: 3,
              useNativeDriver: true,
            }).start();
          }
        }
      } catch (e) {
        console.error('WebSocket parse error:', e);
      }
    };

    return () => ws.close();
  }, [mirrorHost, step]);

  // Countdown timer
  useEffect(() => {
    if (countdown === null) return;

    if (countdown > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCountdown(null);
    }
  }, [countdown]);

  // Pulse animation for capture button
  useEffect(() => {
    if (step !== 'capture' || capturing) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [step, capturing]);

  const startRegistration = async () => {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    setError(null);
    setProcessing(true);

    try {
      // Start registration on the mirror
      const response = await fetch(`${api.getBaseUrl()}/api/registration/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: name.trim() }),
      });
      const result = await response.json();

      if (result.active) {
        setRegistration(result);
        setStep('capture');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        throw new Error('Failed to start registration');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to mirror');
    } finally {
      setProcessing(false);
    }
  };

  const capturePhoto = async () => {
    if (capturing) return;

    setCapturing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Trigger capture on the mirror (this will start countdown)
      const response = await fetch(`${api.getBaseUrl()}/api/registration/capture`, {
        method: 'POST',
      });
      const result = await response.json();

      if (!result.success) {
        setError(result.error || 'Capture failed');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setCapturing(false);
      }
      // Success is handled via WebSocket
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCapturing(false);
    }
  };

  const cancelRegistration = async () => {
    try {
      await fetch(`${api.getBaseUrl()}/api/registration/cancel`, { method: 'POST' });
    } catch (e) {
      // Ignore errors
    }
    router.back();
  };

  const currentInstruction = registration
    ? CAPTURE_INSTRUCTIONS[Math.min(registration.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)]
    : CAPTURE_INSTRUCTIONS[0];

  const videoStreamUrl = mirrorHost ? `http://${mirrorHost}:5000/video_feed` : null;

  // Name entry step
  if (step === 'name') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="person-circle-outline" size={80} color={colors.primary} />
          </View>

          <Text style={styles.title}>What's your name?</Text>
          <Text style={styles.subtitle}>
            The mirror will greet you personally when it recognizes you
          </Text>

          <TextInput
            style={styles.nameInput}
            placeholder="Enter your name"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={startRegistration}
          />

          {error && (
            <View style={styles.errorContainer}>
              <Ionicons name="warning-outline" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primaryButton, !name.trim() && styles.buttonDisabled]}
            onPress={startRegistration}
            disabled={!name.trim() || processing}
          >
            {processing ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Start Registration</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.background} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Capture step - remote control for mirror camera
  if (step === 'capture') {
    return (
      <View style={styles.container}>
        {/* Flash overlay */}
        <Animated.View
          style={[styles.flashOverlay, { opacity: flashAnim }]}
          pointerEvents="none"
        />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={cancelRegistration} style={styles.cancelButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isReenrollment ? 'Update Face Data' : 'Face Registration'}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Camera preview from mirror */}
        <View style={styles.previewContainer}>
          {videoStreamUrl ? (
            <Image
              source={{ uri: videoStreamUrl }}
              style={styles.preview}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.previewPlaceholder}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.previewPlaceholderText}>Connecting to mirror...</Text>
            </View>
          )}

          {/* Countdown overlay */}
          {countdown !== null && countdown > 0 && (
            <View style={styles.countdownOverlay}>
              <Text style={styles.countdownNumber}>{countdown}</Text>
            </View>
          )}

          {/* "Look at mirror" badge */}
          <View style={styles.mirrorBadge}>
            <Ionicons name="tv-outline" size={16} color={colors.primary} />
            <Text style={styles.mirrorBadgeText}>Look at the mirror</Text>
          </View>
        </View>

        {/* Instruction */}
        <View style={styles.instructionContainer}>
          <Ionicons
            name={currentInstruction.icon as keyof typeof Ionicons.glyphMap}
            size={32}
            color={colors.primary}
          />
          <Text style={styles.instructionText}>{currentInstruction.text}</Text>
        </View>

        {/* Progress */}
        <View style={styles.progressContainer}>
          <View style={styles.progressDots}>
            {Array.from({ length: REQUIRED_PHOTOS }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i < (registration?.samplesCollected || 0) && styles.progressDotComplete,
                  i === (registration?.samplesCollected || 0) && styles.progressDotCurrent,
                ]}
              />
            ))}
          </View>
          <Text style={styles.progressText}>
            {registration?.samplesCollected || 0} of {REQUIRED_PHOTOS} photos
          </Text>
        </View>

        {/* Capture button */}
        <View style={styles.captureSection}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
              onPress={capturePhoto}
              disabled={capturing}
            >
              {capturing ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <View style={styles.captureButtonInner}>
                  <Ionicons name="camera" size={32} color={colors.background} />
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.captureHint}>
            {capturing ? 'Capturing...' : 'Tap to capture'}
          </Text>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning-outline" size={20} color={colors.error} />
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}
      </View>
    );
  }

  // Complete step - celebration!
  const handleComplete = async () => {
    // Update face enrollment status in context
    if (currentMirror && markFaceEnrolled) {
      await markFaceEnrolled(currentMirror.mirrorId);
    }
    router.back();
  };

  return (
    <View style={styles.successContainer}>
      <Animated.View style={[styles.successContent, { transform: [{ scale: successScale }] }]}>
        <View style={styles.successIconContainer}>
          <View style={styles.successCircle}>
            <Ionicons name="checkmark" size={60} color={colors.background} />
          </View>
        </View>

        <Text style={styles.successTitle}>
          {isReenrollment ? `Updated, ${name}!` : `Welcome, ${name}!`}
        </Text>
        <Text style={styles.successSubtitle}>
          {isReenrollment ? 'Your face data has been updated' : 'Your face has been registered'}
        </Text>
        <Text style={styles.successDescription}>
          {isReenrollment
            ? 'The mirror will now use your updated appearance for recognition'
            : 'The mirror will now recognize you and wake up automatically when you approach'}
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleComplete}
        >
          <Text style={styles.primaryButtonText}>
            {isReenrollment ? 'Done' : 'Continue Setup'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.background} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  nameInput: {
    width: '100%',
    height: 56,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.h3,
    textAlign: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  primaryButton: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  cancelButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  previewContainer: {
    marginHorizontal: spacing.lg,
    aspectRatio: 4 / 3,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
    position: 'relative',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  previewPlaceholderText: {
    ...typography.body,
    color: colors.textMuted,
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontSize: 120,
    fontWeight: '200',
    color: colors.primary,
  },
  mirrorBadge: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  mirrorBadgeText: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '500',
  },
  instructionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  instructionText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
  },
  progressContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  progressDots: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceHighlight,
  },
  progressDotComplete: {
    backgroundColor: colors.primary,
  },
  progressDotCurrent: {
    backgroundColor: colors.accent,
    transform: [{ scale: 1.3 }],
  },
  progressText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  captureSection: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  captureButton: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.primary,
  },
  captureButtonDisabled: {
    borderColor: colors.textMuted,
  },
  captureButtonInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureHint: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 100,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorBannerText: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
  },
  successContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  successContent: {
    alignItems: 'center',
  },
  successIconContainer: {
    marginBottom: spacing.xl,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  successSubtitle: {
    ...typography.h3,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  successDescription: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
