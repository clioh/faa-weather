/**
 * Last step after connecting: name the account and pick which of its
 * calendars the mirror shows. The account is already saved on the mirror
 * with sensible defaults, so Done only sends what the user changed.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, type AccountCalendar, type CalendarAccount } from '@/lib/api';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { CalendarToggleList } from './CalendarToggleList';
import { PROVIDER_META, accountStatus } from './meta';
import { Field, Notice, PrimaryButton, errorMessage } from './ui';

interface ChooseCalendarsProps {
  account: CalendarAccount;
  /** Calendars start with these choices (carried over when reconnecting). */
  initialCalendars?: AccountCalendar[];
  reconnected?: boolean;
  onDone: () => void;
}

export function ChooseCalendars({ account, initialCalendars, reconnected, onDone }: ChooseCalendarsProps) {
  const [label, setLabel] = useState(account.label);
  const [calendars, setCalendars] = useState<AccountCalendar[]>(initialCalendars ?? account.calendars);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = PROVIDER_META[account.provider];
  const status = accountStatus(account);

  const update = (id: string, change: Partial<AccountCalendar>) =>
    setCalendars((prev) => prev.map((c) => (c.id === id ? { ...c, ...change } : c)));

  const done = async () => {
    if (saving) return;
    const name = label.trim();
    const changed = calendars.filter((c) => {
      const orig = account.calendars.find((o) => o.id === c.id);
      return !orig || orig.enabled !== c.enabled || orig.color.toLowerCase() !== c.color.toLowerCase();
    });
    const labelChanged = !!name && name !== account.label;
    if (!labelChanged && changed.length === 0) {
      onDone();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateCalendarAccount(account.id, {
        ...(labelChanged ? { label: name } : {}),
        ...(changed.length ? { calendars: changed.map(({ id, enabled, color }) => ({ id, enabled, color })) } : {}),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t save your choices.'));
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = calendars.filter((c) => c.enabled).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.success} accessibilityRole="summary">
        <View style={[styles.icon, { backgroundColor: `${meta?.tint ?? colors.text}1f` }]}>
          <Ionicons name={meta?.icon ?? 'calendar-outline'} size={22} color={meta?.tint ?? colors.text} />
        </View>
        <View style={styles.flex}>
          <View style={styles.successLine}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.successTitle}>{reconnected ? 'Reconnected' : 'Connected'}</Text>
          </View>
          <Text style={styles.successSub} numberOfLines={1}>
            {account.email ?? meta?.name ?? account.label}
          </Text>
        </View>
      </View>

      {account.status !== 'ok' && status.detail ? (
        <Notice tone={account.status === 'reauth' ? 'error' : 'warning'} message={status.detail} />
      ) : null}

      <Field
        label="Name"
        value={label}
        onChangeText={setLabel}
        placeholder={meta?.name ?? 'Calendar'}
        help="Shown in the app to tell accounts apart."
        autoCapitalize="words"
        maxLength={60}
        returnKeyType="done"
      />

      <View>
        <Text style={styles.sectionTitle}>Show on the mirror</Text>
        <View style={styles.card}>
          <CalendarToggleList
            calendars={calendars}
            onToggle={(cal, enabled) => update(cal.id, { enabled })}
            onColor={(cal, color) => update(cal.id, { color })}
            emptyText="No calendars found yet. The mirror will pick them up on its next sync; you can choose them later in Calendars."
          />
        </View>
        {calendars.length > 0 && enabledCount === 0 ? (
          <Text style={styles.hint}>With every calendar off, this account won’t show anything on the mirror.</Text>
        ) : null}
      </View>

      {error ? <Notice tone="error" message={error} /> : null}

      <PrimaryButton label="Done" onPress={done} loading={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { gap: spacing.lg },
  success: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 48, height: 48, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  successLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  successTitle: { ...typography.h3, color: colors.text },
  successSub: { ...typography.bodySmall, color: colors.textMuted },
  sectionTitle: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  hint: { ...typography.caption, color: colors.warning, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
});
