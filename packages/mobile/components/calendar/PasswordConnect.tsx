/**
 * iCloud and other CalDAV servers: the user types a username and password
 * once and the mirror keeps them. For iCloud that has to be an app-specific
 * password, so the form explains how to make one and steers iOS away from
 * offering the real Apple ID password.
 */

import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { api, type CalendarAccount } from '@/lib/api';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { calendarErrorMessage } from './meta';
import { Field, Notice, PrimaryButton, SecondaryButton } from './ui';

const APPLE_ACCOUNT_URL = 'https://account.apple.com';

interface PasswordConnectProps {
  provider: 'icloud' | 'caldav';
  /** Pre-filled when reconnecting an account. */
  initialUsername?: string;
  onConnected: (account: CalendarAccount) => void;
}

function normaliseServerUrl(raw: string): string {
  const url = raw.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

export function PasswordConnect({ provider, initialUsername, onConnected }: PasswordConnectProps) {
  const icloud = provider === 'icloud';
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState(initialUsername ?? '');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const labelRef = useRef<TextInput>(null);
  const [fieldErrors, setFieldErrors] = useState<{ serverUrl?: string; username?: string; password?: string }>({});

  const submit = async () => {
    if (busy) return;
    const errs: typeof fieldErrors = {};
    if (!icloud && !serverUrl.trim()) errs.serverUrl = 'Enter your server’s address.';
    if (!username.trim()) errs.username = icloud ? 'Enter your Apple ID.' : 'Enter your username.';
    else if (icloud && !username.includes('@')) errs.username = 'Your Apple ID is an email address.';
    if (!password) errs.password = icloud ? 'Paste your app-specific password.' : 'Enter your password.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      const account = await api.addCalDavAccount({
        provider,
        ...(icloud ? {} : { serverUrl: normaliseServerUrl(serverUrl) }),
        username: username.trim(),
        password: icloud ? password.trim() : password,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onConnected(account);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Everything typed stays in the form so the user can fix one field.
      setError(calendarErrorMessage(e, 'Couldn’t connect. Check the details and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const clear = (key: keyof typeof fieldErrors) => {
    if (fieldErrors[key]) setFieldErrors((f) => ({ ...f, [key]: undefined }));
  };

  return (
    <View style={styles.wrap}>
      {icloud ? (
        <View style={styles.explainer}>
          <Text style={styles.explainerTitle}>You’ll need an app-specific password</Text>
          <Text style={styles.explainerText}>
            This is not your Apple ID password. It’s a separate password Apple creates just for SkyGlass, and you can
            revoke it at any time.
          </Text>
          <Text style={styles.explainerStep}>1. Sign in at account.apple.com</Text>
          <Text style={styles.explainerStep}>2. Open Sign-In and Security, then App-Specific Passwords</Text>
          <Text style={styles.explainerStep}>3. Create one named “SkyGlass” and paste it below</Text>
          <SecondaryButton
            label="Open account.apple.com"
            icon="open-outline"
            onPress={() => WebBrowser.openBrowserAsync(APPLE_ACCOUNT_URL).catch(() => {})}
            style={styles.explainerButton}
          />
        </View>
      ) : (
        <Text style={styles.lead}>
          Use the CalDAV details from your calendar provider, such as Nextcloud, Fastmail or your own server.
        </Text>
      )}

      {!icloud && (
        <Field
          label="Server address"
          value={serverUrl}
          onChangeText={(t) => {
            setServerUrl(t);
            clear('serverUrl');
          }}
          error={fieldErrors.serverUrl}
          placeholder="https://cloud.example.com/remote.php/dav"
          help="Local addresses on your home network work too."
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="URL"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => usernameRef.current?.focus()}
        />
      )}

      <Field
        label={icloud ? 'Apple ID' : 'Username'}
        value={username}
        onChangeText={(t) => {
          setUsername(t);
          clear('username');
        }}
        error={fieldErrors.username}
        placeholder={icloud ? 'name@icloud.com' : 'Username'}
        keyboardType={icloud ? 'email-address' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        // Not "username": that pairs the next field with the saved Apple ID password.
        textContentType="none"
        returnKeyType="next"
        submitBehavior="submit"
        inputRef={usernameRef}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />

      <Field
        label={icloud ? 'App-specific password' : 'Password'}
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          clear('password');
        }}
        error={fieldErrors.password}
        placeholder={icloud ? 'xxxx-xxxx-xxxx-xxxx' : 'Password'}
        secureTextEntry
        revealable
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        returnKeyType="next"
        submitBehavior="submit"
        inputRef={passwordRef}
        onSubmitEditing={() => labelRef.current?.focus()}
      />

      <Field
        label="Name (optional)"
        value={label}
        onChangeText={setLabel}
        placeholder={icloud ? 'iCloud' : 'Work, Personal…'}
        help="Shown in the app to tell accounts apart."
        autoCapitalize="words"
        maxLength={60}
        returnKeyType="done"
        inputRef={labelRef}
        onSubmitEditing={submit}
      />

      {error ? <Notice tone="error" message={error} /> : null}

      <PrimaryButton label={icloud ? 'Connect iCloud' : 'Connect'} onPress={submit} loading={busy} />
      {busy ? <Text style={styles.busy}>Checking with {icloud ? 'iCloud' : 'your server'}…</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  lead: { ...typography.bodySmall, color: colors.textSecondary },
  explainer: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  explainerTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  explainerText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xs },
  explainerStep: { ...typography.bodySmall, color: colors.textSecondary },
  explainerButton: { marginTop: spacing.sm },
  busy: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
