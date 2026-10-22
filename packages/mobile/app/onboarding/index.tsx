/**
 * Welcome Screen
 * First screen of the onboarding flow
 */

import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/onboarding/profile');
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(0, 255, 136, 0.1)', 'transparent']}
        style={styles.gradient}
      />

      <View style={styles.content}>
        {/* Logo/Icon */}
        <View style={styles.logoContainer}>
          <View style={styles.logoOuter}>
            <View style={styles.logoInner}>
              <Ionicons name="sparkles" size={64} color={colors.primary} />
            </View>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>SkyGlass</Text>
        <Text style={styles.subtitle}>Your smart aviation companion</Text>

        {/* Features */}
        <View style={styles.features}>
          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name="airplane" size={20} color={colors.primary} />
            </View>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>Aviation Weather</Text>
              <Text style={styles.featureDesc}>METAR, TAF, and NOTAMs at a glance</Text>
            </View>
          </View>

          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name="person-circle" size={20} color={colors.primary} />
            </View>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>Face Detection</Text>
              <Text style={styles.featureDesc}>Personalized display for each user</Text>
            </View>
          </View>

          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name="grid" size={20} color={colors.primary} />
            </View>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>Customizable Layout</Text>
              <Text style={styles.featureDesc}>Arrange widgets your way</Text>
            </View>
          </View>
        </View>

        {/* What setup needs */}
        <View style={styles.prepNote}>
          <Ionicons name="key-outline" size={20} color={colors.accent} />
          <Text style={styles.prepText}>
            Setup covers WiFi, your license, location, home airport and face registration.{' '}
            <Text style={styles.prepEmphasis}>Have your license key ready</Text>: it's in your
            SkyGlass order confirmation email. Bought a kit? The license comes pre-installed.
          </Text>
        </View>
      </View>

      {/* Get Started Button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleGetStarted}
          activeOpacity={0.8}
        >
          <Text style={styles.startButtonText}>Get Started</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.background} />
        </TouchableOpacity>

        <Text style={styles.footerNote}>
          Takes about 5 minutes to set up
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  gradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 400,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  logoContainer: {
    marginBottom: spacing.xl,
  },
  logoOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInner: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.primary,
  },
  title: {
    ...typography.hero,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl * 1.5,
  },
  features: {
    alignSelf: 'stretch',
    gap: spacing.md,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  featureDesc: {
    ...typography.caption,
    color: colors.textMuted,
  },
  prepNote: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.accentMuted,
    borderRadius: borderRadius.md,
  },
  prepText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  prepEmphasis: {
    color: colors.text,
    fontWeight: '600',
  },
  footer: {
    padding: spacing.xl,
  },
  startButton: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  startButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
    fontSize: 17,
  },
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
