/**
 * "Mirror not found" notice with Search again / Enter address manually.
 *
 * Shown by screens that talk to the mirror. By default it appears on its own
 * while the API client is searching for the mirror by id (after a request
 * could not reach it) and when that search came back empty; pass `visible`
 * to show it for a screen's own connection error too.
 */

import { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from '@/components/ui/Text';
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

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.header}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.warning} />
        ) : (
          <Ionicons name="search-outline" size={18} color={colors.warning} />
        )}
        <Text style={styles.title}>{busy ? 'Looking for your mirror…' : 'Mirror not found'}</Text>
      </View>
      {!busy && (
        <Text style={styles.text}>
          {missed ? 'Still no answer. ' : ''}Make sure the mirror is powered on and your phone is on the same WiFi network. If
          your router changed, the mirror may need to be set up on the new network.
        </Text>
      )}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={searchAgain}
          disabled={busy}
          accessibilityRole="button"
        >
          <Ionicons name="refresh" size={16} color={colors.background} />
          <Text style={styles.primaryText}>Search again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={goToManualEntry}
          accessibilityRole="button"
        >
          <Ionicons name="create-outline" size={16} color={colors.text} />
          <Text style={styles.buttonText}>Enter address manually</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.35)',
    backgroundColor: 'rgba(255, 170, 0, 0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  text: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceHighlight,
  },
  primaryButton: {
    backgroundColor: colors.warning,
  },
  buttonText: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '600',
  },
  primaryText: {
    ...typography.bodySmall,
    color: colors.background,
    fontWeight: '600',
  },
});
