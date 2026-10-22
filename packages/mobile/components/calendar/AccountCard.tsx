/**
 * One connected calendar account on the Calendars screen: who it is, whether
 * it's syncing, its calendars, and the account actions.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AccountCalendar, CalendarAccount } from '@/lib/api';
import { Button, Notice, Spinner, Text } from '@/components/ui';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { TOUCH } from '@/components/config/fieldStyles';
import { CalendarToggleList } from './CalendarToggleList';
import { PROVIDER_META, accountStatus } from './meta';
import { ProviderTile } from './ProviderTile';

interface AccountCardProps {
  account: CalendarAccount;
  syncing: boolean;
  onToggle: (calendar: AccountCalendar, enabled: boolean) => void;
  onColor: (calendar: AccountCalendar, color: string) => void;
  onSync: () => void;
  onRename: () => void;
  onRemove: () => void;
  onReconnect: () => void;
}

export function AccountCard({
  account,
  syncing,
  onToggle,
  onColor,
  onSync,
  onRename,
  onRemove,
  onReconnect,
}: AccountCardProps) {
  const meta = PROVIDER_META[account.provider];
  const status = accountStatus(account);
  const enabledCount = account.calendars.filter((c) => c.enabled).length;
  const ok = account.status === 'ok';

  return (
    <View style={styles.card}>
      <View style={styles.head} accessible accessibilityLabel={`${account.label}, ${account.email ?? meta?.name ?? ''}. ${status.label}`}>
        <ProviderTile provider={account.provider} />
        <View style={styles.headText}>
          <Text style={styles.label} numberOfLines={1}>
            {account.label}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {account.email ?? meta?.name ?? account.provider}
          </Text>
        </View>
        <View style={styles.status}>
          {syncing ? (
            <Spinner style={styles.statusSpinner} />
          ) : (
            <Ionicons name={status.icon} size={13} color={status.color} />
          )}
          <Text style={[styles.statusText, !ok && !syncing && { color: status.color }]} numberOfLines={1}>
            {syncing ? 'Syncing…' : status.label}
          </Text>
        </View>
      </View>

      {status.detail ? (
        <View style={styles.problem}>
          <Notice tone="warning" message={status.detail} />
          {account.status === 'reauth' ? (
            <Button
              label="Reconnect"
              size="small"
              icon="key-outline"
              onPress={onReconnect}
              accessibilityLabel={`Reconnect ${account.label}`}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          {account.calendars.length === 0
            ? 'Calendars'
            : `Showing ${enabledCount} of ${account.calendars.length} calendar${account.calendars.length === 1 ? '' : 's'}`}
        </Text>
        <CalendarToggleList calendars={account.calendars} onToggle={onToggle} onColor={onColor} />
      </View>

      <View style={styles.actions}>
        <Action label="Sync now" onPress={onSync} disabled={syncing} a11y={`Sync ${account.label} now`} />
        <Action label="Rename" onPress={onRename} a11y={`Rename ${account.label}`} divided />
        <Action label="Remove" onPress={onRemove} tint={colors.danger} a11y={`Remove ${account.label}`} divided />
      </View>
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
  tint = colors.text,
  a11y,
  divided,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  a11y: string;
  /** Hairline on the left, between actions. */
  divided?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
        divided && styles.actionDivided,
        disabled && styles.actionDisabled,
        pressed && styles.actionPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[styles.actionText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceTint,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.sheetBorder,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: spacing.md },
  headText: { flex: 1, gap: 2 },
  label: { fontSize: 15, color: colors.text },
  email: { ...typography.caption, color: colors.textMuted },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 150 },
  statusSpinner: { transform: [{ scale: 0.7 }], width: 14, height: 14 },
  statusText: { fontSize: 11, color: colors.textSecondary, flexShrink: 1 },
  problem: {
    paddingHorizontal: spacing.md,
    paddingBottom: 14,
    gap: 10,
  },
  section: {
    paddingHorizontal: spacing.md,
  },
  sectionLabel: { ...typography.label, color: colors.textMuted, paddingBottom: 6 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.sheetBorder },
  action: {
    flex: 1,
    minHeight: TOUCH + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDivided: { borderLeftWidth: 1, borderLeftColor: colors.sheetBorder },
  actionDisabled: { opacity: 0.5 },
  actionPressed: { backgroundColor: colors.surfaceHighlight },
  actionText: { fontSize: 14 },
});
