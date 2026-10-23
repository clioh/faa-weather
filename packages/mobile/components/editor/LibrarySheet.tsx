/**
 * "Add widget" sheet: searchable, filterable catalog in a page sheet.
 */

import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip, PageSheetHeader, Text, TextInput } from '@/components/ui';
import { KeyboardAvoidingScreen } from '@/components/KeyboardAvoidingScreen';
import {
  CATEGORIES,
  CATEGORY_ORDER,
  MODULES,
  SIZE_LABELS,
  type ModuleCategory,
  type ModuleDefinition,
} from '@/lib/modules';
import { colors, spacing, typography } from '@/lib/theme';
import { EditorToast, useEditorToast } from './Toast';

interface LibrarySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Returns false when the widget could not be placed (grid full). */
  onAdd: (definition: ModuleDefinition) => boolean;
  /** Ids that cannot fit at any of their sizes right now. */
  noRoomIds: Set<string>;
}

type Filter = 'all' | ModuleCategory;

export function LibrarySheet({ visible, onClose, onAdd, noRoomIds }: LibrarySheetProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const { toast, show } = useEditorToast();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MODULES.filter((m) => filter === 'all' || m.category === filter)
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          CATEGORIES[m.category].label.toLowerCase().includes(q)
      )
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  }, [query, filter]);

  const handleAdd = (def: ModuleDefinition) => {
    if (!onAdd(def)) show('No room — remove or shrink a widget', 'error');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <PageSheetHeader title="Add widget" action={{ label: 'Done', onPress: onClose }} />
        {/* iOS: the ScrollView/FlatList insets itself (exact in a page sheet); Android: padding. */}
        <KeyboardAvoidingScreen avoidOnIOS={false}>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search widgets"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              accessibilityLabel="Search widgets"
            />
          </View>

          <View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
              keyboardShouldPersistTaps="handled"
            >
              <Chip
                label="All"
                selected={filter === 'all'}
                onPress={() => setFilter('all')}
                accessibilityLabel="Show all"
              />
              {CATEGORY_ORDER.map((c) => (
                <Chip
                  key={c}
                  label={CATEGORIES[c].label}
                  selected={filter === c}
                  onPress={() => setFilter(c)}
                  accessibilityLabel={`Show ${CATEGORIES[c].label}`}
                />
              ))}
            </ScrollView>
          </View>

          <FlatList
            data={results}
            keyExtractor={(m) => m.id}
            numColumns={2}
            columnWrapperStyle={styles.columns}
            contentContainerStyle={styles.list}
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => (
              <WidgetCard
                definition={item}
                noRoom={noRoomIds.has(item.id)}
                onPress={() => handleAdd(item)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={28} color={colors.textMuted} />
                <Text style={styles.emptyText}>No widgets match “{query.trim()}”</Text>
              </View>
            }
          />
          <EditorToast toast={toast} bottom={spacing.xl} />
        </KeyboardAvoidingScreen>
      </View>
    </Modal>
  );
}

function WidgetCard({
  definition,
  noRoom,
  onPress,
}: {
  definition: ModuleDefinition;
  noRoom: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        noRoom && styles.cardNoRoom,
        pressed && styles.cardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Add ${definition.name}. ${definition.description}`}
      accessibilityHint={noRoom ? 'There is no room on the canvas for this widget' : undefined}
    >
      <Text style={styles.cardName} numberOfLines={1}>
        {definition.name}
      </Text>
      <Text style={styles.cardDesc} numberOfLines={2}>
        {definition.description}
      </Text>
      <View style={styles.badges}>
        {noRoom ? (
          <Text style={[styles.badge, styles.badgeNoRoom]}>No room</Text>
        ) : (
          definition.sizes.map((s) => (
            <Text
              key={s}
              style={[styles.badge, s === definition.defaultSize && styles.badgeDefault]}
            >
              {SIZE_LABELS[s]}
            </Text>
          ))
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: spacing.xs,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: spacing.xxl,
    gap: 10,
  },
  columns: {
    gap: 10,
  },
  card: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.sheetBorder,
    gap: 6,
  },
  cardNoRoom: {
    opacity: 0.45,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  cardName: {
    fontSize: 14,
    color: colors.text,
  },
  cardDesc: {
    ...typography.caption,
    color: colors.textMuted,
    minHeight: 34,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingTop: 2,
  },
  badge: {
    fontSize: 10,
    color: colors.textSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.thumbTileBorder,
    overflow: 'hidden',
  },
  badgeDefault: {
    color: colors.primary,
    borderColor: colors.badgeBorder,
  },
  badgeNoRoom: {
    color: colors.warning,
    borderColor: colors.badgeWarningBorder,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
});
