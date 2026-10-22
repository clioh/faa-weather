/**
 * Dashboard Screen (Mirror tab)
 * Main view when connected to a configured mirror: connection status, the
 * saved layout, and shortcuts to the mirror's most-used settings.
 */

import { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import type { ModuleInstance } from '@/lib/modules';
import { useUser } from '@/context/UserContext';
import { MirrorNotFound } from '@/components/MirrorNotFound';
import { ScreenHeader } from '@/components/ScreenHeader';
import { LayoutThumbnail } from '@/components/config/LayoutThumbnail';
import { Badge, Button, Row, RowGroup, Spinner, Text } from '@/components/ui';
import { goHome } from '@/lib/navigation';
import { colors, fonts, spacing, typography } from '@/lib/theme';

interface MirrorStatus {
  online: boolean;
  version: string;
}

/** Shown on the dashboard; each piece is optional and loaded best-effort. */
interface MirrorSummary {
  modules: ModuleInstance[] | null;
  airport: string | null;
  latestVersion: string | null;
}

export default function DashboardScreen() {
  const { user, currentMirror } = useUser();
  const [status, setStatus] = useState<MirrorStatus | null>(null);
  const [summary, setSummary] = useState<MirrorSummary>({ modules: null, airport: null, latestVersion: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const health = await api.ping();
      setStatus({
        online: true,
        version: health.version,
      });
    } catch {
      setStatus({ online: false, version: '' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Read-only extras for the layout preview and the rows. A failure just
  // leaves that piece blank.
  const loadSummary = useCallback(async () => {
    const userLayout = user ? api.getUserLayout(user.id).then((l) => l.modules) : Promise.reject();
    const [modules, config, update] = await Promise.allSettled([
      userLayout.catch(() => api.getLayout().then((l) => l?.modules ?? [])),
      api.getConfig(),
      api.getUpdateStatus(),
    ]);
    setSummary({
      modules: modules.status === 'fulfilled' ? modules.value : null,
      airport: config.status === 'fulfilled' ? config.value.airport || null : null,
      latestVersion:
        update.status === 'fulfilled' && update.value.updateAvailable ? update.value.latestVersion : null,
    });
  }, [user]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [loadStatus]);

  // Refresh when coming back from the editor, updates, etc. The status is
  // re-checked too: goToDashboard() returns to this already-mounted screen
  // after (re)connecting, which would otherwise show the old state until the
  // next 30 s poll.
  useFocusEffect(
    useCallback(() => {
      loadStatus();
      loadSummary();
    }, [loadStatus, loadSummary])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadStatus();
    loadSummary();
  };

  const header = (
    <ScreenHeader
      title="SkyGlass"
      backLabel="Mirrors"
      onLeftPress={goHome}
      right={
        <Pressable
          onPress={() => router.push('/profile')}
          style={styles.avatarButton}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name.charAt(0).toUpperCase() ?? '?'}</Text>
          </View>
        </Pressable>
      }
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centerContainer}>
          <Spinner size="large" />
        </View>
      </View>
    );
  }

  const online = !!status?.online;
  const address = api.getBaseUrl().replace(/^https?:\/\//, '');
  const modules = summary.modules;

  return (
    <View style={styles.container}>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Connection status */}
        <View style={styles.status}>
          <View style={styles.statusLine}>
            <View style={[styles.dot, !online && styles.dotOffline]} />
            <Text style={[styles.statusText, !online && styles.statusTextOffline]}>
              {online ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          <Text style={styles.mirrorName}>{currentMirror?.mirrorName ?? 'SkyGlass'}</Text>
          <Text style={[styles.caption, online && styles.mono]}>
            {online
              ? // /api/health may not report a version; show only what we have.
                [status?.version ? `v${status.version}` : null, address].filter(Boolean).join(' · ')
              : 'Unable to reach mirror'}
          </Text>
        </View>

        {!online && <MirrorNotFound visible onFound={loadStatus} />}

        {online && (
          <>
            {/* Saved layout */}
            <Pressable
              onPress={() => router.push('/editor')}
              style={({ pressed }) => [styles.layout, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Edit Layout"
            >
              <View style={styles.thumbnailFrame}>
                <LayoutThumbnail modules={modules ?? []} style={styles.thumbnail} />
              </View>
              <View style={styles.layoutFooter}>
                <View style={styles.layoutText}>
                  <Text style={styles.layoutTitle}>{user ? `${user.name}'s layout` : 'Your layout'}</Text>
                  <Text style={styles.caption}>
                    {modules
                      ? `${modules.length} widget${modules.length === 1 ? '' : 's'}`
                      : 'Drag & drop widgets on your mirror'}
                  </Text>
                </View>
                <Button label="Edit Layout" size="small" onPress={() => router.push('/editor')} />
              </View>
            </Pressable>

            <RowGroup>
              <Row
                title="Home Airport"
                value={summary.airport ?? undefined}
                valueMono
                onPress={() => router.push('/setup/airport')}
              />
              <Row
                title="Add Face"
                value="Register a new person"
                onPress={() => router.push('/setup/face')}
              />
              <Row
                title="Software Updates"
                badge={summary.latestVersion ? <Badge label={`v${summary.latestVersion}`} /> : undefined}
                chevron
                onPress={() => router.push('/updates')}
              />
              <Row
                title="Setup Wizard"
                value="WiFi, license, location, airport and face registration"
                onPress={() => router.push('/setup')}
              />
            </RowGroup>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  avatarButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.switchOffBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    color: colors.text,
  },
  status: {
    gap: 6,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  dotOffline: {
    backgroundColor: colors.danger,
  },
  statusText: {
    ...typography.caption,
    color: colors.chipText,
  },
  statusTextOffline: {
    color: colors.danger,
  },
  mirrorName: {
    ...typography.h1,
    color: colors.text,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  layout: {
    gap: 12,
  },
  pressed: {
    opacity: 0.8,
  },
  thumbnailFrame: {
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  thumbnail: {
    borderWidth: 0,
  },
  layoutFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  layoutText: {
    flex: 1,
    gap: 2,
  },
  layoutTitle: {
    fontSize: 15,
    color: colors.text,
  },
});
