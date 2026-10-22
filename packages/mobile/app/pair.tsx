/**
 * Pair this phone with a mirror (code flow)
 *
 * Opened by lib/pairing (never directly): when connecting to a mirror this
 * phone has no token for, or when the mirror stops accepting its token.
 * Asks the mirror to show a 6-digit code (POST /api/pairing/request), takes
 * the code (POST /api/pairing/complete, which stores the token) and pops
 * itself so the caller carries on. Seeing the code needs someone at the
 * mirror, which is the point.
 *
 * Works on whatever mirror the API client points at.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, ApiError, INVALID_PAIRING_CODE, type PairingRequest } from '@/lib/api';
import { commonPairingError, expiryMs, getDeviceName, settlePairing } from '@/lib/pairing';
import { goBack } from '@/lib/navigation';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { KeyboardAvoidingScreen, ScreenHeader } from '@/components';
import { Notice, SecondaryButton } from '@/components/calendar/ui';
import { CodeInput, CODE_LENGTH, type CodeInputHandle } from '@/components/pairing/CodeInput';

/** The mirror voids a request after this many wrong codes. */
const MAX_ATTEMPTS = 5;

function remainingAttempts(err: ApiError): number | null {
  const v = err.details?.attemptsRemaining;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PairScreen() {
  const params = useLocalSearchParams<{ flow?: string; mirrorName?: string; reason?: string }>();
  const flow = typeof params.flow === 'string' ? params.flow : undefined;
  const mirrorName = typeof params.mirrorName === 'string' && params.mirrorName ? params.mirrorName : null;
  const expiredPairing = params.reason === 'expired';

  const [request, setRequest] = useState<PairingRequest | null>(null);
  const [requesting, setRequesting] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [completing, setCompleting] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  /** The request can't be used any more (too many tries, or the mirror dropped it). */
  const [voided, setVoided] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const wrongTries = useRef(0);
  const inputRef = useRef<CodeInputHandle>(null);
  const done = useRef(false);

  // Leaving without pairing tells the caller "not paired".
  useEffect(() => () => settlePairing(flow, false), [flow]);

  const requestCode = useCallback(async () => {
    setRequesting(true);
    setRequestError(null);
    setCodeError(null);
    setVoided(null);
    setCode('');
    wrongTries.current = 0;
    try {
      const next = await api.requestPairing(getDeviceName());
      setRequest(next);
      setNow(Date.now());
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      setRequest(null);
      setRequestError(
        commonPairingError(err) ??
          (err instanceof Error && err.message ? err.message : 'The mirror couldn’t start pairing.')
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRequesting(false);
    }
  }, []);

  useEffect(() => {
    requestCode();
  }, [requestCode]);

  // Countdown tick while a code is showing on the mirror.
  const expiresAt = request ? expiryMs(request.expiresAt) : NaN;
  const expired = request !== null && Number.isFinite(expiresAt) && now >= expiresAt;
  useEffect(() => {
    if (!request || expired || voided) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request, expired, voided]);

  const submit = async (digits: string) => {
    if (!request || completing || done.current || digits.length !== CODE_LENGTH) return;
    if (expired) return;
    setCompleting(true);
    setCodeError(null);
    try {
      await api.completePairing(request.requestId, digits);
      done.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Resolve first so the caller continues once this screen has popped.
      settlePairing(flow, true);
      goBack('/');
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCode('');
      const common = commonPairingError(err);
      if (common) {
        setCodeError(common);
      } else if (err instanceof ApiError && err.code === INVALID_PAIRING_CODE) {
        wrongTries.current += 1;
        const left = remainingAttempts(err) ?? Math.max(0, MAX_ATTEMPTS - wrongTries.current);
        if (err.details?.requestExpired === true || left <= 0) {
          // Expired, or voided after too many wrong codes; the mirror says which.
          setVoided(err.message || 'This code is no longer valid. Show a new code on the mirror.');
        } else {
          setCodeError(
            `That code doesn’t match the one on the mirror. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          );
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      } else if (err instanceof ApiError && err.status !== undefined && err.status >= 400 && err.status < 500) {
        setVoided('This code is no longer valid. Show a new code on the mirror.');
      } else {
        setCodeError(err instanceof Error && err.message ? err.message : 'Pairing failed. Try again.');
      }
    } finally {
      setCompleting(false);
    }
  };

  const title = mirrorName ? `Pair with ${mirrorName}` : 'Pair with your mirror';
  const codeUsable = request !== null && !expired && !voided;

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScreenHeader title="Pair this phone" leftIcon="close" onLeftPress={() => goBack('/')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <Ionicons name="phone-portrait-outline" size={36} color={colors.primary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.body}>
          Your mirror will show a 6-digit code. Enter it here so this phone can set up and control the
          mirror. Only someone standing at the mirror can see the code.
        </Text>

        {expiredPairing ? (
          <Notice tone="info" message="This mirror no longer recognizes this phone, so it needs to be paired again." />
        ) : null}

        {requesting ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.waitingText}>Asking the mirror for a code…</Text>
          </View>
        ) : requestError ? (
          <>
            <Notice tone="error" message={requestError} />
            <SecondaryButton label="Try again" icon="refresh" onPress={requestCode} />
          </>
        ) : (
          <>
            <CodeInput
              ref={inputRef}
              value={code}
              onChange={(digits) => {
                setCode(digits);
                if (codeError) setCodeError(null);
              }}
              onComplete={submit}
              disabled={!codeUsable || completing}
              error={codeError !== null}
            />

            <View style={styles.statusRow} accessibilityLiveRegion="polite">
              {completing ? (
                <>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.statusText}>Checking the code…</Text>
                </>
              ) : codeUsable ? (
                <Text style={styles.statusText}>
                  Code expires in {formatCountdown(expiresAt - now)}
                </Text>
              ) : null}
            </View>

            {codeError ? <Notice tone="error" message={codeError} /> : null}
            {voided ? <Notice tone="warning" message={voided} /> : null}
            {expired && !voided ? (
              <Notice tone="warning" message="That code has expired. Show a new one on the mirror." />
            ) : null}

            <SecondaryButton
              label="Show a new code"
              icon="refresh"
              onPress={requestCode}
              disabled={completing}
              accessibilityLabel="Show a new code on the mirror"
            />
            <Text style={styles.hint}>
              Don’t see a code? Stand in front of the mirror to wake its display, and make sure this phone is
              on the same WiFi network.
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  iconWrap: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  title: { ...typography.h2, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  waitingText: { ...typography.bodySmall, color: colors.textSecondary },
  statusRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  statusText: { ...typography.bodySmall, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
