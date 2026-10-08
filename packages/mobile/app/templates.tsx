/**
 * Templates Screen
 * Browse and apply pre-built layout templates
 */

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  LAYOUT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TemplateCategory,
  LayoutTemplate,
} from '@/lib/templates';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

type FilterCategory = TemplateCategory | 'all';

export default function TemplatesScreen() {
  const params = useLocalSearchParams<{ hasModules?: string }>();
  const hasExistingModules = params.hasModules === 'true';
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');

  const filteredTemplates =
    selectedCategory === 'all'
      ? LAYOUT_TEMPLATES
      : LAYOUT_TEMPLATES.filter((t) => t.category === selectedCategory);

  const handleApplyTemplate = (template: LayoutTemplate) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (hasExistingModules) {
      Alert.alert(
        'Replace Layout?',
        `This will replace your current layout with "${template.name}". You can customize it before saving.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => applyAndNavigate(template),
          },
        ]
      );
    } else {
      applyAndNavigate(template);
    }
  };

  const applyAndNavigate = (template: LayoutTemplate) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Navigate back to editor with selected template
    router.replace({
      pathname: '/editor',
      params: { templateId: template.id },
    });
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose a Template</Text>
        <View style={styles.headerRight} />
      </View>

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
          >
            <View style={styles.templateHeader}>
              <View
                style={[
                  styles.templateIcon,
                  {
                    backgroundColor:
                      TEMPLATE_CATEGORIES[template.category]?.color + '20' ||
                      colors.primaryMuted,
                  },
                ]}
              >
                <Ionicons
                  name={template.icon as keyof typeof Ionicons.glyphMap}
                  size={28}
                  color={
                    TEMPLATE_CATEGORIES[template.category]?.color || colors.primary
                  }
                />
              </View>
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

              <View style={styles.applyButton}>
                <Text style={styles.applyButtonText}>Apply</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </View>
            </View>
          </TouchableOpacity>
        ))}

        {filteredTemplates.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No templates in this category</Text>
          </View>
        )}

        {/* Info footer */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.infoText}>
            Templates provide a starting point. After applying, you can customize the
            layout by moving, resizing, or removing modules.
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  headerRight: {
    width: 40,
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
  templateIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
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
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  applyButtonText: {
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
