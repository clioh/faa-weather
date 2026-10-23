/**
 * Welcome Screen
 * First screen of the onboarding flow
 */

import { View, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Footer, LogoMark, Notice, Row, RowGroup, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/lib/theme';

const FEATURES = [
  { icon: 'cloudy-outline', title: 'Aviation weather', desc: 'METAR, TAF, and NOTAMs at a glance' },
  { icon: 'person-outline', title: 'Face detection', desc: 'Personalized display for each user' },
  { icon: 'grid-outline', title: 'Customizable layout', desc: 'Arrange widgets your way' },
] as const;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/onboarding/profile');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 48 }]}>
        {/* Logo/Icon */}
        <View style={styles.brand}>
          <LogoMark />
          <Text style={styles.title}>SkyGlass</Text>
          <Text style={styles.subtitle}>Your smart aviation companion</Text>
        </View>

        {/* Features */}
        <RowGroup>
          {FEATURES.map((f) => (
            <Row
              key={f.title}
              leading={<Ionicons name={f.icon} size={22} color={colors.primary} />}
              title={f.title}
              caption={f.desc}
              style={styles.feature}
            />
          ))}
        </RowGroup>

        {/* What setup needs */}
        <Notice
          tone="info"
          icon="key-outline"
          message={
            <>
              Setup covers WiFi, your license, location, home airport and face registration.{' '}
              <Text style={styles.prepEmphasis}>Have your license key ready</Text>: it's in your
              SkyGlass order confirmation email. Bought a kit? The license comes pre-installed.
            </>
          }
        />
      </ScrollView>

      {/* Get Started Button */}
      <Footer>
        <Button label="Get started" trailingIcon="arrow-forward" onPress={handleGetStarted} />
        <Text style={styles.footerNote}>Takes about 5 minutes to set up</Text>
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
    paddingBottom: spacing.lg,
    gap: 36,
  },
  brand: {
    gap: 18,
  },
  title: {
    fontSize: 44,
    fontWeight: '200',
    letterSpacing: -1.5,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    fontSize: 17,
    color: colors.textSecondary,
  },
  feature: {
    minHeight: 64,
    gap: spacing.md,
  },
  prepEmphasis: {
    fontWeight: '600',
  },
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: spacing.xs,
  },
});
