/**
 * Setup Complete Screen
 * Shown when all setup steps are finished
 *
 * Also offers the optional calendar step: connect a calendar or upload an
 * airline schedule. Both open the regular screens (add-calendar, schedule)
 * and come back here; the main button skips it. The mirror's setup status
 * doesn't track calendars, so nothing here can hold up setup.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import { goToDashboard } from '@/lib/navigation';
import { Button, Footer, Row, RowGroup, SectionLabel, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/lib/theme';

const tick = <Ionicons name="checkmark" size={20} color={colors.success} />;

export default function SetupCompleteScreen() {
  const insets = useSafeAreaInsets();
  const [isOnboarding, setIsOnboarding] = useState(false);
  /** Only list the license when the mirror actually uses one (not with licensing off). */
  const [licenseActive, setLicenseActive] = useState(false);
  /** Calendar accounts and uploaded flights on the mirror; null until known. */
  const [calendarCount, setCalendarCount] = useState<number | null>(null);
  const [flightCount, setFlightCount] = useState<number | null>(null);

  // Re-read on every focus so a calendar added from here shows as done.
  useFocusEffect(
    useCallback(() => {
      api
        .getCalendarAccounts()
        .then((accounts) => setCalendarCount(accounts.length))
        .catch(() => setCalendarCount(null));
      api
        .getFlightScheduleCount()
        .then(setFlightCount)
        .catch(() => setFlightCount(null));
    }, [])
  );

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Check if we're in the onboarding flow
    const checkOnboardingState = async () => {
      const state = await storage.getOnboardingState();
      if (state && state.phase !== 'complete') {
        setIsOnboarding(true);
      }
    };
    checkOnboardingState();
    api
      .getLicenseStatus()
      .then((license) => setLicenseActive(license.state === 'active'))
      .catch(() => setLicenseActive(false));
  }, []);

  const handleContinue = async () => {
    if (isOnboarding) {
      // Update onboarding state and go to template selection
      await storage.setOnboardingState({ phase: 'template' });
      router.replace('/onboarding/template');
    } else {
      // Normal flow - go to dashboard
      goToDashboard();
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 48 }]}>
        {/* Success icon */}
        <View style={styles.icon}>
          <Ionicons name="checkmark" size={32} color={colors.primary} />
        </View>

        {/* Success message */}
        <View style={styles.heading}>
          <Text style={styles.title}>You're all set</Text>
          <Text style={styles.subtitle}>Your SkyGlass is configured and ready to use</Text>
        </View>

        {/* Feature highlights */}
        <RowGroup>
          <Row leading={tick} title="Connected to WiFi" />
          {licenseActive && <Row leading={tick} title="License activated" />}
          <Row leading={tick} title="Home airport configured" />
          <Row leading={tick} title="Location set for sun times" />
          <Row leading={tick} title="Face registered" />
        </RowGroup>

        {/* Optional calendar step */}
        <View>
          <SectionLabel>Add your schedule (optional)</SectionLabel>
          <RowGroup>
            {calendarCount ? (
              <Row
                leading={tick}
                title="Calendars connected"
                caption={`${calendarCount} ${calendarCount === 1 ? 'account' : 'accounts'} · Manage or add another`}
                chevron
                onPress={() => router.push('/calendars')}
              />
            ) : (
              <Row
                icon="calendar-outline"
                title="Add a calendar"
                caption="Google, Outlook, iCloud or a calendar link"
                chevron
                onPress={() =>
                  router.push({ pathname: '/add-calendar', params: { from: 'setup' } })
                }
              />
            )}
            <Row
              leading={flightCount ? tick : undefined}
              icon={flightCount ? undefined : 'airplane-outline'}
              title={flightCount ? 'Airline schedule loaded' : 'Upload an airline schedule'}
              caption={
                flightCount
                  ? `${flightCount} ${flightCount === 1 ? 'flight' : 'flights'} · Replace it any time`
                  : 'An .xlsx roster from Files'
              }
              chevron
              onPress={() => router.push('/schedule')}
            />
          </RowGroup>
          <Text style={styles.optionalNote}>
            You can skip this and add calendars later in Settings, under Calendars.
          </Text>
        </View>

        {/* Next steps */}
        <View>
          <SectionLabel>What's next</SectionLabel>
          <Text style={styles.nextStepsText}>
            Your mirror will now activate when it detects your face, displaying METAR/TAF data, your
            schedule, and astronomical information. Use this app anytime to manage settings or check
            for updates.
          </Text>
        </View>
      </ScrollView>

      {/* Done button */}
      <Footer>
        <Button
          label={isOnboarding ? 'Choose layout' : 'Go to dashboard'}
          trailingIcon="arrow-forward"
          onPress={handleContinue}
        />
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
    gap: 28,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    gap: 10,
  },
  title: {
    ...typography.h1,
    fontSize: 36,
    fontWeight: '200',
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  optionalNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  nextStepsText: {
    ...typography.bodySmall,
    lineHeight: 21,
    color: colors.textSecondary,
  },
});
