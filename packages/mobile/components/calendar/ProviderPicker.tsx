/**
 * First step of adding a calendar: pick where it lives. The list comes from
 * the mirror, which knows which sign-ins it has been set up for; providers it
 * can't use are shown greyed out with the mirror's explanation.
 */

import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { CalendarProvider } from '@/lib/api';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { PROVIDER_META } from './meta';
import { Notice } from './ui';

interface ProviderPickerProps {
  providers: CalendarProvider[] | null;
  error: string | null;
  onRetry: () => void;
  onPick: (provider: CalendarProvider) => void;
}

export function ProviderPicker({ providers, error, onRetry, onPick }: ProviderPickerProps) {
  if (error) return <Notice tone="error" message={error} action={{ label: 'Try again', onPress: onRetry }} />;
  if (!providers) return <ActivityIndicator color={colors.primary} style={styles.loader} />;

  // "Other CalDAV" is for people who know they need it; keep it out of the main list.
  const main = providers.filter((p) => p.id !== 'caldav');
  const other = providers.filter((p) => p.id === 'caldav');

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>Where is the calendar you want on your mirror?</Text>
      <View style={styles.card}>
        {main.map((p, i) => (
          <ProviderRow key={p.id} provider={p} first={i === 0} onPick={onPick} />
        ))}
      </View>
      {other.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Other</Text>
          <View style={styles.card}>
            {other.map((p, i) => (
              <ProviderRow key={p.id} provider={p} first={i === 0} onPick={onPick} />
            ))}
          </View>
        </>
      )}
      <Text style={styles.footnote}>
        Sign-ins are stored on your mirror and used only to read your calendars. SkyGlass never changes your events.
      </Text>
    </View>
  );
}

function ProviderRow({
  provider,
  first,
  onPick,
}: {
  provider: CalendarProvider;
  first: boolean;
  onPick: (p: CalendarProvider) => void;
}) {
  const meta = PROVIDER_META[provider.id];
  const name = provider.name || meta?.name || provider.id;
  const off = !provider.available;
  return (
    <TouchableOpacity
      style={[styles.row, !first && styles.rowDivider]}
      disabled={off}
      onPress={() => {
        Haptics.selectionAsync();
        onPick(provider);
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      accessibilityLabel={off ? `${name}, unavailable. ${provider.reason ?? ''}` : name}
      accessibilityHint={off ? undefined : meta?.blurb}
    >
      <View style={[styles.icon, { backgroundColor: `${meta?.tint ?? colors.text}1f` }, off && styles.dim]}>
        <Ionicons name={meta?.icon ?? 'calendar-outline'} size={22} color={meta?.tint ?? colors.text} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.name, off && styles.nameOff]}>{name}</Text>
        <Text style={styles.blurb}>{off ? provider.reason ?? 'Not available on this mirror.' : meta?.blurb}</Text>
      </View>
      {!off && <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  loader: { paddingVertical: spacing.xl },
  lead: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.textMuted, marginTop: spacing.md, paddingHorizontal: spacing.xs },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  icon: { width: 40, height: 40, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.4 },
  text: { flex: 1, gap: 2 },
  name: { ...typography.body, color: colors.text, fontWeight: '500' },
  nameOff: { color: colors.textMuted },
  blurb: { ...typography.caption, color: colors.textMuted },
  footnote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, paddingHorizontal: spacing.xs },
});
