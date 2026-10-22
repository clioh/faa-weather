/**
 * Template Selection Screen
 * Part of the onboarding flow - choose initial layout
 */

import { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useDisplayHold } from '@/hooks/useDisplayHold';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { HEADER_HIT_SLOP, HeaderBackButton, LayoutThumbnail } from '@/components';
import { goBack, goToDashboard } from '@/lib/navigation';
import { InlineError } from '@/components/ErrorToast';
import { logError } from '@/lib/errors';
import {
  LAYOUT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TemplateCategory,
  LayoutTemplate,
} from '@/lib/templates';
import { ModuleInstance } from '@/lib/modules';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

type FilterCategory = TemplateCategory | 'all';

export default function TemplateScreen() {
  const insets = useSafeAreaInsets();
  const { user, currentMirror } = useUser();
  // Keep the mirror on so the chosen layout appears on it right away.
  useDisplayHold(Boolean(currentMirror));
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredTemplates =
    selectedCategory === 'all'
      ? LAYOUT_TEMPLATES
      : LAYOUT_TEMPLATES.filter((t) => t.category === selectedCategory);

  const handleApplyTemplate = async (template: LayoutTemplate) => {
    if (!user) return;

    setApplying(template.id);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Convert template modules to full ModuleInstance with IDs
      const modules: ModuleInstance[] = template.modules.map((mod, index) => ({
        ...mod,
        instanceId: `${template.id}-${mod.moduleId}-${index}`,
      }));

      // Save layout to mirror (only if connected)
      if (currentMirror) {
        try {
          await api.updateUserLayout(user.id, modules);
        } catch (apiErr) {
          logError('TemplateScreen.saveLayout', apiErr, { templateId: template.id });
          // Continue anyway - template will be stored locally
        }
      }

      // Mark onboarding complete
      try {
        await storage.setOnboardingState({ phase: 'complete' });
      } catch (storageErr) {
        logError('TemplateScreen.setOnboardingState', storageErr);
        // Continue anyway - not critical
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate to dashboard
      goToDashboard();
    } catch (err) {
      logError('TemplateScreen.handleApplyTemplate', err, { templateId: template.id });
      setError('Failed to apply template. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setApplying(null);
    }
  };

  const handleSkip = async () => {
    try {
      // Mark onboarding complete without applying template
      await storage.setOnboardingState({ phase: 'complete' });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      goToDashboard();
    } catch (err) {
      logError('TemplateScreen.handleSkip', err);
      // Still navigate - onboarding state isn't critical
      goToDashboard();
    }
  };

  const categoryFilters: { key: FilterCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'aviation', label: 'Aviation' },
    { key: 'weather', label: 'Weather' },
    { key: 'lifestyle', label: 'Lifestyle' },
    { key: 'minimal', label: 'Minimal' },
  ];

  return (
    <View style={styles.container}>
      {/* Back + Progress Indicator */}
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <View style={styles.topBar}>
          <HeaderBackButton onPress={() => goBack('/setup')} />
        </View>
        <OnboardingProgress currentPhase="template" />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Choose Your Layout</Text>
        <Text style={styles.subtitle}>
          Pick a template to get started. You can customize it later.
        </Text>
      </View>

      {/* Error display */}
      {error && (
        <View style={styles.errorContainer}>
          <InlineError
            message={error}
            onDismiss={() => setError(null)}
          />
        </View>
      )}

      {/* Category Filter */}
      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {categoryFilters.map((filter) => (
            <TouchableOpacity
              key={filter.key}
              hitSlop={HEADER_HIT_SLOP}
              style={[
                styles.filterChip,
                selectedCategory === filter.key && styles.filterChipActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedCategory(filter.key);
              }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedCategory === filter.key && styles.filterChipTextActive,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Templates List */}
      <ScrollView contentContainerStyle={styles.content}>
        {filteredTemplates.map((template) => (
          <TouchableOpacity
            key={template.id}
            style={styles.templateCard}
            onPress={() => handleApplyTemplate(template)}
            activeOpacity={0.7}
            disabled={applying !== null}
          >
            <LayoutThumbnail
              modules={template.modules}
              style={styles.thumbnail}
              accessibilityLabel={`${template.name} layout preview`}
            />
            <View style={styles.templateHeader}>
              <View style={styles.templateInfo}>
                <Text style={styles.templateName}>{template.name}</Text>
                <Text style={styles.templateDescription}>{template.description}</Text>
              </View>
            </View>

            <View style={styles.templateFooter}>
              <View style={styles.templateMeta}>
                <View style={styles.moduleBadge}>
                  <Ionicons name="grid-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.moduleCount}>
                    {template.modules.length} modules
                  </Text>
                </View>
                <View
                  style={[
                    styles.categoryBadge,
                    {
                      backgroundColor:
                        TEMPLATE_CATEGORIES[template.category]?.color + '20' ||
                        colors.primaryMuted,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryBadgeText,
                      {
                        color:
                          TEMPLATE_CATEGORIES[template.category]?.color ||
                          colors.primary,
                      },
                    ]}
                  >
                    {TEMPLATE_CATEGORIES[template.category]?.label || template.category}
                  </Text>
                </View>
              </View>

              {applying === template.id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <View style={styles.selectButton}>
                  <Text style={styles.selectButtonText}>Select</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}

        {filteredTemplates.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No templates in this category</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipButtonText}>Skip for now</Text>
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
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  filterContainer: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterScroll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primary,
  },
  filterChipText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: colors.primary,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  templateCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  templateHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  thumbnail: {
    marginBottom: spacing.md,
  },
  templateInfo: {
    flex: 1,
  },
  templateName: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  templateDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  templateFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  templateMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  moduleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  moduleCount: {
    ...typography.caption,
    color: colors.textMuted,
  },
  categoryBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  categoryBadgeText: {
    ...typography.caption,
    fontWeight: '600',
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  selectButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  skipButton: {
    alignItems: 'center',
    padding: spacing.md,
  },
  skipButtonText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
