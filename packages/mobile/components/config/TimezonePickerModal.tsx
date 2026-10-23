/**
 * Searchable time-zone picker. Lists the curated zones and also accepts any
 * IANA name typed into the search box, so less common zones still work.
 */

import { useMemo, useState } from 'react';
import { FlatList, Keyboard, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { PageSheetHeader, Text, TextInput } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, typography, fonts } from '@/lib/theme';
import { HEADER_HIT_SLOP } from '../ScreenHeader';
import { KeyboardAvoidingScreen } from '../KeyboardAvoidingScreen';
import {
  COMMON_TIMEZONES,
  isValidTimezone,
  timezoneOffsetLabel,
  type TimezoneOption,
} from './timezones';

interface TimezonePickerModalProps {
  visible: boolean;
  currentValue?: string;
  title?: string;
  onSelect: (timezone: string) => void;
  onClose: () => void;
}

export function TimezonePickerModal({
  visible,
  currentValue,
  title = 'Time zone',
  onSelect,
  onClose,
}: TimezonePickerModalProps) {
  const [query, setQuery] = useState('');

  // Offsets are computed once per open: cheap, and the list re-renders a lot while typing.
  const offsets = useMemo(() => {
    if (!visible) return {} as Record<string, string>;
    const now = new Date();
    return Object.fromEntries(
      COMMON_TIMEZONES.map((tz) => [tz.id, timezoneOffsetLabel(tz.id, now)])
    );
  }, [visible]);

  const trimmed = query.trim();
  const results = useMemo(() => {
    if (!trimmed) return COMMON_TIMEZONES;
    const q = trimmed.toLowerCase().replace(/\s+/g, '_');
    const qSpaced = trimmed.toLowerCase();
    return COMMON_TIMEZONES.filter(
      (tz) =>
        tz.id.toLowerCase().includes(q) ||
        tz.city.toLowerCase().includes(qSpaced) ||
        tz.region.toLowerCase().includes(qSpaced) ||
        (offsets[tz.id] ?? '').toLowerCase().includes(qSpaced)
    );
  }, [trimmed, offsets]);

  const customCandidate =
    trimmed.includes('/') &&
    !results.some((tz) => tz.id.toLowerCase() === trimmed.toLowerCase()) &&
    isValidTimezone(trimmed)
      ? trimmed
      : null;

  const close = () => {
    setQuery('');
    Keyboard.dismiss();
    onClose();
  };

  const pick = (id: string) => {
    Haptics.selectionAsync();
    setQuery('');
    Keyboard.dismiss();
    onSelect(id);
  };

  const renderItem = ({ item }: { item: TimezoneOption }) => {
    const selected = item.id === currentValue;
    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected]}
        onPress={() => pick(item.id)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${item.city}, ${item.id}${offsets[item.id] ? `, ${offsets[item.id]}` : ''}`}
      >
        <View style={styles.rowText}>
          <Text style={styles.city}>{item.city}</Text>
          <Text style={[styles.zoneId, item.id.includes('/') && styles.mono]}>{item.id}</Text>
        </View>
        {offsets[item.id] ? <Text style={styles.offset}>{offsets[item.id]}</Text> : null}
        {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <View style={styles.container}>
        <PageSheetHeader title={title} onClose={close} />
        {/* iOS: the FlatList insets itself (exact in a page sheet); Android: padding. */}
        <KeyboardAvoidingScreen avoidOnIOS={false}>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="City, region or IANA name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => customCandidate && pick(customCandidate)}
              accessibilityLabel="Search time zones"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={HEADER_HIT_SLOP}
                style={styles.clear}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            automaticallyAdjustKeyboardInsets
            ListHeaderComponent={
              customCandidate ? (
                <TouchableOpacity
                  style={[styles.row, styles.customRow]}
                  onPress={() => pick(customCandidate)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${customCandidate}`}
                >
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={styles.customText}>Use “{customCandidate}”</Text>
                </TouchableOpacity>
              ) : undefined
            }
            ListEmptyComponent={
              customCandidate ? undefined : (
                <Text style={styles.empty}>
                  No match. Type a full IANA name such as Europe/Paris.
                </Text>
              )
            }
          />
        </KeyboardAvoidingScreen>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: spacing.xs,
    marginBottom: 14,
    paddingLeft: 14,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    gap: 10,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: spacing.xxl },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  rowSelected: {
    backgroundColor: colors.primarySelected,
    borderTopColor: 'transparent',
    borderRadius: 12,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  rowText: { flex: 1, gap: 2 },
  city: { fontSize: 15, color: colors.text },
  zoneId: { ...typography.caption, color: colors.textMuted },
  mono: { fontFamily: fonts.mono },
  offset: { fontFamily: fonts.mono, fontSize: 13, color: colors.textSecondary },
  customRow: { borderTopColor: 'transparent' },
  customText: { fontSize: 15, color: colors.primary },
  empty: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    padding: spacing.xl,
  },
});
