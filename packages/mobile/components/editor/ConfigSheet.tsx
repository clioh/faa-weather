/**
 * Configure sheet for one tile. Edits stream straight into the working
 * layout (and so onto the mirror preview); the editor records the whole
 * session as a single undo step when the sheet closes.
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { HeaderTextButton } from '@/components/ScreenHeader';
import { ModuleConfigForm } from '@/components/ModuleConfigForm';
import { TodoManager } from '@/components/config/TodoManager';
import { PhotoManager } from '@/components/config/PhotoManager';
import { CATEGORIES, SIZE_LABELS, type ModuleDefinition, type ModuleInstance, type ModuleSize } from '@/lib/modules';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { SizeChips, type SizeOption } from './SizeChips';

interface ConfigSheetProps {
  visible: boolean;
  instance: ModuleInstance | null;
  definition: ModuleDefinition | undefined;
  sizeOptions: SizeOption[];
  onChangeConfig: (config: Record<string, unknown>) => void;
  onChangeSize: (size: ModuleSize) => void;
  onRemove: () => void;
  onDone: () => void;
}

export function ConfigSheet({
  visible,
  instance,
  definition,
  sizeOptions,
  onChangeConfig,
  onChangeSize,
  onRemove,
  onDone,
}: ConfigSheetProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [blockedHint, setBlockedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setConfirmRemove(false);
      setBlockedHint(null);
    }
  }, [visible]);

  const category = definition ? CATEGORIES[definition.category] : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onDone}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <View style={styles.headerCenter}>
            {category && definition ? (
              <View style={[styles.headerIcon, { backgroundColor: `${category.color}22` }]}>
                <Ionicons
                  name={definition.icon as keyof typeof Ionicons.glyphMap}
                  size={16}
                  color={category.color}
                />
              </View>
            ) : null}
            <Text style={styles.title} numberOfLines={1}>
              {definition?.name ?? 'Widget'}
            </Text>
          </View>
          <View style={[styles.headerSide, styles.headerRight]}>
            <HeaderTextButton label="Done" onPress={onDone} />
          </View>
        </View>

        {instance && (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            // A KeyboardAvoidingView mis-measures inside an iOS pageSheet (the
            // sheet is inset from the window top), leaving fields under the
            // keyboard. Letting the ScrollView inset itself is exact; Android
            // modals resize with the window.
            automaticallyAdjustKeyboardInsets
          >
            {definition ? (
              definition.configFields.length > 0 ? (
                <ModuleConfigForm
                  definition={definition}
                  config={instance.config ?? {}}
                  onChange={onChangeConfig}
                />
              ) : definition.manages ? null : (
                <Text style={styles.noSettings}>This widget has no settings.</Text>
              )
            ) : (
              <Text style={styles.noSettings}>
                This widget is no longer available in SkyGlass. Remove it to free up its space.
              </Text>
            )}

            {/* Data that lives on the mirror rather than in the widget config. */}
            {definition?.manages === 'todos' && <TodoManager />}
            {definition?.manages === 'photos' && <PhotoManager />}
            {definition?.manages === 'calendars' && (
              <TouchableOpacity
                style={styles.linkRow}
                onPress={() => {
                  // Close the sheet first: a pushed screen would sit under the modal.
                  onDone();
                  router.push('/calendars');
                }}
                accessibilityRole="button"
                accessibilityLabel="Manage calendars"
                accessibilityHint="Connect and manage the calendars shown on the mirror"
              >
                <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                <Text style={styles.linkText}>Manage calendars</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {sizeOptions.length > 1 && instance && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Size</Text>
                <SizeChips
                  wrap
                  options={sizeOptions}
                  current={instance.size}
                  onSelect={(s) => {
                    setBlockedHint(null);
                    onChangeSize(s);
                  }}
                  onBlocked={(s) =>
                    setBlockedHint(`No room for ${SIZE_LABELS[s]} where this widget sits. Move it or shrink a neighbour.`)
                  }
                />
                {blockedHint ? <Text style={styles.blocked}>{blockedHint}</Text> : null}
              </View>
            )}

            <TouchableOpacity
              onPress={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
              style={[styles.remove, confirmRemove && styles.removeConfirm]}
              accessibilityRole="button"
              accessibilityLabel={confirmRemove ? 'Confirm remove widget' : 'Remove widget'}
            >
              <Ionicons name="trash-outline" size={18} color={confirmRemove ? colors.text : colors.error} />
              <Text style={[styles.removeText, confirmRemove && styles.removeTextConfirm]}>
                {confirmRemove ? 'Tap again to remove' : 'Remove widget'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerSide: {
    minWidth: 76,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    flexShrink: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  noSettings: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  blocked: {
    ...typography.caption,
    color: colors.warning,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 68, 68, 0.4)',
    marginTop: spacing.md,
  },
  removeConfirm: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  removeText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.error,
  },
  removeTextConfirm: {
    color: colors.text,
  },
});
