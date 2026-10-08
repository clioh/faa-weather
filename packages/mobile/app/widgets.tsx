/**
 * Installed Widgets Screen
 * List of all widgets currently on the mirror with configuration access
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
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import {
  ModuleInstance,
  CATEGORIES,
  getModuleById,
} from '@/lib/modules';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

// Widget status for widgets that need authentication
type WidgetStatus = 'configured' | 'needs_setup' | 'auth_required' | 'error';

interface InstalledWidget extends ModuleInstance {
  status: WidgetStatus;
  statusMessage?: string;
}

// Widgets that require OAuth authentication
const OAUTH_WIDGETS: Record<string, { provider: string; scopes: string[] }> = {
  calendar: {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },
  'todo-list': {
    provider: 'todoist',
    scopes: ['data:read'],
  },
  'fitness-ring': {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/fitness.activity.read'],
  },
  spotify: {
    provider: 'spotify',
    scopes: ['user-read-currently-playing', 'user-read-playback-state'],
  },
  'photo-frame': {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/photoslibrary.readonly'],
  },
};

export default function WidgetsScreen() {
  const [widgets, setWidgets] = useState<InstalledWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadWidgets = useCallback(async () => {
    try {
      // Fetch current layout from the mirror
      const response = await fetch(`${api.getBaseUrl()}/api/layout`);
      const layout = await response.json();

      // Enrich with status information
      const enrichedWidgets: InstalledWidget[] = layout.modules.map(
        (module: ModuleInstance) => {
          const definition = getModuleById(module.moduleId);
          const oauthConfig = OAUTH_WIDGETS[module.moduleId];

          let status: WidgetStatus = 'configured';
          let statusMessage: string | undefined;

          // Check if widget needs OAuth and if it's configured
          if (oauthConfig) {
            const hasAuth = module.config.authToken || module.config.accessToken;
            if (!hasAuth) {
              status = 'auth_required';
              statusMessage = `Sign in with ${oauthConfig.provider} required`;
            }
          }

          // Check for required fields
          if (definition) {
            const missingRequired = definition.configFields
              .filter((f) => f.required)
              .filter((f) => !module.config[f.key]);

            if (missingRequired.length > 0) {
              status = 'needs_setup';
              statusMessage = `Missing: ${missingRequired.map((f) => f.label).join(', ')}`;
            }
          }

          return {
            ...module,
            status,
            statusMessage,
          };
        }
      );

      setWidgets(enrichedWidgets);
    } catch {
      // Use demo data if mirror not available
      setWidgets([
        {
          instanceId: 'demo-1',
          moduleId: 'digital-clock',
          position: { x: 0, y: 0 },
          size: 'medium',
          config: { format24h: false, showSeconds: true },
          status: 'configured',
        },
        {
          instanceId: 'demo-2',
          moduleId: 'metar',
          position: { x: 4, y: 0 },
          size: 'medium',
          config: { icao: 'KJFK' },
          status: 'configured',
        },
        {
          instanceId: 'demo-3',
          moduleId: 'calendar',
          position: { x: 0, y: 3 },
          size: 'tall',
          config: {},
          status: 'auth_required',
          statusMessage: 'Sign in with Google required',
        },
        {
          instanceId: 'demo-4',
          moduleId: 'weather-forecast',
          position: { x: 6, y: 0 },
          size: 'wide',
          config: {},
          status: 'needs_setup',
          statusMessage: 'Missing: Location',
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadWidgets();
  }, [loadWidgets]);

  const onRefresh = () => {
    setRefreshing(true);
    loadWidgets();
  };

  const getStatusColor = (status: WidgetStatus): string => {
    switch (status) {
      case 'configured':
        return colors.primary;
      case 'needs_setup':
        return colors.warning;
      case 'auth_required':
        return colors.accent;
      case 'error':
        return colors.error;
      default:
        return colors.textMuted;
    }
  };

  const getStatusIcon = (status: WidgetStatus): string => {
    switch (status) {
      case 'configured':
        return 'checkmark-circle';
      case 'needs_setup':
        return 'alert-circle';
      case 'auth_required':
        return 'key';
      case 'error':
        return 'close-circle';
      default:
        return 'help-circle';
    }
  };

  const removeWidget = (widget: InstalledWidget) => {
    const definition = getModuleById(widget.moduleId);
    Alert.alert(
      'Remove Widget',
      `Remove "${definition?.name || widget.moduleId}" from your mirror?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              await fetch(`${api.getBaseUrl()}/api/layout/module/${widget.instanceId}`, {
                method: 'DELETE',
              });
              setWidgets(widgets.filter((w) => w.instanceId !== widget.instanceId));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert('Error', 'Failed to remove widget');
            }
          },
        },
      ]
    );
  };

  const renderWidget = (widget: InstalledWidget) => {
    const definition = getModuleById(widget.moduleId);
    if (!definition) return null;

    const categoryInfo = CATEGORIES[definition.category];
    const statusColor = getStatusColor(widget.status);
    const needsAttention = widget.status !== 'configured';

    return (
      <TouchableOpacity
        key={widget.instanceId}
        style={[styles.widgetCard, needsAttention && styles.widgetCardAttention]}
        onPress={() =>
          router.push({
            pathname: '/widget/[id]',
            params: { id: widget.instanceId, moduleId: widget.moduleId },
          })
        }
        onLongPress={() => removeWidget(widget)}
        delayLongPress={500}
      >
        <View style={[styles.widgetIcon, { backgroundColor: categoryInfo.color + '20' }]}>
          <Ionicons name={definition.icon as any} size={28} color={categoryInfo.color} />
        </View>

        <View style={styles.widgetContent}>
          <View style={styles.widgetHeader}>
            <Text style={styles.widgetName}>{definition.name}</Text>
            <View style={styles.widgetMeta}>
              <View style={[styles.categoryBadge, { backgroundColor: categoryInfo.color + '20' }]}>
                <Ionicons name={categoryInfo.icon as any} size={10} color={categoryInfo.color} />
                <Text style={[styles.categoryBadgeText, { color: categoryInfo.color }]}>
                  {categoryInfo.label}
                </Text>
              </View>
            </View>
          </View>

          {/* Status indicator */}
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {widget.status === 'configured'
                ? 'Working'
                : widget.status === 'auth_required'
                ? 'Sign in required'
                : widget.status === 'needs_setup'
                ? 'Setup incomplete'
                : 'Error'}
            </Text>
          </View>

          {widget.statusMessage && widget.status !== 'configured' && (
            <Text style={styles.statusMessage}>{widget.statusMessage}</Text>
          )}

          {/* Config preview */}
          {widget.status === 'configured' && Object.keys(widget.config).length > 0 && (
            <View style={styles.configPreview}>
              {Object.entries(widget.config)
                .slice(0, 2)
                .map(([key, value]) => (
                  <Text key={key} style={styles.configPreviewText} numberOfLines={1}>
                    {key}: {String(value)}
                  </Text>
                ))}
            </View>
          )}
        </View>

        <View style={styles.widgetActions}>
          <Ionicons name={getStatusIcon(widget.status) as any} size={20} color={statusColor} />
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  // Group widgets by status
  const needsAttention = widgets.filter((w) => w.status !== 'configured');
  const working = widgets.filter((w) => w.status === 'configured');

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Installed Widgets</Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.push('/editor')}
        >
          <Ionicons name="add" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>{widgets.length}</Text>
            <Text style={styles.summaryLabel}>Total</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.primary }]}>{working.length}</Text>
            <Text style={styles.summaryLabel}>Working</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.warning }]}>
              {needsAttention.length}
            </Text>
            <Text style={styles.summaryLabel}>Needs Setup</Text>
          </View>
        </View>

        {/* Widgets needing attention */}
        {needsAttention.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>NEEDS ATTENTION</Text>
            <View style={styles.widgetList}>{needsAttention.map(renderWidget)}</View>
          </>
        )}

        {/* Working widgets */}
        {working.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>WORKING</Text>
            <View style={styles.widgetList}>{working.map(renderWidget)}</View>
          </>
        )}

        {/* Empty state */}
        {widgets.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="apps-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No Widgets Installed</Text>
            <Text style={styles.emptySubtitle}>
              Add widgets to customize your mirror display
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push('/editor')}
            >
              <Ionicons name="add-circle" size={20} color={colors.primary} />
              <Text style={styles.emptyButtonText}>Add Widgets</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Hint */}
        <View style={styles.hint}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={styles.hintText}>
            Long press on a widget to remove it. Tap to configure.
          </Text>
        </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 60,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    padding: spacing.sm,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  summary: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryNumber: {
    ...typography.h2,
    color: colors.text,
    marginBottom: 2,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  widgetList: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  widgetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  widgetCardAttention: {
    borderColor: colors.warning,
    backgroundColor: 'rgba(255, 170, 0, 0.05)',
  },
  widgetIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  widgetContent: {
    flex: 1,
  },
  widgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  widgetName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  widgetMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  categoryBadgeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    ...typography.caption,
  },
  statusMessage: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  configPreview: {
    marginTop: spacing.xs,
  },
  configPreviewText: {
    ...typography.caption,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  widgetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xxl,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.lg,
  },
  emptyButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.md,
  },
  hintText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
});
