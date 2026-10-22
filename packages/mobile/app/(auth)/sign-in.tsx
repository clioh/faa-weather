/**
 * Sign In Screen
 * Clerk-powered authentication for existing users
 */

import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { useSSO } from '@clerk/expo';
import { useSignIn } from '@clerk/expo/legacy';
import { KeyboardAvoidingScreen, HEADER_HIT_SLOP } from '@/components';
import { Button, Field, Text } from '@/components/ui';
import { goToDashboard } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);

  const handleEmailSignIn = useCallback(async () => {
    if (!isLoaded || !signIn) return;
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter your email and password');
      return;
    }

    setIsLoading(true);
    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        goToDashboard();
      } else {
        console.log('Sign in requires additional steps:', result.status);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sign in failed';
      Alert.alert('Sign In Failed', message);
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, signIn, email, password, setActive, router]);

  const handleOAuthSignIn = useCallback(
    async (provider: 'google' | 'apple') => {
      setOauthLoading(provider);

      try {
        const result = await startSSOFlow({
          strategy: provider === 'google' ? 'oauth_google' : 'oauth_apple',
        });
        if (result.createdSessionId) {
          await setActive!({ session: result.createdSessionId });
          goToDashboard();
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'OAuth sign in failed';
        Alert.alert('Sign In Failed', message);
      } finally {
        setOauthLoading(null);
      }
    },
    [startSSOFlow, setActive, router]
  );

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to sync your mirrors across devices</Text>
        </View>

        {/* Email/Password Form */}
        <View style={styles.form}>
          <Field
            label="Email"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Field
            label="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            revealable
            autoComplete="password"
          />
        </View>

        <Button label="Sign In" onPress={handleEmailSignIn} loading={isLoading} />

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* OAuth Buttons */}
        <View style={styles.oauthContainer}>
          <Button
            label="Google"
            variant="secondary"
            icon="logo-google"
            style={styles.oauthButton}
            onPress={() => handleOAuthSignIn('google')}
            disabled={oauthLoading !== null && oauthLoading !== 'google'}
            loading={oauthLoading === 'google'}
          />

          {Platform.OS === 'ios' && (
            <Button
              label="Apple"
              variant="secondary"
              icon="logo-apple"
              style={styles.oauthButton}
              onPress={() => handleOAuthSignIn('apple')}
              disabled={oauthLoading !== null && oauthLoading !== 'apple'}
              loading={oauthLoading === 'apple'}
            />
          )}
        </View>

        <View style={styles.spacer} />

        {/* Sign Up Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <TouchableOpacity hitSlop={HEADER_HIT_SLOP} style={styles.footerLinkButton}>
              <Text style={styles.footerLink}>Sign Up</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 28,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
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
  form: {
    gap: 12,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hairline,
  },
  dividerText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  oauthContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  oauthButton: {
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  footerLinkButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  footerLink: {
    fontSize: 14,
    color: colors.primary,
  },
});
