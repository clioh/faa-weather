/**
 * Template Selection Screen
 * Part of the onboarding flow - choose initial layout (portrait variants for a
 * portrait mirror)
 */

import { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Chip, Footer, Spinner, Text, TextButton } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useDisplayHold } from '@/hooks/useDisplayHold';
import { api, isPortrait } from '@/lib/api';
import { storage } from '@/lib/storage';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { HeaderBackButton, LayoutThumbnail } from '@/components';
import { goBack, goToDashboard } from '@/lib/navigation';
import { InlineError } from '@/components/ErrorToast';
import { logError } from '@/lib/errors';
import {
  TEMPLATE_CATEGORIES,
  TemplateCategory,
  TemplateOrientation,
  LayoutTemplate,
  templatesFor,
} from '@/lib/templates';
import { ModuleInstance } from '@/lib/modules';
import { colors, fonts, spacing, typography } from '@/lib/theme';

type FilterCategory = TemplateCategory | 'all';

export default function TemplateScreen() {
  const insets = useSafeAreaInsets();
  const { user, currentMirror } = useUser();
  // Keep the mirror on so the chosen layout appears on it right away.
  useDisplayHold(Boolean(currentMirror));
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<TemplateOrientation>('landscape');

  useEffect(() => {
    if (!currentMirror) return;
    let cancelled = false;
    api
      .getConfig()
      .then((config) => {
        if (!cancelled)
          setOrientation(isPortrait(config?.display?.orientation) ? 'portrait' : 'landscape');
      })
      .catch(() => {
        // Unreachable mirror: keep the landscape templates.
      });
    return () => {
      cancelled = true;
    };
  }, [currentMirror]);

  const templates = templatesFor(orientation);
  const portrait = orientation === 'portrait';
  const filteredTemplates =
    selectedCategory === 'all'
      ? templates
      : templates.filter((t) => t.category === selectedCategory);

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
      <View style={{ paddingTop: insets.top + spacing.xs }}>
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
          <InlineError message={error} onDismiss={() => setError(null)} />
        </View>
      )}

      {/* Category Filter */}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {categoryFilters.map((filter) => (
            <Chip
              key={filter.key}
              label={filter.label}
              selected={selectedCategory === filter.key}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedCategory(filter.key);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Templates List */}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={filteredTemplates.length > 0 ? styles.list : null}>
          {filteredTemplates.map((template) => (
            <Pressable
              key={template.id}
              style={({ pressed }) => [styles.templateRow, pressed && styles.pressed]}
              onPress={() => handleApplyTemplate(template)}
              disabled={applying !== null}
              accessibilityRole="button"
              accessibilityState={{ disabled: applying !== null, busy: applying === template.id }}
            >
              <LayoutThumbnail
                modules={template.modules}
                aspectRatio={portrait ? 9 / 16 : 16 / 9}
                style={portrait ? styles.thumbnailPortrait : styles.thumbnail}
                accessibilityLabel={`${template.name} layout preview${portrait ? ', portrait' : ''}`}
              />
              <View style={styles.templateInfo}>
                <Text style={styles.templateName}>{template.name}</Text>
                <Text style={styles.templateDescription}>{template.description}</Text>
                <Text style={styles.templateMeta}>
                  {template.modules.length} modules ·{' '}
                  {TEMPLATE_CATEGORIES[template.category]?.label || template.category}
                </Text>
              </View>
              {applying === template.id ? <Spinner /> : null}
            </Pressable>
          ))}
        </View>

        {filteredTemplates.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No templates in this category</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <Footer style={styles.footer}>
        <TextButton label="Skip for now" onPress={handleSkip} />
      </Footer>
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
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  filterScroll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  list: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  thumbnail: {
    width: 112,
  },
  // Same height as the landscape thumbnail (112 x 63).
  thumbnailPortrait: {
    width: 36,
  },
  templateInfo: {
    flex: 1,
    gap: 2,
  },
  templateName: {
    fontSize: 15,
    color: colors.text,
  },
  templateDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  templateMeta: {
    ...typography.caption,
    fontFamily: fonts.mono,
    color: colors.textMuted,
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
  footer: {
    paddingTop: spacing.xs,
  },
});
