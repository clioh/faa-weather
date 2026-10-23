/**
 * Outlook / Microsoft 365 sign-in with a device code: the mirror asks
 * Microsoft for a short code, the user enters it on Microsoft's page, and the
 * mirror finishes the sign-in on its own. The phone just shows the code and
 * checks in every few seconds while this screen is open.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Spinner, Text } from '@/components/ui';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { ApiError, api, type CalendarAccount, type MicrosoftDeviceCode } from '@/lib/api';
import { colors, spacing, typography, fonts } from '@/lib/theme';
import { calendarErrorMessage } from './meta';
import { Notice, PrimaryButton, SecondaryButton } from './ui';

const POLL_MS = 3000;

type Phase = 'starting' | 'waiting' | 'expired' | 'denied' | 'error';

interface MicrosoftConnectProps {
  onConnected: (account: CalendarAccount) => void;
  onCancel: () => void;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MicrosoftConnect({ onConnected, onCancel }: MicrosoftConnectProps) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [code, setCode] = useState<MicrosoftDeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  const started = useRef(false);
  const polling = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    setPhase('starting');
    setError(null);
    setCode(null);
    try {
      const next = await api.startMicrosoftSignIn();
      if (!mounted.current) return;
      setCode(next);
      setNow(Date.now());
      setPhase('waiting');
    } catch (e) {
      if (!mounted.current) return;
      setError(calendarErrorMessage(e, 'Couldn’t get a sign-in code from Microsoft.'));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  const expiresAt = code ? new Date(code.expiresAt).getTime() : 0;

  // Poll and tick the countdown only while this screen is on top.
  useFocusEffect(
    useCallback(() => {
      if (phase !== 'waiting' || !code) return;

      const check = async () => {
        if (polling.current || done.current) return;
        polling.current = true;
        try {
          const res = await api.getMicrosoftSignInStatus(code.sessionId);
          if (!mounted.current || done.current) return;
          if (res.status === 'complete' && res.account) {
            done.current = true;
            // Close the in-app browser if the user is still looking at Microsoft's page (iOS).
            if (Platform.OS === 'ios') WebBrowser.dismissBrowser().catch(() => {});
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onConnected(res.account);
          } else if (res.status === 'expired') {
            setPhase('expired');
          } else if (res.status === 'denied') {
            setPhase('denied');
          } else if (res.status === 'error') {
            setError(res.error ?? 'Microsoft sign-in didn’t finish.');
            setPhase('error');
          }
        } catch (e) {
          // The mirror forgets sessions after they end; anything else is a
          // passing network blip, so keep checking.
          if (mounted.current && e instanceof ApiError && e.status === 404) setPhase('expired');
        } finally {
          polling.current = false;
        }
      };

      const poll = setInterval(check, POLL_MS);
      const tick = setInterval(() => setNow(Date.now()), 1000);
      check();
      return () => {
        clearInterval(poll);
        clearInterval(tick);
      };
    }, [phase, code, onConnected])
  );

  useEffect(() => {
    if (phase === 'waiting' && expiresAt && now >= expiresAt) setPhase('expired');
  }, [phase, now, expiresAt]);

  const openSignIn = async () => {
    if (!code || opening) return;
    setOpening(true);
    try {
      await WebBrowser.openBrowserAsync(code.verificationUri);
    } catch {
      setError('Couldn’t open the browser. Go to the address below on any device instead.');
    } finally {
      if (mounted.current) setOpening(false);
    }
  };

  if (phase === 'starting') {
    return (
      <View style={styles.centered}>
        <Spinner size="large" />
        <Text style={styles.muted}>Getting a sign-in code…</Text>
      </View>
    );
  }

  if (phase === 'error' && !code) {
    return (
      <View style={styles.wrap}>
        <Notice tone="error" message={error ?? 'Something went wrong.'} />
        <PrimaryButton label="Try again" onPress={start} />
        <SecondaryButton label="Choose another calendar" onPress={onCancel} />
      </View>
    );
  }

  if (phase === 'expired' || phase === 'denied' || phase === 'error') {
    const message =
      phase === 'expired'
        ? 'That code expired before sign-in finished. Get a new one and try again.'
        : phase === 'denied'
          ? 'Sign-in was declined on the Microsoft page, so nothing was connected.'
          : (error ?? 'Microsoft sign-in didn’t finish.');
    return (
      <View style={styles.wrap}>
        <Notice tone={phase === 'error' ? 'error' : 'warning'} message={message} />
        <PrimaryButton label="Get a new code" icon="refresh" onPress={start} />
        <SecondaryButton label="Choose another calendar" onPress={onCancel} />
      </View>
    );
  }

  const remaining = expiresAt - now;
  const host = code ? code.verificationUri.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';

  return (
    <View style={styles.wrap}>
      <Step n={1} title="Copy this code">
        <Text
          selectable
          style={styles.code}
          accessibilityLabel={`Sign-in code ${code?.userCode.split('').join(' ')}`}
        >
          {code?.userCode}
        </Text>
        <Text style={styles.muted}>Press and hold the code to copy it.</Text>
      </Step>

      <Step n={2} title="Sign in to Microsoft" divided>
        <Text style={styles.body}>
          Enter the code, then sign in with the Outlook or Microsoft 365 account whose calendar you
          want.
        </Text>
        <PrimaryButton
          label="Open Microsoft sign-in"
          icon="open-outline"
          onPress={openSignIn}
          loading={opening}
        />
        <Text style={styles.muted}>
          Or go to{' '}
          <Text selectable style={styles.link}>
            {host}
          </Text>{' '}
          on any device.
        </Text>
        {error ? <Notice tone="error" message={error} /> : null}
      </Step>

      <View style={styles.waiting} accessibilityLiveRegion="polite">
        <Spinner />
        <View style={styles.flex}>
          <Text style={styles.waitingText}>Waiting for you to finish signing in…</Text>
          <Text style={[styles.muted, styles.mono]}>
            Code expires in {formatRemaining(remaining)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Step({
  n,
  title,
  divided,
  children,
}: {
  n: number;
  title: string;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.step, divided && styles.stepDivided]}>
      <Text style={styles.stepNum}>{String(n).padStart(2, '0')}</Text>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle} accessibilityRole="header">
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  wrap: { gap: 26, paddingTop: spacing.xs },
  centered: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  body: { ...typography.bodySmall, lineHeight: 21, color: colors.textSecondary },
  muted: { ...typography.caption, color: colors.textMuted },
  mono: { fontFamily: fonts.mono },
  link: { fontFamily: fonts.mono, color: colors.text },
  step: { flexDirection: 'row', gap: 14 },
  stepDivided: { borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 22 },
  stepNum: { fontFamily: fonts.mono, fontSize: 13, color: colors.primary, paddingTop: 2 },
  stepTitle: { fontSize: 16, color: colors.text },
  stepBody: { flex: 1, gap: 10 },
  code: {
    fontFamily: fonts.mono,
    fontSize: 34,
    letterSpacing: 3,
    color: colors.text,
  },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  waitingText: { fontSize: 14, color: colors.text },
});
