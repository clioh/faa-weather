/**
 * Airport Picker Component
 * Search and select airports by ICAO code
 */

import { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, FlatList, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Field, PageSheetHeader, Row, SectionLabel, Text } from '@/components/ui';
import { KeyboardAvoidingScreen } from '@/components/KeyboardAvoidingScreen';
import { colors, spacing, typography, fonts } from '@/lib/theme';
import { HEADER_HIT_SLOP } from './ScreenHeader';

interface Airport {
  icao: string;
  name: string;
  city: string;
  country: string;
}

// Common airports for quick selection
const POPULAR_AIRPORTS: Airport[] = [
  { icao: 'KJFK', name: 'John F Kennedy Intl', city: 'New York', country: 'USA' },
  { icao: 'KLAX', name: 'Los Angeles Intl', city: 'Los Angeles', country: 'USA' },
  { icao: 'KORD', name: "O'Hare Intl", city: 'Chicago', country: 'USA' },
  { icao: 'KATL', name: 'Hartsfield-Jackson', city: 'Atlanta', country: 'USA' },
  { icao: 'KSFO', name: 'San Francisco Intl', city: 'San Francisco', country: 'USA' },
  { icao: 'KDEN', name: 'Denver Intl', city: 'Denver', country: 'USA' },
  { icao: 'KDFW', name: 'Dallas/Fort Worth', city: 'Dallas', country: 'USA' },
  { icao: 'KBOS', name: 'Logan Intl', city: 'Boston', country: 'USA' },
  { icao: 'KSEA', name: 'Seattle-Tacoma Intl', city: 'Seattle', country: 'USA' },
  { icao: 'KMIA', name: 'Miami Intl', city: 'Miami', country: 'USA' },
  { icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'UK' },
  { icao: 'LFPG', name: 'Charles de Gaulle', city: 'Paris', country: 'France' },
];

interface AirportPickerProps {
  visible: boolean;
  currentValue?: string;
  onSelect: (icao: string) => void;
  onClose: () => void;
}

export function AirportPicker({
  visible,
  currentValue,
  onSelect,
  onClose,
}: AirportPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Airport[]>([]);

  // Filter airports based on search query
  useEffect(() => {
    if (searchQuery.length === 0) {
      setResults(POPULAR_AIRPORTS);
      return;
    }

    const query = searchQuery.toUpperCase();
    const filtered = POPULAR_AIRPORTS.filter(
      (airport) =>
        airport.icao.includes(query) ||
        airport.name.toUpperCase().includes(query) ||
        airport.city.toUpperCase().includes(query)
    );

    // If query looks like an ICAO code (4 letters), add it as an option
    if (query.length === 4 && /^[A-Z]{4}$/.test(query)) {
      const exists = filtered.some((a) => a.icao === query);
      if (!exists) {
        filtered.unshift({
          icao: query,
          name: 'Custom Airport',
          city: 'Enter manually',
          country: '',
        });
      }
    }

    setResults(filtered);
  }, [searchQuery]);

  const handleSelect = (airport: Airport) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(airport.icao);
    setSearchQuery('');
    Keyboard.dismiss();
  };

  const handleClose = () => {
    setSearchQuery('');
    Keyboard.dismiss();
    onClose();
  };

  const renderAirport = ({ item }: { item: Airport }) => {
    const selected = item.icao === currentValue;
    return (
      <Row
        leading={<Text style={styles.icao}>{item.icao}</Text>}
        title={item.name}
        caption={`${item.city}${item.country ? `, ${item.country}` : ''}`}
        selected={selected}
        onPress={() => handleSelect(item)}
        accessibilityLabel={`${item.icao}, ${item.name}`}
        trailing={selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : undefined}
        chevron={false}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <PageSheetHeader title="Select Airport" onClose={handleClose} />
        {/* iOS: the ScrollView/FlatList insets itself (exact in a page sheet); Android: padding. */}
        <KeyboardAvoidingScreen avoidOnIOS={false}>
          <View style={styles.top}>
            {/* Search Input */}
            <Field
              icon="search"
              placeholder="Search by ICAO, name, or city..."
              accessibilityLabel="Search airports"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              trailing={
                searchQuery.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    hitSlop={HEADER_HIT_SLOP}
                    style={styles.clearButton}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : undefined
              }
            />

            {/* Current Selection */}
            {currentValue && (
              <Text style={styles.caption}>
                Current: <Text style={styles.currentValue}>{currentValue}</Text>
              </Text>
            )}
          </View>

          {/* Results */}
          <FlatList
            data={results}
            keyExtractor={(item) => item.icao}
            renderItem={renderAirport}
            contentContainerStyle={styles.listContent}
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              searchQuery.length === 0 ? <SectionLabel>Popular Airports</SectionLabel> : null
            }
            ListFooterComponent={results.length > 0 ? <View style={styles.listEnd} /> : null}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="airplane-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>No airports found</Text>
                <Text style={styles.emptySubtext}>
                  Enter a 4-letter ICAO code directly (e.g., KJFK)
                </Text>
              </View>
            }
          />

          {/* Info */}
          <Text style={[styles.caption, styles.info]}>
            Enter the 4-letter ICAO airport code (e.g., KJFK for JFK)
          </Text>
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
  top: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  clearButton: {
    width: 44,
    height: 44,
    marginRight: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  currentValue: {
    fontFamily: fonts.mono,
    color: colors.text,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: spacing.xl,
  },
  // Bottom hairline under the last row, like a RowGroup.
  listEnd: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  icao: {
    width: 56,
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.text,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
  emptySubtext: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
  },
  info: {
    paddingHorizontal: 20,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
});
