/**
 * Google sign-in. The mirror builds the Google URL (it holds the PKCE
 * verifier and client secret); the phone opens it in the system browser.
 * Google redirects to the skyglass.dev bounce page, which forwards code and
 * state to this app's deep link; we hand them straight back to the mirror.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { api, type CalendarAccount } from '@/lib/api';
import { colors, spacing, typography } from '@/lib/theme';
import { calendarErrorMessage } from './meta';
import { Notice, PrimaryButton, SecondaryButton } from './ui';

interface GoogleConnectProps {
  onConnected: (account: CalendarAccount) => void;
  /** The user closed the browser or declined; go back quietly. */
  onCancel: () => void;
}

function param(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? String(v) : null;
}

export function GoogleConnect({ onConnected, onCancel }: GoogleConnectProps) {
  const [phase, setPhase] = useState<'browser' | 'finishing' | 'error'>('browser');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    setPhase('browser');
    setError(null);
    try {
      const returnUrl = Linking.createURL('oauth/google');
      const { authUrl } = await api.startGoogleSignIn(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);
      if (!mounted.current) return;
      if (result.type !== 'success') {
        onCancel();
        return;
      }

      const { queryParams } = Linking.parse(result.url);
      const googleError = param(queryParams?.error);
      if (googleError === 'access_denied') {
        onCancel();
        return;
      }
      if (googleError) throw new Error(`Google didn’t finish the sign-in (${googleError}). Try again.`);
      const code = param(queryParams?.code);
      const state = param(queryParams?.state);
      if (!code || !state) throw new Error('Google didn’t send the sign-in back to the app. Try again.');
      // The mirror checks state too; this catches a redirect from some other sign-in.
      const sentState = param(Linking.parse(authUrl).queryParams?.state);
      if (sentState && sentState !== state) {
        throw new Error('That sign-in didn’t come from this request. Try again.');
      }

      setPhase('finishing');
      const account = await api.completeGoogleSignIn(code, state);
      if (mounted.current) onConnected(account);
    } catch (e) {
      if (!mounted.current) return;
      setError(calendarErrorMessage(e, 'Couldn’t sign in to Google.'));
      setPhase('error');
    }
  }, [onCancel, onConnected]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  if (phase === 'error') {
    return (
      <View style={styles.wrap}>
        <Notice tone="error" message={error ?? 'Couldn’t sign in to Google.'} />
        <PrimaryButton label="Try again" icon="logo-google" onPress={run} />
        <SecondaryButton label="Choose another calendar" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.centered} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.title}>{phase === 'finishing' ? 'Finishing sign-in…' : 'Continue in your browser'}</Text>
      <Text style={styles.body}>
        {phase === 'finishing'
          ? 'Your mirror is connecting to Google Calendar.'
          : 'Sign in to Google and allow SkyGlass to see your calendars. You’ll come back here when you’re done.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  centered: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  title: { ...typography.h3, color: colors.text, marginTop: spacing.md, textAlign: 'center' },
  body: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 300 },
});
