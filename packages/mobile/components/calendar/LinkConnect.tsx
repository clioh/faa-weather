/**
 * Subscribe to a calendar by link (iCal / ICS / webcal). Works with Google's
 * secret address, iCloud public calendars, Outlook published calendars and
 * the calendar feeds most crew scheduling apps offer.
 */

import { useRef, useState } from 'react';
import { LayoutAnimation, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, type CalendarAccount } from '@/lib/api';
import { colors, spacing, typography } from '@/lib/theme';
import { calendarErrorMessage } from './meta';
import { Field, Notice, PrimaryButton } from './ui';

const HELP: Array<{ title: string; text: string }> = [
  {
    title: 'Google Calendar',
    text: 'On a computer, open Google Calendar settings, pick the calendar, and copy “Secret address in iCal format”.',
  },
  {
    title: 'iCloud',
    text: 'In the Calendar app, tap ⓘ next to the calendar, turn on Public Calendar, then Share Link.',
  },
  {
    title: 'Outlook',
    text: 'In Outlook on the web, go to Settings › Calendar › Shared calendars › Publish a calendar, and copy the ICS link.',
  },
  {
    title: 'Crew scheduling apps',
    text: 'Look for “Subscribe”, “iCal”, “webcal” or “Calendar feed” in the app’s export or sync settings.',
  },
];

interface LinkConnectProps {
  onConnected: (account: CalendarAccount) => void;
}

export function LinkConnect({ onConnected }: LinkConnectProps) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const labelRef = useRef<TextInput>(null);

  const submit = async () => {
    if (busy) return;
    const link = url.trim();
    if (!link) {
      setUrlError('Paste the calendar link.');
      return;
    }
    if (!/^(webcals?|https?):\/\//i.test(link)) {
      setUrlError('Paste the full link, starting with webcal:// or https://');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const account = await api.addCalendarLink(link, label.trim() || undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onConnected(account);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(calendarErrorMessage(e, 'Couldn’t read a calendar from that link.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>
        Paste a calendar link to show its events. The mirror checks it for changes on its own.
      </Text>

      <Field
        label="Calendar link"
        value={url}
        onChangeText={(t) => {
          setUrl(t);
          if (urlError) setUrlError(null);
        }}
        error={urlError}
        placeholder="webcal://… or https://….ics"
        mono
        inputTextStyle={styles.linkInput}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="URL"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => labelRef.current?.focus()}
      />

      <Field
        label="Name (optional)"
        value={label}
        onChangeText={setLabel}
        placeholder="Roster, Family, Holidays…"
        autoCapitalize="words"
        maxLength={60}
        returnKeyType="done"
        inputRef={labelRef}
        onSubmitEditing={submit}
      />

      <View style={styles.help}>
        <TouchableOpacity
          style={styles.helpToggle}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setHelpOpen((o) => !o);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: helpOpen }}
          accessibilityLabel="Where to find a calendar link"
        >
          <Ionicons name="help-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.helpToggleText}>Where do I find a calendar link?</Text>
          <Ionicons
            name={helpOpen ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.chevron}
          />
        </TouchableOpacity>
        {helpOpen && (
          <View style={styles.helpList}>
            {HELP.map((h) => (
              <View key={h.title} style={styles.helpItem}>
                <Text style={styles.helpTitle}>{h.title}</Text>
                <Text style={styles.helpText}>{h.text}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {helpOpen && (
        <Text style={styles.helpNote}>
          Anyone with a private link can see that calendar, so keep it to yourself. It’s stored only
          on your mirror.
        </Text>
      )}

      {error ? <Notice tone="error" message={error} /> : null}

      <PrimaryButton label="Add calendar" onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  lead: { ...typography.bodySmall, color: colors.textSecondary },
  linkInput: { fontSize: 14 },
  help: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  helpToggle: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14 },
  helpToggleText: { fontSize: 15, color: colors.text, flex: 1 },
  helpList: { paddingLeft: 32, paddingBottom: spacing.sm, gap: spacing.sm },
  helpItem: { gap: 2 },
  helpTitle: { fontSize: 13, color: colors.text },
  helpText: { ...typography.caption, color: colors.textMuted },
  helpNote: { ...typography.caption, color: colors.textMuted },
});
