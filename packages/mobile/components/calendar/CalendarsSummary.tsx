/**
 * Compact view of the connected calendar accounts for the Schedule widget's
 * detail screen, with a way into the full Calendars screen.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Spinner, Text } from '@/components/ui';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, type CalendarAccount } from '@/lib/api';
import { colors, spacing, typography } from '@/lib/theme';
import { PROVIDER_META, accountStatus, calendarErrorMessage } from './meta';
import { Notice, PrimaryButton, SecondaryButton } from './ui';

export function CalendarsSummary() {
  const [accounts, setAccounts] = useState<CalendarAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await api.getCalendarAccounts());
      setError(null);
    } catch (e) {
      setError(calendarErrorMessage(e, 'Couldn’t load calendars.'));
    }
  }, []);

  // Refresh when coming back from the Calendars screen.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const manage = () => router.push('/calendars');

  if (error && !accounts) {
    return <Notice tone="error" message={error} action={{ label: 'Retry', onPress: load }} />;
  }
  if (!accounts) return <Spinner style={styles.loader} />;

  if (accounts.length === 0) {
    return (
      <View style={styles.wrap}>
        <View style={styles.nudge}>
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          <Text style={styles.nudgeText}>
            No calendars connected yet. Connect Google, Outlook, iCloud or a calendar link to show your events here.
            Imported crew schedules show up either way.
          </Text>
        </View>
        <PrimaryButton label="Connect a calendar" icon="add" onPress={() => router.push('/add-calendar')} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {accounts.map((a) => {
        const meta = PROVIDER_META[a.provider];
        const status = accountStatus(a);
        const shown = a.calendars.filter((c) => c.enabled).length;
        return (
          <View
            key={a.id}
            style={styles.row}
            accessible
            accessibilityLabel={`${a.label}, ${shown} calendar${shown === 1 ? '' : 's'} shown. ${status.label}`}
          >
            <Ionicons name={meta?.icon ?? 'calendar-outline'} size={18} color={colors.text} />
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>
                {a.label}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {shown} of {a.calendars.length} shown
              </Text>
            </View>
            <View style={styles.status}>
              <Ionicons name={status.icon} size={14} color={status.color} />
              <Text style={[styles.statusText, a.status !== 'ok' && { color: status.color }]} numberOfLines={1}>
                {status.label}
              </Text>
            </View>
          </View>
        );
      })}
      <SecondaryButton label="Manage calendars" icon="settings-outline" onPress={manage} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { paddingVertical: spacing.md },
  wrap: { gap: spacing.sm },
  nudge: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  nudgeText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingVertical: spacing.xs,
  },
  rowText: { flex: 1 },
  name: { ...typography.bodySmall, color: colors.text },
  sub: { ...typography.caption, color: colors.textMuted },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '45%' },
  statusText: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  button: { marginTop: spacing.xs },
});
