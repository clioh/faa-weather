/**
 * Configure sheet for one tile. Edits stream straight into the working
 * layout (and so onto the mirror preview); the editor records the whole
 * session as a single undo step when the sheet closes.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { PageSheetHeader, Row, RowGroup, SectionLabel, Text } from '@/components/ui';
import { KeyboardAvoidingScreen } from '@/components/KeyboardAvoidingScreen';
import { ModuleConfigForm } from '@/components/ModuleConfigForm';
import { TodoManager } from '@/components/config/TodoManager';
import { PhotoManager } from '@/components/config/PhotoManager';
import {
  SIZE_LABELS,
  type ModuleDefinition,
  type ModuleInstance,
  type ModuleSize,
} from '@/lib/modules';
import { colors, spacing, typography } from '@/lib/theme';
import { SizeChips, type SizeOption } from './SizeChips';

const CONFIRM_TIMEOUT_MS = 3500;

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

  // Like the selection bar: an unanswered "Tap again to remove" goes away.
  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDone}
    >
      <View style={styles.container}>
        <PageSheetHeader
          title={definition?.name ?? 'Widget'}
          icon={definition ? (definition.icon as keyof typeof Ionicons.glyphMap) : undefined}
          action={{ label: 'Done', onPress: onDone }}
        />
        {/* iOS: the ScrollView/FlatList insets itself (exact in a page sheet); Android: padding. */}
        <KeyboardAvoidingScreen avoidOnIOS={false}>
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
                <RowGroup>
                  <Row
                    icon="calendar-outline"
                    title="Manage calendars"
                    onPress={() => {
                      // Close the sheet first: a pushed screen would sit under the modal.
                      onDone();
                      router.push('/calendars');
                    }}
                    accessibilityLabel="Manage calendars"
                    accessibilityHint="Connect and manage the calendars shown on the mirror"
                  />
                </RowGroup>
              )}

              {sizeOptions.length > 1 && instance && (
                <View style={styles.section}>
                  <SectionLabel style={styles.sectionLabel}>Size</SectionLabel>
                  <SizeChips
                    wrap
                    options={sizeOptions}
                    current={instance.size}
                    onSelect={(s) => {
                      setBlockedHint(null);
                      onChangeSize(s);
                    }}
                    onBlocked={(s) =>
                      setBlockedHint(
                        `No room for ${SIZE_LABELS[s]} where this widget sits. Move it or shrink a neighbour.`
                      )
                    }
                  />
                  {blockedHint ? <Text style={styles.blocked}>{blockedHint}</Text> : null}
                </View>
              )}

              <Pressable
                onPress={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
                style={({ pressed }) => [
                  styles.remove,
                  confirmRemove && styles.removeConfirm,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={confirmRemove ? 'Confirm remove widget' : 'Remove widget'}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={confirmRemove ? colors.background : colors.danger}
                />
                <Text style={[styles.removeText, confirmRemove && styles.removeTextConfirm]}>
                  {confirmRemove ? 'Tap again to remove' : 'Remove widget'}
                </Text>
              </Pressable>
            </ScrollView>
          )}
        </KeyboardAvoidingScreen>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: spacing.xxl,
    gap: 22,
  },
  noSettings: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  section: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 18,
  },
  sectionLabel: {
    marginBottom: 0,
  },
  blocked: {
    ...typography.caption,
    color: colors.textMuted,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    marginTop: 6,
  },
  removeConfirm: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  pressed: {
    opacity: 0.7,
  },
  removeText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.danger,
  },
  removeTextConfirm: {
    color: colors.background,
  },
});
