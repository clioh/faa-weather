/**
 * "Add widget" sheet: searchable, filterable catalog in a page sheet.
 */

import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HeaderTextButton } from '@/components/ScreenHeader';
import {
  CATEGORIES,
  CATEGORY_ORDER,
  MODULES,
  SIZE_LABELS,
  type ModuleCategory,
  type ModuleDefinition,
} from '@/lib/modules';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.title}>Add widget</Text>
          <View style={[styles.headerSide, styles.headerRight]}>
            <HeaderTextButton label="Done" onPress={onClose} />
          </View>
        </View>

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
            <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
            {CATEGORY_ORDER.map((c) => (
              <FilterChip
                key={c}
                label={CATEGORIES[c].label}
                color={CATEGORIES[c].color}
                active={filter === c}
                onPress={() => setFilter(c)}
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
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <WidgetCard definition={item} noRoom={noRoomIds.has(item.id)} onPress={() => handleAdd(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyText}>No widgets match “{query.trim()}”</Text>
            </View>
          }
        />
        <EditorToast toast={toast} bottom={spacing.xl} />
      </View>
    </Modal>
  );
}

function FilterChip({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Show ${label}`}
    >
      {color ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
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
  const category = CATEGORIES[definition.category];
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, noRoom && styles.cardNoRoom]}
      accessibilityRole="button"
      accessibilityLabel={`Add ${definition.name}. ${definition.description}`}
      accessibilityHint={noRoom ? 'There is no room on the canvas for this widget' : undefined}
    >
      <View style={[styles.cardIcon, { backgroundColor: `${category.color}22` }]}>
        <Ionicons name={definition.icon as keyof typeof Ionicons.glyphMap} size={22} color={category.color} />
      </View>
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
            <Text key={s} style={[styles.badge, s === definition.defaultSize && styles.badgeDefault]}>
              {SIZE_LABELS[s]}
            </Text>
          ))
        )}
      </View>
    </TouchableOpacity>
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerSide: {
    minWidth: 76,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 0,
  },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.background,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: 12,
  },
  columns: {
    gap: 12,
  },
  card: {
    flex: 1,
    padding: 14,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cardNoRoom: {
    opacity: 0.55,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  cardName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  cardDesc: {
    ...typography.caption,
    color: colors.textMuted,
    minHeight: 32,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  badge: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surfaceHighlight,
    overflow: 'hidden',
  },
  badgeDefault: {
    color: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  badgeNoRoom: {
    color: colors.warning,
    backgroundColor: 'rgba(255, 170, 0, 0.14)',
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
