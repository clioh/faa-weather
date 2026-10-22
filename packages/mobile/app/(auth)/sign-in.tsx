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
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { useRouter, Link } from 'expo-router';
import { useSSO } from '@clerk/expo';
import { useSignIn } from '@clerk/expo/legacy';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingScreen, HEADER_HIT_SLOP } from '@/components';
import { goToDashboard } from '@/lib/navigation';
import { colors } from '@/lib/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      <View style={styles.content}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to sync your mirrors across devices</Text>

        {/* Email/Password Form */}
        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="password"
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
              hitSlop={HEADER_HIT_SLOP}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleEmailSignIn}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* OAuth Buttons */}
        <View style={styles.oauthContainer}>
          <TouchableOpacity
            style={[styles.oauthButton]}
            onPress={() => handleOAuthSignIn('google')}
            disabled={oauthLoading !== null}
          >
            {oauthLoading === 'google' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color={colors.text} />
                <Text style={styles.oauthButtonText}>Google</Text>
              </>
            )}
          </TouchableOpacity>

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.oauthButton]}
              onPress={() => handleOAuthSignIn('apple')}
              disabled={oauthLoading !== null}
            >
              {oauthLoading === 'apple' ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={20} color={colors.text} />
                  <Text style={styles.oauthButtonText}>Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Sign Up Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <TouchableOpacity hitSlop={HEADER_HIT_SLOP}>
              <Text style={styles.footerLink}>Sign Up</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
    textAlign: 'center',
  },
  form: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 50,
    color: colors.text,
    fontSize: 16,
  },
  eyeButton: {
    padding: 8,
  },
  button: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textSecondary,
    marginHorizontal: 16,
    fontSize: 14,
  },
  oauthContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  oauthButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  oauthButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});
