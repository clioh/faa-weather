/**
 * One connected calendar account on the Calendars screen: who it is, whether
 * it's syncing, its calendars, and the account actions.
 */

import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AccountCalendar, CalendarAccount } from '@/lib/api';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { TOUCH } from '@/components/config/fieldStyles';
import { CalendarToggleList } from './CalendarToggleList';
import { PROVIDER_META, accountStatus } from './meta';
import { PrimaryButton } from './ui';

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

  return (
    <View style={styles.card}>
      <View style={styles.head} accessible accessibilityLabel={`${account.label}, ${account.email ?? meta?.name ?? ''}. ${status.label}`}>
        <View style={[styles.icon, { backgroundColor: `${meta?.tint ?? colors.text}1f` }]}>
          <Ionicons name={meta?.icon ?? 'calendar-outline'} size={20} color={meta?.tint ?? colors.text} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.label} numberOfLines={1}>
            {account.label}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {account.email ?? meta?.name ?? account.provider}
          </Text>
        </View>
        <View style={[styles.pill, { borderColor: `${status.color}55` }]}>
          {syncing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} style={styles.pillSpinner} />
          ) : (
            <Ionicons name={status.icon} size={14} color={status.color} />
          )}
          <Text style={[styles.pillText, { color: account.status === 'ok' ? colors.textSecondary : status.color }]}>
            {syncing ? 'Syncing…' : status.label}
          </Text>
        </View>
      </View>

      {status.detail ? (
        <View
          style={[
            styles.problem,
            { backgroundColor: account.status === 'reauth' ? 'rgba(255, 68, 68, 0.1)' : 'rgba(255, 170, 0, 0.1)' },
          ]}
          accessibilityRole="alert"
        >
          <Text style={[styles.problemText, { color: status.color }]}>{status.detail}</Text>
          {account.status === 'reauth' ? (
            <PrimaryButton
              label="Reconnect"
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
        <Action icon="sync-outline" label="Sync now" onPress={onSync} disabled={syncing} a11y={`Sync ${account.label} now`} />
        <Action icon="create-outline" label="Rename" onPress={onRename} a11y={`Rename ${account.label}`} />
        <Action
          icon="trash-outline"
          label="Remove"
          onPress={onRemove}
          tint={colors.error}
          a11y={`Remove ${account.label}`}
        />
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  disabled,
  tint = colors.textSecondary,
  a11y,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  a11y: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.action, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name={icon} size={18} color={tint} />
      <Text style={[styles.actionText, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  icon: { width: 40, height: 40, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  label: { ...typography.body, color: colors.text, fontWeight: '600' },
  email: { ...typography.caption, color: colors.textMuted },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    maxWidth: 160,
  },
  pillSpinner: { transform: [{ scale: 0.7 }], width: 14, height: 14 },
  pillText: { ...typography.caption, fontWeight: '600', flexShrink: 1 },
  problem: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.md,
  },
  problemText: { ...typography.bodySmall },
  section: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  sectionLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xs },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  action: {
    flex: 1,
    minHeight: TOUCH + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { ...typography.bodySmall, fontWeight: '600' },
});
