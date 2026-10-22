/**
 * Templates Screen
 * Browse starting layouts as miniature mirror previews and apply one to the editor.
 */

import { useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Badge, Button, Chip, Notice, Text } from '@/components/ui';
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

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {CATEGORY_FILTERS.map((filter) => (
            <Chip
              key={filter.key}
              label={filter.label}
              selected={selectedCategory === filter.key}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedCategory(filter.key);
                setConfirmingId(null);
              }}
              accessibilityLabel={`${filter.label} templates`}
            />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {filteredTemplates.map((template) => {
          const category = TEMPLATE_CATEGORIES[template.category];
          const confirming = confirmingId === template.id;
          return (
            <View key={template.id} style={[styles.templateCard, confirming && styles.templateCardConfirming]}>
              <Pressable
                onPress={() => handleApplyTemplate(template)}
                style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${template.name}. ${template.description}. ${template.modules.length} widgets: ${widgetNames(template)}`}
                accessibilityHint={hasExistingModules ? 'Asks before replacing your layout' : 'Opens it in the editor'}
              >
                <LayoutThumbnail
                  modules={template.modules}
                  style={styles.thumbnail}
                  accessibilityLabel={`Preview of ${template.name}`}
                />
                <View style={styles.templateTitleRow}>
                  <Text style={styles.templateName}>{template.name}</Text>
                  <Badge label={category.label} />
                </View>
                <Text style={styles.templateDescription}>{template.description}</Text>
                <Text style={styles.widgetList} numberOfLines={2}>
                  {template.modules.length} widgets · {widgetNames(template)}
                </Text>
                {!confirming && (
                  <View style={styles.applyRow}>
                    <Text style={styles.applyButtonText}>Use this layout</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                  </View>
                )}
              </Pressable>

              {confirming && (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>
                    Replace your current layout? You can still edit before saving.
                  </Text>
                  <View style={styles.confirmButtons}>
                    <Button
                      label="Cancel"
                      variant="secondary"
                      size="small"
                      onPress={() => setConfirmingId(null)}
                      accessibilityLabel="Keep current layout"
                      style={styles.confirmButton}
                    />
                    <Button
                      label="Replace"
                      size="small"
                      onPress={() => applyAndNavigate(template)}
                      accessibilityLabel={`Replace layout with ${template.name}`}
                      style={styles.confirmButton}
                    />
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {filteredTemplates.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No templates in this category</Text>
          </View>
        )}

        <Notice
          tone="info"
          message="Templates use your mirror’s airport and location. After applying one you can move, resize or remove widgets before saving."
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filterScroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
    paddingBottom: spacing.xxl,
    gap: 18,
  },
  templateCard: {
    borderRadius: borderRadius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.sheetBorder,
  },
  templateCardConfirming: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySelected,
  },
  cardBody: {
    gap: 10,
  },
  pressed: {
    opacity: 0.75,
  },
  thumbnail: {
    borderRadius: 8,
  },
  templateTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  templateName: {
    fontSize: 17,
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
  },
  applyRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: -spacing.xs,
  },
  applyButtonText: {
    fontSize: 15,
    color: colors.primary,
  },
  confirmRow: {
    marginTop: 12,
    gap: 10,
  },
  confirmText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmButton: {
    flex: 1,
    alignSelf: 'auto',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
