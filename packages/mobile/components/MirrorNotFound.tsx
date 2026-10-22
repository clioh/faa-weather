/**
 * "Mirror not found" notice with Search again / Enter address manually.
 *
 * Shown by screens that talk to the mirror. By default it appears on its own
 * while the API client is searching for the mirror by id (after a request
 * could not reach it) and when that search came back empty; pass `visible`
 * to show it for a screen's own connection error too.
 */

import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Spinner, Text } from '@/components/ui';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, type MirrorConnectionState } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

/** Current API client connection state, updated live. */
export function useMirrorConnection(): MirrorConnectionState {
  const [state, setState] = useState(() => api.getConnectionState());
  useEffect(() => {
    setState(api.getConnectionState());
    return api.subscribe(setState);
  }, []);
  return state;
}

/** The mirror list with the manual address field open. */
export function goToManualEntry(): void {
  router.dismissTo({ pathname: '/', params: { manual: '1' } });
}

interface MirrorNotFoundProps {
  /** Force the notice on (e.g. the screen's own request failed). */
  visible?: boolean;
  /** Called after "Search again" found the mirror, to reload the screen. */
  onFound?: () => void;
}

export function MirrorNotFound({ visible, onFound }: MirrorNotFoundProps) {
  const connection = useMirrorConnection();
  const [searching, setSearching] = useState(false);
  const [missed, setMissed] = useState(false);

  const busy = searching || connection.status === 'searching';
  const shown = visible || busy || connection.status === 'not-found';
  if (!shown) return null;

  const searchAgain = async () => {
    // Without an id the client can't tell this mirror from another one, so
    // let the user pick it from a fresh scan instead.
    if (!connection.mirrorId) {
      router.dismissTo('/');
      return;
    }
    setSearching(true);
    setMissed(false);
    const found = await api.relocate(true);
    setSearching(false);
    setMissed(!found);
    if (found) onFound?.();
  };

  if (busy) {
    // Manual entry stays available while the automatic search runs.
    return (
      <View style={styles.container} accessibilityRole="alert">
        <View style={styles.searchingRow}>
          <Spinner />
          <Text style={styles.searchingText}>Looking for your mirror…</Text>
        </View>
        <Button
          label="Enter address manually"
          variant="secondary"
          onPress={goToManualEntry}
          style={styles.button}
        />
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.header}>
        <Ionicons name="search-outline" size={18} color={colors.warning} />
        <Text style={styles.title}>Mirror not found</Text>
      </View>
      <Text style={styles.text}>
        {missed ? 'Still no answer. ' : ''}Make sure the mirror is powered on and your phone is on the same WiFi network. If
        your router changed, the mirror may need to be set up on the new network.
      </Text>
      <Button label="Search again" icon="refresh" onPress={searchAgain} style={styles.button} />
      <Button
        label="Enter address manually"
        variant="secondary"
        onPress={goToManualEntry}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.sheetBorder,
    backgroundColor: colors.surfaceTint,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchingText: {
    ...typography.caption,
    color: colors.chipText,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 16,
    color: colors.text,
  },
  text: {
    ...typography.bodySmall,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  button: {
    height: 48,
  },
});
