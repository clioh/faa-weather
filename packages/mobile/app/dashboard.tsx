/**
 * Dashboard Screen
 * Main view when connected to a configured mirror
 * Shows user-specific information and quick actions
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { useUser } from '@/context/UserContext';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

interface MirrorStatus {
  online: boolean;
  version: string;
  uptime?: number;
  presence?: {
    detected: boolean;
    user?: string;
  };
  weather?: {
    icao: string;
    flightRules: string;
    temperature?: number;
  };
}

export default function DashboardScreen() {
  const { user } = useUser();
  const [status, setStatus] = useState<MirrorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [moduleCount, setModuleCount] = useState<number>(0);

  const loadStatus = useCallback(async () => {
    try {
      const health = await api.ping();
      setStatus({
        online: true,
        version: health.version,
      });

      // Try to get user's layout module count
      if (user) {
        try {
          const userLayout = await api.getUserLayout(user.id);
          setModuleCount(userLayout.modules?.length || 0);
        } catch {
          // Fall back to global layout
          try {
            const layout = await api.getLayout();
            setModuleCount(layout.modules?.length || 0);
          } catch {
            setModuleCount(0);
          }
        }
      }
    } catch {
      setStatus({ online: false, version: '' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [loadStatus]);

  const onRefresh = () => {
    setRefreshing(true);
    loadStatus();
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
        <View style={[styles.statusCard, status?.online && styles.statusCardOnline]}>
          <View style={styles.statusIcon}>
            <Ionicons
              name={status?.online ? 'wifi' : 'wifi-outline'}
              size={32}
              color={status?.online ? colors.primary : colors.error}
            />
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusTitle}>
              {status?.online ? 'Connected' : 'Disconnected'}
            </Text>
            <Text style={styles.statusSubtitle}>
              {status?.online
                ? `Version ${status.version}`
                : 'Unable to reach mirror'}
            </Text>
          </View>
          <View
            style={[
              styles.statusIndicator,
              status?.online ? styles.statusIndicatorOnline : styles.statusIndicatorOffline,
            ]}
          />
        </View>

        {/* Customization section */}
        <Text style={styles.sectionTitle}>Customize Mirror</Text>
        <View style={styles.customizeRow}>
          <TouchableOpacity
            style={styles.customizeCard}
            onPress={() => router.push('/editor')}
          >
            <View style={[styles.customizeIcon, { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name="grid-outline" size={28} color={colors.primary} />
            </View>
            <View style={styles.customizeInfo}>
              <Text style={styles.customizeTitle}>Edit Layout</Text>
              <Text style={styles.customizeSubtitle}>
                {user ? `Customize ${user.name}'s mirror` : 'Drag & drop widgets on your mirror'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.widgetsCard}
          onPress={() => router.push('/widgets')}
        >
          <View style={[styles.widgetsIcon, { backgroundColor: colors.accentMuted }]}>
            <Ionicons name="apps-outline" size={28} color={colors.accent} />
          </View>
          <View style={styles.widgetsInfo}>
            <Text style={styles.widgetsTitle}>Installed Widgets</Text>
            <Text style={styles.widgetsSubtitle}>
              {user ? `${user.name}'s active widgets` : 'Configure your active widgets'}
            </Text>
          </View>
          {moduleCount > 0 && (
            <View style={styles.widgetsBadge}>
              <Text style={styles.widgetsBadgeText}>{moduleCount}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/setup/face')}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.accentMuted }]}>
              <Ionicons name="person-add-outline" size={24} color={colors.accent} />
            </View>
            <Text style={styles.actionTitle}>Add Face</Text>
            <Text style={styles.actionSubtitle}>Register a new person</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/updates')}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name="cloud-download-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.actionTitle}>Updates</Text>
            <Text style={styles.actionSubtitle}>Check for new versions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/setup/airport')}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(255, 170, 0, 0.15)' }]}>
              <Ionicons name="airplane-outline" size={24} color={colors.warning} />
            </View>
            <Text style={styles.actionTitle}>Airport</Text>
            <Text style={styles.actionSubtitle}>Change home airport</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/settings')}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.surfaceHighlight }]}>
              <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
            </View>
            <Text style={styles.actionTitle}>Settings</Text>
            <Text style={styles.actionSubtitle}>Configure mirror</Text>
          </TouchableOpacity>
        </View>

        {/* Info cards */}
        <Text style={styles.sectionTitle}>Mirror Info</Text>

        <TouchableOpacity
          style={styles.infoCard}
          onPress={() => router.push('/setup')}
        >
          <View style={styles.infoCardIcon}>
            <Ionicons name="construct-outline" size={24} color={colors.primary} />
          </View>
          <View style={styles.infoCardContent}>
            <Text style={styles.infoCardTitle}>Setup Wizard</Text>
            <Text style={styles.infoCardSubtitle}>Configure WiFi, airport, and face registration</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.infoCard}>
          <View style={styles.infoCardIcon}>
            <Ionicons name="information-circle-outline" size={24} color={colors.accent} />
          </View>
          <View style={styles.infoCardContent}>
            <Text style={styles.infoCardTitle}>About</Text>
            <Text style={styles.infoCardSubtitle}>
              SkyGlass for Pilots{'\n'}
              Connected to: {api.getBaseUrl() || 'Not connected'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabItem}>
          <Ionicons name="home" size={24} color={colors.primary} />
          <Text style={[styles.tabLabel, styles.tabLabelActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => router.push('/updates')}
        >
          <Ionicons name="cloud-download-outline" size={24} color={colors.textMuted} />
          <Text style={styles.tabLabel}>Updates</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => router.push('/settings')}
        >
          <Ionicons name="settings-outline" size={24} color={colors.textMuted} />
          <Text style={styles.tabLabel}>Settings</Text>
        </TouchableOpacity>
      </View>
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
    padding: spacing.lg,
    paddingBottom: 100,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusCardOnline: {
    borderColor: colors.primary,
  },
  statusIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  statusInfo: {
    flex: 1,
  },
  statusTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: 2,
  },
  statusSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusIndicatorOnline: {
    backgroundColor: colors.primary,
  },
  statusIndicatorOffline: {
    backgroundColor: colors.error,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  actionCard: {
    width: '47%',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  actionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  actionSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoCardIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  infoCardSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 20,
    paddingTop: spacing.sm,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.sm,
  },
  tabLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  tabLabelActive: {
    color: colors.primary,
  },
  customizeRow: {
    marginBottom: spacing.sm,
  },
  customizeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  customizeIcon: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  customizeInfo: {
    flex: 1,
  },
  customizeTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  customizeSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  widgetsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  widgetsIcon: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  widgetsInfo: {
    flex: 1,
  },
  widgetsTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  widgetsSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  widgetsBadge: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginRight: spacing.sm,
  },
  widgetsBadgeText: {
    ...typography.caption,
    color: colors.background,
    fontWeight: '700',
  },
});
