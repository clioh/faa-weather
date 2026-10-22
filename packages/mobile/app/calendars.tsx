/**
 * Calendars
 *
 * The calendar accounts the mirror syncs for the Schedule widget. Every change
 * here (show/hide a calendar, colour, name, remove) is sent to the mirror right
 * away; sign-in details live only on the mirror.
 */

import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, type AccountCalendar, type CalendarAccount } from '@/lib/api';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { ScreenHeader, HeaderTextButton, ErrorToast, type ToastType } from '@/components';
import { AccountCard } from '@/components/calendar/AccountCard';
import { calendarErrorMessage } from '@/components/calendar/meta';
import { Field, PrimaryButton, SecondaryButton, Sheet, errorMessage } from '@/components/calendar/ui';

export default function CalendarsScreen() {
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const [renaming, setRenaming] = useState<CalendarAccount | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [removing, setRemoving] = useState<CalendarAccount | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await api.getCalendarAccounts());
      setLoadError(null);
      loadedOnce.current = true;
    } catch (e) {
      // Keep showing the last good list on a refresh that fails.
      if (!loadedOnce.current) setLoadError(calendarErrorMessage(e, 'Couldn’t reach the mirror.'));
      else setToast({ message: calendarErrorMessage(e, 'Couldn’t refresh calendars.'), type: 'error' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload on every visit so an account added in the add flow shows up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const replaceAccount = (next: CalendarAccount) =>
    setAccounts((prev) => prev.map((a) => (a.id === next.id ? next : a)));

  const patchCalendar = async (account: CalendarAccount, calendar: AccountCalendar, change: Partial<AccountCalendar>) => {
    const before = account;
    replaceAccount({
      ...account,
      calendars: account.calendars.map((c) => (c.id === calendar.id ? { ...c, ...change } : c)),
    });
    try {
      // Keep the optimistic state: a newer toggle may already be in flight.
      await api.updateCalendarAccount(account.id, { calendars: [{ id: calendar.id, ...change }] });
    } catch (e) {
      replaceAccount(before);
      setToast({ message: errorMessage(e, 'Couldn’t save that change.'), type: 'error' });
    }
  };

  const sync = async (account: CalendarAccount) => {
    if (syncing[account.id]) return;
    setSyncing((s) => ({ ...s, [account.id]: true }));
    try {
      const updated = await api.syncCalendarAccount(account.id);
      replaceAccount(updated);
      if (updated.status === 'ok') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setToast({ message: `${updated.label} is up to date`, type: 'success' });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (e) {
      setToast({ message: errorMessage(e, 'Couldn’t sync.'), type: 'error' });
    } finally {
      setSyncing((s) => ({ ...s, [account.id]: false }));
    }
  };

  const openRename = (account: CalendarAccount) => {
    setNameDraft(account.label);
    setNameError(null);
    setRenaming(account);
  };

  const saveName = async () => {
    if (!renaming || savingName) return;
    const label = nameDraft.trim();
    if (!label) {
      setNameError('Give the account a name.');
      return;
    }
    if (label === renaming.label) {
      setRenaming(null);
      return;
    }
    setSavingName(true);
    try {
      replaceAccount(await api.updateCalendarAccount(renaming.id, { label }));
      Haptics.selectionAsync();
      setRenaming(null);
    } catch (e) {
      // Leave the sheet open with the typed name so nothing is lost.
      setNameError(errorMessage(e, 'Couldn’t rename the account.'));
    } finally {
      setSavingName(false);
    }
  };

  const openRemove = (account: CalendarAccount) => {
    setRemoveError(null);
    setRemoving(account);
  };

  const confirmRemove = async () => {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    try {
      await api.deleteCalendarAccount(removing.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAccounts((prev) => prev.filter((a) => a.id !== removing.id));
      setToast({ message: `${removing.label} removed`, type: 'success' });
      setRemoving(null);
    } catch (e) {
      setRemoveError(errorMessage(e, 'Couldn’t remove the account.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const addCalendar = () => router.push('/add-calendar');

  const reconnect = (account: CalendarAccount) =>
    router.push({
      pathname: '/add-calendar',
      params: { provider: account.provider, reconnect: account.id, username: account.email ?? '' },
    });

  const header = (
    <ScreenHeader
      title="Calendars"
      fallbackHref="/settings"
      right={accounts.length > 0 ? <HeaderTextButton label="Add" onPress={addCalendar} /> : undefined}
    />
  );

  let body;
  if (loading) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  } else if (loadError) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Couldn’t load calendars</Text>
        <Text style={styles.emptyText}>{loadError}</Text>
        <SecondaryButton
          label="Try again"
          onPress={() => {
            setLoading(true);
            load();
          }}
          style={styles.emptyButton}
        />
      </View>
    );
  } else if (accounts.length === 0) {
    body = (
      <ScrollView
        contentContainerStyle={styles.emptyScroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.emptyIcon}>
          <Ionicons name="calendar-outline" size={36} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>Put your day on the mirror</Text>
        <Text style={styles.emptyText}>
          Connect Google, Outlook, iCloud or a calendar link and the Schedule widget shows what’s coming up, next to the
          weather. Your mirror keeps the sign-in and refreshes events on its own; you choose which calendars it shows.
        </Text>
        <PrimaryButton label="Add a calendar" icon="add" onPress={addCalendar} style={styles.emptyButton} />
      </ScrollView>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.intro}>
          Turn calendars on to show their events in the Schedule widget. Tap a color to change it.
        </Text>
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            syncing={!!syncing[account.id]}
            onToggle={(cal, enabled) => patchCalendar(account, cal, { enabled })}
            onColor={(cal, color) => patchCalendar(account, cal, { color })}
            onSync={() => sync(account)}
            onRename={() => openRename(account)}
            onRemove={() => openRemove(account)}
            onReconnect={() => reconnect(account)}
          />
        ))}
        <SecondaryButton label="Add another calendar" icon="add" onPress={addCalendar} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      {body}

      <Sheet
        visible={renaming !== null}
        title="Rename account"
        body="This name is only used in the app, to tell your accounts apart."
        onClose={() => !savingName && setRenaming(null)}
      >
        <Field
          label="Name"
          value={nameDraft}
          onChangeText={(t) => {
            setNameDraft(t);
            if (nameError) setNameError(null);
          }}
          onSubmitEditing={saveName}
          error={nameError}
          placeholder="Work, Personal, Crew…"
          autoFocus
          maxLength={60}
          returnKeyType="done"
          autoCapitalize="words"
        />
        <PrimaryButton label="Save" onPress={saveName} loading={savingName} style={styles.sheetButton} />
        <SecondaryButton label="Cancel" onPress={() => setRenaming(null)} disabled={savingName} />
      </Sheet>

      <Sheet
        visible={removing !== null}
        title={removing ? `Remove ${removing.label}?` : 'Remove account?'}
        body="The mirror stops showing its events and forgets its sign-in. You can connect it again any time."
        onClose={() => !removeBusy && setRemoving(null)}
      >
        {removeError ? <Text style={styles.sheetError}>{removeError}</Text> : null}
        <SecondaryButton
          label="Remove"
          tone="danger"
          onPress={confirmRemove}
          loading={removeBusy}
          accessibilityLabel={removing ? `Confirm remove ${removing.label}` : 'Confirm remove'}
        />
        <SecondaryButton label="Keep it" onPress={() => setRemoving(null)} disabled={removeBusy} />
      </Sheet>

      <ErrorToast
        visible={toast !== null}
        message={toast?.message ?? ''}
        type={toast?.type ?? 'info'}
        onDismiss={() => setToast(null)}
        dismissAfter={3000}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  intro: { ...typography.bodySmall, color: colors.textSecondary },
  emptyScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: { ...typography.h3, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  emptyButton: { marginTop: spacing.md, alignSelf: 'stretch' },
  sheetButton: { marginTop: spacing.sm },
  sheetError: { ...typography.bodySmall, color: colors.error },
});
