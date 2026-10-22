/**
 * Face Registration Screen
 *
 * Remote control for face registration - captures photos using the mirror's camera.
 * This provides a seamless experience where the user sees the same view on both
 * their phone and the mirror, creating a magical synchronized experience.
 */

import { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  ScrollView,
} from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api, WS_CLOSE_PAIRING_REQUIRED } from '@/lib/api';
import { MirrorCameraPreview, KeyboardAvoidingScreen } from '@/components';
import { goBack } from '@/lib/navigation';
import { useUser } from '@/context/UserContext';
import { Button, Field, Footer, IconCircle, Notice, Spinner, Text } from '@/components/ui';
import { colors, spacing, typography, fonts } from '@/lib/theme';

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
  /** Token of the active enrollment session; the only key to the mirror's camera stream. */
  enrollmentToken?: string | null;
}

export default function FaceRegistrationScreen() {
  const insets = useSafeAreaInsets();
  const { user, currentMirror, markFaceEnrolled } = useUser();

  const [step, setStep] = useState<'name' | 'capture' | 'complete'>('name');
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [processing, setProcessing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mirrorHost, setMirrorHost] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Mirror the values the unmount cleanup needs; the cleanup closure would
  // otherwise only ever see the initial render's state.
  const stepRef = useRef(step);
  stepRef.current = step;
  const activeRef = useRef(false);
  activeRef.current = registration?.active ?? false;

  // The native back button / swipe-back can leave mid-capture. Cancel the
  // session on the mirror so it doesn't stay stuck in registration mode.
  useEffect(
    () => () => {
      if (stepRef.current === 'capture' && activeRef.current) {
        api.cancelRegistration().catch(() => {});
      }
    },
    []
  );

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

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!mirrorHost || step !== 'capture') return;

    // Phones authenticate the socket with their pairing token as a subprotocol.
    let ws: WebSocket | null = null;
    let closed = false;
    const onMessage = (event: WebSocketMessageEvent) => {
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

    api.getWebSocketProtocols().then((protocols) => {
      if (closed) return;
      ws = new WebSocket(api.getWebSocketUrl(), protocols);
      ws.onmessage = onMessage;
      ws.onclose = (event) => {
        // Token revoked while enrolling: same as an HTTP 401 pairing_required.
        if (event.code === WS_CLOSE_PAIRING_REQUIRED) void api.handleSocketPairingRequired();
      };
    });

    return () => {
      closed = true;
      ws?.close();
    };
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
      const result = await api.startRegistration(name.trim(), user?.id);

      if (result.active) {
        setRegistration(result);
        setStep('capture');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        throw new Error(result.error || 'Failed to start registration');
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
      const result = await api.captureRegistration();

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

  const currentInstruction = registration
    ? CAPTURE_INSTRUCTIONS[Math.min(registration.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)]
    : CAPTURE_INSTRUCTIONS[0];

  // The mirror only streams its camera during the session this screen
  // started, with that session's token (start response / WebSocket events).
  const videoStreamUrl = api.getVideoFeedUrl(registration?.enrollmentToken ?? null);

  // Name entry step
  if (step === 'name') {
    return (
      <KeyboardAvoidingScreen style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <IconCircle icon="person-outline" />

          <View style={styles.heading}>
            <Text style={styles.title}>What's your name?</Text>
            <Text style={styles.subtitle}>
              The mirror will greet you personally when it recognizes you
            </Text>
          </View>

          <Field
            label="Name"
            placeholder="Enter your name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={startRegistration}
          />

          {error && <Notice tone="error" message={error} />}
        </ScrollView>

        <Footer>
          <Button
            label="Start Registration"
            trailingIcon="arrow-forward"
            onPress={startRegistration}
            disabled={!name.trim()}
            loading={processing}
          />
        </Footer>
      </KeyboardAvoidingScreen>
    );
  }

  // Capture step - remote control for mirror camera
  if (step === 'capture') {
    const collected = registration?.samplesCollected || 0;
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{ title: 'Face Registration' }}
        />

        {/* Flash overlay */}
        <Animated.View
          style={[styles.flashOverlay, { opacity: flashAnim }]}
          pointerEvents="none"
        />

        <ScrollView contentContainerStyle={styles.captureContent}>
          {/* Camera preview from mirror */}
          <View style={styles.previewContainer}>
            <MirrorCameraPreview streamUrl={videoStreamUrl} style={styles.preview} />

            {/* Face guide */}
            <View style={styles.faceGuide} pointerEvents="none">
              <Svg width={170} height={220}>
                <Ellipse
                  cx={85}
                  cy={110}
                  rx={84}
                  ry={109}
                  stroke={colors.faceGuide}
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                  fill="none"
                />
              </Svg>
            </View>

            {/* Countdown overlay */}
            {countdown !== null && countdown > 0 && (
              <View style={styles.countdownOverlay}>
                <Text style={styles.countdownNumber}>{countdown}</Text>
              </View>
            )}

            {/* "Look at mirror" badge */}
            <View style={styles.mirrorBadge}>
              <Ionicons name="tv-outline" size={14} color={colors.primary} />
              <Text style={styles.mirrorBadgeText}>Look at the mirror</Text>
            </View>
          </View>

          {/* Instruction */}
          <View style={styles.instructionContainer}>
            <Ionicons
              name={currentInstruction.icon as keyof typeof Ionicons.glyphMap}
              size={22}
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
                    i < collected && styles.progressDotComplete,
                    i === collected && styles.progressDotCurrent,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.progressText}>
              {collected} of {REQUIRED_PHOTOS} photos
            </Text>
          </View>

          {error && <Notice tone="error" message={error} style={styles.captureError} />}
        </ScrollView>

        {/* Capture button */}
        <Footer style={styles.captureSection}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Pressable
              style={({ pressed }) => [styles.captureButton, pressed && styles.captureButtonPressed]}
              onPress={capturePhoto}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel="Capture photo"
              accessibilityState={{ disabled: capturing, busy: capturing }}
            >
              {capturing ? (
                <Spinner size="large" />
              ) : (
                <View style={styles.captureButtonInner} />
              )}
            </Pressable>
          </Animated.View>
          <Text style={styles.captureHint}>
            {capturing ? 'Capturing...' : 'Tap to capture'}
          </Text>
        </Footer>
      </View>
    );
  }

  // Complete step - celebration!
  const handleComplete = async () => {
    // Update face enrollment status in context
    if (currentMirror && markFaceEnrolled) {
      await markFaceEnrolled(currentMirror.mirrorId);
    }
    goBack('/dashboard');
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.successContent,
          { paddingTop: insets.top + 112, transform: [{ scale: successScale }] },
        ]}
      >
        <View style={styles.successCircle}>
          <Ionicons name="checkmark" size={32} color={colors.primary} />
        </View>

        <View style={styles.heading}>
          <Text style={styles.successTitle}>{`Welcome, ${name}!`}</Text>
          <Text style={styles.successSubtitle}>Your face has been registered</Text>
          <Text style={styles.subtitle}>
            The mirror will now recognize you and wake up automatically when you approach
          </Text>
        </View>
      </Animated.View>

      <Footer>
        <Button label="Continue Setup" trailingIcon="arrow-forward" onPress={handleComplete} />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 40,
    paddingBottom: spacing.lg,
    gap: 28,
  },
  heading: {
    gap: 10,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  captureContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: spacing.md,
    gap: 20,
    alignItems: 'center',
  },
  previewContainer: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: 400,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.thumbTileBorder,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    ...StyleSheet.absoluteFill,
  },
  faceGuide: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontSize: 96,
    fontWeight: '200',
    color: colors.text,
    opacity: 0.9,
  },
  mirrorBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.previewPill,
  },
  mirrorBadgeText: {
    fontSize: 12,
    color: colors.text,
  },
  instructionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  instructionText: {
    fontSize: 17,
    color: colors.text,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressDots: {
    flexDirection: 'row',
    gap: 6,
  },
  progressDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.progressPending,
  },
  progressDotComplete: {
    backgroundColor: colors.primary,
  },
  progressDotCurrent: {
    backgroundColor: colors.text,
  },
  progressText: {
    ...typography.caption,
    fontFamily: fonts.mono,
    color: colors.textMuted,
  },
  captureError: {
    alignSelf: 'stretch',
  },
  captureSection: {
    alignItems: 'center',
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: colors.text,
    padding: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonPressed: {
    opacity: 0.7,
  },
  captureButtonInner: {
    width: '100%',
    height: '100%',
    borderRadius: 33,
    backgroundColor: colors.primary,
  },
  captureHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  flashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.text,
    zIndex: 100,
  },
  successContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    ...typography.h1,
    fontSize: 36,
    fontWeight: '200',
    color: colors.text,
  },
  successSubtitle: {
    fontSize: 17,
    color: colors.text,
  },
});
