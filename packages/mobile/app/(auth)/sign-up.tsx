/**
 * Sign Up Screen
 * Clerk-powered account creation
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
import { useSignUp } from '@clerk/expo/legacy';
import { KeyboardAvoidingScreen, HEADER_HIT_SLOP } from '@/components';
import { Button, Field, IconCircle, Text } from '@/components/ui';
import { goToDashboard } from '@/lib/navigation';
import { colors, fonts, spacing, typography } from '@/lib/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp, setActive, isLoaded } = useSignUp();
  const { startSSOFlow } = useSSO();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  const handleSignUp = useCallback(async () => {
    if (!isLoaded || !signUp) return;

    if (!name.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    try {
      await signUp.create({
        firstName: name.trim().split(' ')[0],
        lastName: name.trim().split(' ').slice(1).join(' ') || undefined,
        emailAddress: email.trim(),
        password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sign up failed';
      Alert.alert('Sign Up Failed', message);
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, signUp, name, email, password]);

  const handleVerification = useCallback(async () => {
    if (!isLoaded || !signUp) return;

    setIsLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        goToDashboard();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      Alert.alert('Verification Failed', message);
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, signUp, verificationCode, setActive, router]);

  const handleOAuthSignUp = useCallback(
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
        const message = error instanceof Error ? error.message : 'OAuth sign up failed';
        Alert.alert('Sign Up Failed', message);
      } finally {
        setOauthLoading(null);
      }
    },
    [startSSOFlow, setActive, router]
  );

  // Verification Screen
  if (pendingVerification) {
    return (
      <KeyboardAvoidingScreen style={styles.container}>
        <ScrollView contentContainerStyle={[styles.content, styles.verifyContent]} keyboardShouldPersistTaps="handled">
          <IconCircle icon="mail-outline" />
          <View style={styles.heading}>
            <Text style={styles.title}>Verify Your Email</Text>
            <Text style={styles.subtitle}>
              We sent a verification code to <Text style={styles.emphasis}>{email}</Text>
            </Text>
          </View>

          <Field
            label="Verification code"
            placeholder="Enter verification code"
            value={verificationCode}
            onChangeText={setVerificationCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            mono
            inputTextStyle={styles.codeInput}
          />

          <Button label="Verify Email" onPress={handleVerification} loading={isLoading} />

          <TouchableOpacity
            style={styles.resendButton}
            hitSlop={HEADER_HIT_SLOP}
            onPress={() => signUp?.prepareEmailAddressVerification({ strategy: 'email_code' })}
            accessibilityRole="button"
          >
            <Text style={styles.resendText}>
              <Text style={styles.resendPrompt}>Didn't receive the code?</Text> Resend
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingScreen>
    );
  }

  // Sign Up Form
  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.heading}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Sign up to sync your mirrors across devices</Text>
        </View>

        {/* Sign Up Form */}
        <View style={styles.form}>
          <Field
            label="Full name"
            placeholder="Full Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
          />
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
            placeholder="Password (min 8 characters)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            revealable
            autoComplete="new-password"
          />
        </View>

        <Button label="Create Account" onPress={handleSignUp} loading={isLoading} />

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
            onPress={() => handleOAuthSignUp('google')}
            disabled={oauthLoading !== null && oauthLoading !== 'google'}
            loading={oauthLoading === 'google'}
          />

          {Platform.OS === 'ios' && (
            <Button
              label="Apple"
              variant="secondary"
              icon="logo-apple"
              style={styles.oauthButton}
              onPress={() => handleOAuthSignUp('apple')}
              disabled={oauthLoading !== null && oauthLoading !== 'apple'}
              loading={oauthLoading === 'apple'}
            />
          )}
        </View>

        <View style={styles.spacer} />

        {/* Sign In Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity hitSlop={HEADER_HIT_SLOP} style={styles.footerLinkButton}>
              <Text style={styles.footerLink}>Sign In</Text>
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
    gap: 22,
  },
  verifyContent: {
    paddingTop: 40,
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
  emphasis: {
    color: colors.text,
  },
  form: {
    gap: 12,
  },
  codeInput: {
    fontFamily: fonts.mono,
    fontSize: 20,
    letterSpacing: 4,
  },
  resendButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resendText: {
    fontSize: 14,
    color: colors.primary,
  },
  resendPrompt: {
    color: colors.textSecondary,
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
