/**
 * Add a calendar
 *
 * Pick a provider, connect it in the way that provider needs (browser
 * sign-in, a device code, a password or a link), then choose which of its
 * calendars the mirror shows. Opened with ?provider=…&reconnect=<id> from a
 * "Reconnect" button, it skips the picker and replaces that account.
 * Opened with ?from=setup (setup complete screen), Done returns there
 * instead of to Calendars.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  api,
  type AccountCalendar,
  type CalendarAccount,
  type CalendarProvider,
  type CalendarProviderId,
} from '@/lib/api';
import { goBack } from '@/lib/navigation';
import { colors, spacing } from '@/lib/theme';
import { ScreenHeader, KeyboardAvoidingScreen } from '@/components';
import { ProviderPicker } from '@/components/calendar/ProviderPicker';
import { GoogleConnect } from '@/components/calendar/GoogleConnect';
import { MicrosoftConnect } from '@/components/calendar/MicrosoftConnect';
import { PasswordConnect } from '@/components/calendar/PasswordConnect';
import { LinkConnect } from '@/components/calendar/LinkConnect';
import { ChooseCalendars } from '@/components/calendar/ChooseCalendars';
import { PROVIDER_META, calendarErrorMessage } from '@/components/calendar/meta';
import { Notice } from '@/components/calendar/ui';

const PROVIDER_IDS: CalendarProviderId[] = ['google', 'microsoft', 'icloud', 'caldav', 'ics'];

type Step =
  | { kind: 'pick' }
  | { kind: 'connect'; provider: CalendarProviderId }
  | { kind: 'choose'; account: CalendarAccount; initialCalendars?: AccountCalendar[] };

function asProvider(value: string | undefined): CalendarProviderId | null {
  return value && (PROVIDER_IDS as string[]).includes(value) ? (value as CalendarProviderId) : null;
}

export default function AddCalendarScreen() {
  const params = useLocalSearchParams<{ provider?: string; reconnect?: string; username?: string; from?: string }>();
  const fixedProvider = asProvider(params.provider);
  const reconnectId = params.reconnect || null;

  const [step, setStep] = useState<Step>(fixedProvider ? { kind: 'connect', provider: fixedProvider } : { kind: 'pick' });
  const [providers, setProviders] = useState<CalendarProvider[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const previous = useRef<CalendarAccount | null>(null);

  const loadProviders = useCallback(async () => {
    setProvidersError(null);
    try {
      setProviders(await api.getCalendarProviders());
    } catch (e) {
      setProvidersError(calendarErrorMessage(e, 'Couldn’t reach the mirror.'));
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // When reconnecting, remember the old account's calendar choices so they carry over.
  useEffect(() => {
    if (!reconnectId) return;
    api
      .getCalendarAccounts()
      .then((list) => {
        previous.current = list.find((a) => a.id === reconnectId) ?? null;
      })
      .catch(() => {});
  }, [reconnectId]);

  const toPicker = useCallback(() => {
    if (fixedProvider) goBack('/calendars');
    else setStep({ kind: 'pick' });
  }, [fixedProvider]);

  const onConnected = useCallback(
    async (account: CalendarAccount) => {
      let initialCalendars: AccountCalendar[] | undefined;
      const old = previous.current;
      if (reconnectId && account.id !== reconnectId) {
        // The mirror made a new account rather than updating the old one:
        // keep the user's choices and drop the stale copy.
        if (old) {
          initialCalendars = account.calendars.map((c) => {
            const before = old.calendars.find((o) => o.id === c.id);
            return before ? { ...c, enabled: before.enabled, color: before.color } : c;
          });
        }
        api.deleteCalendarAccount(reconnectId).catch(() => {});
      }
      setStep({ kind: 'choose', account, initialCalendars });
    },
    [reconnectId]
  );

  const finish = () => (params.from === 'setup' ? goBack('/calendars') : router.dismissTo('/calendars'));

  const providerName = (id: CalendarProviderId) =>
    providers?.find((p) => p.id === id)?.name || PROVIDER_META[id]?.name || 'Calendar';

  const fixedUnavailable =
    step.kind === 'connect' ? providers?.find((p) => p.id === step.provider && !p.available) : undefined;

  let title = 'Add a calendar';
  let content;
  if (step.kind === 'pick') {
    content = (
      <ProviderPicker
        providers={providers}
        error={providersError}
        onRetry={loadProviders}
        onPick={(p) => setStep({ kind: 'connect', provider: p.id })}
      />
    );
  } else if (step.kind === 'choose') {
    title = 'Choose calendars';
    content = (
      <ChooseCalendars
        account={step.account}
        initialCalendars={step.initialCalendars}
        reconnected={!!reconnectId}
        onDone={finish}
      />
    );
  } else {
    title = reconnectId ? `Reconnect ${providerName(step.provider)}` : providerName(step.provider);
    if (fixedUnavailable) {
      content = (
        <Notice tone="warning" message={fixedUnavailable.reason ?? `${providerName(step.provider)} isn’t available on this mirror.`} />
      );
    } else if (step.provider === 'google') {
      content = <GoogleConnect onConnected={onConnected} onCancel={toPicker} />;
    } else if (step.provider === 'microsoft') {
      content = <MicrosoftConnect onConnected={onConnected} onCancel={toPicker} />;
    } else if (step.provider === 'icloud' || step.provider === 'caldav') {
      content = (
        <PasswordConnect
          provider={step.provider}
          initialUsername={reconnectId ? params.username : undefined}
          onConnected={onConnected}
        />
      );
    } else {
      content = <LinkConnect onConnected={onConnected} />;
    }
  }

  const onBack = () => {
    if (step.kind === 'connect' && !fixedProvider) setStep({ kind: 'pick' });
    else if (step.kind === 'choose') finish();
    else goBack('/calendars');
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={title}
        onLeftPress={onBack}
        backLabel={step.kind === 'choose' && params.from !== 'setup' ? 'Calendars' : 'Back'}
      />
      <KeyboardAvoidingScreen>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Keyed so going back to the picker and in again starts each flow fresh. */}
          <View key={step.kind === 'connect' ? step.provider : step.kind}>{content}</View>
        </ScrollView>
      </KeyboardAvoidingScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
});
