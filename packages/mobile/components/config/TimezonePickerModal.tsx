/**
 * Searchable time-zone picker. Lists the curated zones and also accepts any
 * IANA name typed into the search box, so less common zones still work.
 */

import { useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { ScreenHeader, HEADER_HIT_SLOP } from '../ScreenHeader';
import { KeyboardAvoidingScreen } from '../KeyboardAvoidingScreen';
import { COMMON_TIMEZONES, isValidTimezone, timezoneOffsetLabel, type TimezoneOption } from './timezones';

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
  title = 'Time Zone',
  onSelect,
  onClose,
}: TimezonePickerModalProps) {
  const [query, setQuery] = useState('');

  // Offsets are computed once per open: cheap, and the list re-renders a lot while typing.
  const offsets = useMemo(() => {
    if (!visible) return {} as Record<string, string>;
    const now = new Date();
    return Object.fromEntries(COMMON_TIMEZONES.map((tz) => [tz.id, timezoneOffsetLabel(tz.id, now)]));
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
          <Text style={styles.zoneId}>{item.id}</Text>
        </View>
        {offsets[item.id] ? <Text style={styles.offset}>{offsets[item.id]}</Text> : null}
        {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.container}>
        <ScreenHeader title={title} leftIcon="close" onLeftPress={close} useTopInset={false} />
        <KeyboardAvoidingScreen>
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
              ) : null
            }
            ListEmptyComponent={
              customCandidate ? null : (
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
  container: { flex: 1, backgroundColor: colors.background },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.md,
    paddingLeft: spacing.md,
    minHeight: 44,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  searchInput: { flex: 1, color: colors.text, ...typography.body, paddingVertical: spacing.sm },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  rowSelected: { backgroundColor: colors.primaryMuted },
  rowText: { flex: 1 },
  city: { ...typography.body, color: colors.text },
  zoneId: { ...typography.caption, color: colors.textMuted },
  offset: { ...typography.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  customRow: { borderWidth: 1, borderColor: colors.borderFocus, marginBottom: spacing.sm },
  customText: { ...typography.body, color: colors.primary },
  empty: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', padding: spacing.xl },
});
