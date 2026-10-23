/**
 * First step of adding a calendar: pick where it lives. The list comes from
 * the mirror, which knows which sign-ins it has been set up for; providers it
 * can't use are shown greyed out with the mirror's explanation.
 */

import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { CalendarProvider } from '@/lib/api';
import { Row, RowGroup, SectionLabel, Spinner, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/lib/theme';
import { PROVIDER_META } from './meta';
import { ProviderTile } from './ProviderTile';
import { Notice } from './ui';

interface ProviderPickerProps {
  providers: CalendarProvider[] | null;
  error: string | null;
  onRetry: () => void;
  onPick: (provider: CalendarProvider) => void;
}

export function ProviderPicker({ providers, error, onRetry, onPick }: ProviderPickerProps) {
  if (error)
    return (
      <Notice tone="error" message={error} action={{ label: 'Try again', onPress: onRetry }} />
    );
  if (!providers) return <Spinner style={styles.loader} />;

  // "Other CalDAV" is for people who know they need it; keep it out of the main list.
  const main = providers.filter((p) => p.id !== 'caldav');
  const other = providers.filter((p) => p.id === 'caldav');

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>Where is the calendar you want on your mirror?</Text>
      <RowGroup>
        {main.map((p) => (
          <ProviderRow key={p.id} provider={p} onPick={onPick} />
        ))}
      </RowGroup>
      {other.length > 0 && (
        <View>
          <SectionLabel>Other</SectionLabel>
          <RowGroup>
            {other.map((p) => (
              <ProviderRow key={p.id} provider={p} onPick={onPick} />
            ))}
          </RowGroup>
        </View>
      )}
      <Text style={styles.footnote}>
        Sign-ins are stored on your mirror and used only to read your calendars. SkyGlass never
        changes your events.
      </Text>
    </View>
  );
}

function ProviderRow({
  provider,
  onPick,
}: {
  provider: CalendarProvider;
  onPick: (p: CalendarProvider) => void;
}) {
  const meta = PROVIDER_META[provider.id];
  const name = provider.name || meta?.name || provider.id;
  const off = !provider.available;
  return (
    <Row
      leading={<ProviderTile provider={provider.id} />}
      title={name}
      caption={off ? (provider.reason ?? 'Not available on this mirror.') : meta?.blurb}
      disabled={off}
      chevron={!off}
      onPress={() => {
        Haptics.selectionAsync();
        onPick(provider);
      }}
      accessibilityLabel={off ? `${name}, unavailable. ${provider.reason ?? ''}` : name}
      accessibilityHint={off ? undefined : meta?.blurb}
      style={styles.row}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 22 },
  loader: { paddingVertical: spacing.xl },
  lead: { ...typography.h3, color: colors.text },
  row: { minHeight: 64 },
  footnote: { ...typography.caption, color: colors.textMuted },
});
