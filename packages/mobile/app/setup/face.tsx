/**
 * Face Registration Screen
 *
 * The phone starts the session (name, POST /api/registration/start); from then
 * on the mirror's presence server takes each of the five photos itself once
 * the face is framed, posed and steady, and shows live guidance on the glass.
 * This screen follows along over the WebSocket: current instruction, the same
 * hint, progress, Cancel, and a "Take photo now" fallback (3-2-1 countdown).
 * The phone never shows the camera feed.
 */

import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api, WS_CLOSE_PAIRING_REQUIRED, type RegistrationStatus } from '@/lib/api';
import { KeyboardAvoidingScreen } from '@/components';
import { goBack } from '@/lib/navigation';
import { useUser } from '@/context/UserContext';
import { Button, Field, Footer, IconCircle, Notice, Text, TextButton } from '@/components/ui';
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

/** The mirror's hint for a guidance reason (same table as the mirror overlay). */
function guidanceHint(guidance: RegistrationStatus['guidance'], step: number): string | null {
  switch (guidance?.reason) {
    case 'no_face':
      return 'Step in front of the mirror';
    case 'multiple':
      return 'Only one person, please';
    case 'too_far':
      return 'Move a little closer';
    case 'off_centre':
      return 'Centre your face in the outline';
    case 'turn_more':
      if (step === 1 || step === 2) return 'Turn a little further';
      if (step === 3) return 'Tilt up a little further';
      if (step === 4) return 'A bigger smile';
      return null;
    case 'other_way':
      return 'Now turn the other way';
    case 'hold':
      return 'Hold still';
    default:
      return null; // cooldown: the next instruction is enough
  }
}

export default function FaceRegistrationScreen() {
  const insets = useSafeAreaInsets();
  const { user, currentMirror, markFaceEnrolled } = useUser();

  const [step, setStep] = useState<'name' | 'capture' | 'complete'>('name');
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState<RegistrationStatus | null>(null);
  const [processing, setProcessing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mirrorHost, setMirrorHost] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Mirror the values the unmount cleanup needs; the cleanup closure would
  // otherwise only ever see the initial render's state.
  const stepRef = useRef(step);
  stepRef.current = step;
  const activeRef = useRef(false);
  activeRef.current = registration?.active ?? false;
  const cancellingRef = useRef(false);

  // The native back button / swipe-back can leave mid-capture. Cancel the
  // session on the mirror so it doesn't stay stuck in registration mode.
  useEffect(
    () => () => {
      if (stepRef.current === 'capture' && activeRef.current && !cancellingRef.current) {
        api.cancelRegistration().catch(() => {});
      }
    },
    []
  );

  // Animation values
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
          const data = message.data as RegistrationStatus;
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
            setError(null);
          } else if (data.action === 'cancelled' && !cancellingRef.current) {
            // Expired, or ended on the mirror.
            setError('The mirror ended registration. Go back and start again.');
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
      // Catch up on guidance / progress sent before the socket opened.
      ws.onopen = () => {
        api
          .getRegistration()
          .then((state) => {
            if (!closed && state.active) setRegistration((prev) => ({ ...state, action: prev?.action }));
          })
          .catch(() => {});
      };
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

  // Fallback when hands-free capture doesn't trigger: the mirror counts down
  // 3-2-1 and takes the photo with the framing check only.
  const capturePhoto = async () => {
    if (capturing) return;

    setCapturing(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await api.captureRegistration();

      if (!result.success) {
        setError(result.error || 'Capture failed');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      // The photo itself arrives as a 'captured' event.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setCapturing(false);
    }
  };

  const cancelCapture = async () => {
    cancellingRef.current = true;
    setCancelling(true);
    try {
      await api.cancelRegistration();
    } catch {
      // Leaving anyway; the session also expires on the mirror.
    }
    activeRef.current = false;
    goBack('/dashboard');
  };

  const collected = registration?.samplesCollected || 0;
  const currentInstruction = CAPTURE_INSTRUCTIONS[Math.min(collected, CAPTURE_INSTRUCTIONS.length - 1)];
  // Right after a photo the stored hint is stale until the next one arrives.
  const hint = registration?.action === 'captured' ? null : guidanceHint(registration?.guidance, collected);

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

  // Capture step - progress while the mirror takes the photos
  if (step === 'capture') {
    const counting = countdown !== null && countdown > 0;
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Face registration' }} />

        {/* Flash overlay */}
        <Animated.View style={[styles.flashOverlay, { opacity: flashAnim }]} pointerEvents="none" />

        <ScrollView contentContainerStyle={styles.captureContent}>
          <View style={styles.heading}>
            <View style={styles.mirrorCue}>
              <Ionicons name="tv-outline" size={24} color={colors.primary} />
              <Text style={styles.mirrorCueText}>Look at the mirror</Text>
            </View>
            <Text style={styles.subtitle}>
              The mirror takes each photo when you hold still. Follow the prompts on the glass.
            </Text>
          </View>

          {/* Current instruction, or the 3-2-1 countdown of a manual photo */}
          <View style={styles.stage} accessibilityLiveRegion="polite">
            <View style={styles.stageCircle}>
              {counting ? (
                <Text style={styles.countdownNumber}>{countdown}</Text>
              ) : (
                <Ionicons
                  name={currentInstruction.icon as keyof typeof Ionicons.glyphMap}
                  size={40}
                  color={colors.primary}
                />
              )}
            </View>
            <Text style={styles.instructionText}>{currentInstruction.text}</Text>
            <Text style={styles.hintText}>{counting ? 'Hold still' : hint ?? ' '}</Text>
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

        <Footer>
          <Button
            label="Take photo now"
            variant="secondary"
            icon="camera-outline"
            onPress={capturePhoto}
            loading={capturing}
            disabled={cancelling || registration?.active === false}
            accessibilityHint="The mirror counts down from three, then takes the photo"
          />
          <TextButton
            label="Cancel"
            onPress={cancelCapture}
            disabled={cancelling}
            style={styles.cancelButton}
          />
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
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: 32,
  },
  mirrorCue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mirrorCueText: {
    ...typography.h1,
    color: colors.text,
  },
  stage: {
    alignItems: 'center',
    gap: 14,
    paddingTop: spacing.md,
  },
  stageCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontSize: 64,
    fontWeight: '200',
    color: colors.text,
  },
  instructionText: {
    fontSize: 20,
    color: colors.text,
    textAlign: 'center',
  },
  hintText: {
    ...typography.body,
    color: colors.primary,
    textAlign: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  cancelButton: {
    alignSelf: 'center',
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
