/**
 * Templates Screen
 * Browse starting layouts as miniature mirror previews and apply one to the editor.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  LAYOUT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TemplateCategory,
  LayoutTemplate,
} from '@/lib/templates';
import { getModuleById } from '@/lib/modules';
import { useUser } from '@/context/UserContext';
import { useDisplayHold } from '@/hooks/useDisplayHold';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { ScreenHeader, LayoutThumbnail } from '@/components';

type FilterCategory = TemplateCategory | 'all';

const CATEGORY_FILTERS: { key: FilterCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'aviation', label: 'Aviation' },
  { key: 'weather', label: 'Weather' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'minimal', label: 'Minimal' },
];

function widgetNames(template: LayoutTemplate): string {
  return template.modules
    .map((m) => getModuleById(m.moduleId)?.name)
    .filter(Boolean)
    .join(', ');
}

export default function TemplatesScreen() {
  const { currentMirror } = useUser();
  useDisplayHold(Boolean(currentMirror));
  const params = useLocalSearchParams<{ hasModules?: string }>();
  const hasExistingModules = params.hasModules === 'true';
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
  // Replacing a layout is destructive, so the card asks inline before applying.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const filteredTemplates =
    selectedCategory === 'all'
      ? LAYOUT_TEMPLATES
      : LAYOUT_TEMPLATES.filter((t) => t.category === selectedCategory);

  const handleApplyTemplate = (template: LayoutTemplate) => {
    if (hasExistingModules && confirmingId !== template.id) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setConfirmingId(template.id);
      return;
    }
    applyAndNavigate(template);
  };

  const applyAndNavigate = (template: LayoutTemplate) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConfirmingId(null);
    // Pop back to the editor we came from and hand it the template; navigate()
    // and replace() would stack a second editor over the unsaved one. When
    // there is no editor below (e.g. from onboarding) this replaces us with
    // one. applyKey lets the same template be re-applied after an undo.
    router.dismissTo({
      pathname: '/editor',
      params: { templateId: template.id, applyKey: String(Date.now()) },
    });
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Choose a Template" fallbackHref="/editor" />

      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {CATEGORY_FILTERS.map((filter) => {
            const active = selectedCategory === filter.key;
            return (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedCategory(filter.key);
                  setConfirmingId(null);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${filter.label} templates`}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {filteredTemplates.map((template) => {
          const category = TEMPLATE_CATEGORIES[template.category];
          const confirming = confirmingId === template.id;
          return (
            <View key={template.id} style={[styles.templateCard, confirming && styles.templateCardConfirming]}>
              <TouchableOpacity
                onPress={() => handleApplyTemplate(template)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${template.name}. ${template.description}. ${template.modules.length} widgets: ${widgetNames(template)}`}
                accessibilityHint={hasExistingModules ? 'Asks before replacing your layout' : 'Opens it in the editor'}
              >
                <LayoutThumbnail
                  modules={template.modules}
                  accessibilityLabel={`Preview of ${template.name}`}
                />
                <View style={styles.templateInfo}>
                  <View style={styles.templateTitleRow}>
                    <Text style={styles.templateName}>{template.name}</Text>
                    <View style={[styles.categoryBadge, { backgroundColor: `${category.color}20` }]}>
                      <Text style={[styles.categoryBadgeText, { color: category.color }]}>
                        {category.label}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.templateDescription}>{template.description}</Text>
                  <Text style={styles.widgetList} numberOfLines={2}>
                    {template.modules.length} widgets · {widgetNames(template)}
                  </Text>
                </View>
                {!confirming && (
                  <View style={styles.applyRow}>
                    <Text style={styles.applyButtonText}>Use this layout</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                  </View>
                )}
              </TouchableOpacity>

              {confirming && (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>
                    Replace your current layout? You can still edit before saving.
                  </Text>
                  <View style={styles.confirmButtons}>
                    <TouchableOpacity
                      style={styles.confirmCancel}
                      onPress={() => setConfirmingId(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Keep current layout"
                    >
                      <Text style={styles.confirmCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.confirmReplace}
                      onPress={() => applyAndNavigate(template)}
                      accessibilityRole="button"
                      accessibilityLabel={`Replace layout with ${template.name}`}
                    >
                      <Text style={styles.confirmReplaceText}>Replace</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {filteredTemplates.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No templates in this category</Text>
          </View>
        )}

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.infoText}>
            Templates use your mirror’s airport and location. After applying one you can move,
            resize or remove widgets before saving.
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
  filterContainer: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterScroll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  filterChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
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
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  templateCardConfirming: {
    borderColor: colors.warning,
  },
  templateInfo: {
    marginTop: spacing.md,
  },
  templateTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  templateName: {
    ...typography.h3,
    color: colors.text,
    flexShrink: 1,
  },
  templateDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  widgetList: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
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
  applyRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  applyButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  confirmRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  confirmText: {
    ...typography.bodySmall,
    color: colors.text,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmCancel: {
    flex: 1,
    minHeight: 44,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    ...typography.body,
    color: colors.text,
  },
  confirmReplace: {
    flex: 1,
    minHeight: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmReplaceText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.background,
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
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
});
