/**
 * Airport Picker Component
 * Search and select airports by ICAO code
 */

import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Keyboard,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, borderRadius, typography, fonts } from '@/lib/theme';
import { ScreenHeader, HEADER_HIT_SLOP } from './ScreenHeader';

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

  const renderAirport = ({ item }: { item: Airport }) => (
    <TouchableOpacity
      style={[
        styles.airportItem,
        item.icao === currentValue && styles.airportItemSelected,
      ]}
      onPress={() => handleSelect(item)}
    >
      <View style={styles.airportIcon}>
        <Ionicons
          name="airplane"
          size={20}
          color={item.icao === currentValue ? colors.primary : colors.textMuted}
        />
      </View>
      <View style={styles.airportInfo}>
        <Text style={styles.airportIcao}>{item.icao}</Text>
        <Text style={styles.airportName}>{item.name}</Text>
        <Text style={styles.airportLocation}>
          {item.city}
          {item.country ? `, ${item.country}` : ''}
        </Text>
      </View>
      {item.icao === currentValue && (
        <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
      )}
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <ScreenHeader
          title="Select Airport"
          leftIcon="close"
          onLeftPress={handleClose}
          useTopInset={false}
        />

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by ICAO, name, or city..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={HEADER_HIT_SLOP}
              style={styles.clearButton}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Current Selection */}
        {currentValue && (
          <View style={styles.currentSelection}>
            <Text style={styles.currentLabel}>Current:</Text>
            <Text style={styles.currentValue}>{currentValue}</Text>
          </View>
        )}

        {/* Results */}
        <FlatList
          data={results}
          keyExtractor={(item) => item.icao}
          renderItem={renderAirport}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            searchQuery.length === 0 ? (
              <Text style={styles.sectionTitle}>Popular Airports</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="airplane-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>No airports found</Text>
              <Text style={styles.emptySubtext}>
                Enter a 4-letter ICAO code directly (e.g., KJFK)
              </Text>
            </View>
          }
        />

        {/* Info */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={styles.infoText}>
            Enter the 4-letter ICAO airport code (e.g., KJFK for JFK)
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  clearButton: {
    padding: spacing.sm,
    marginRight: -spacing.sm,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    height: '100%',
  },
  currentSelection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  currentLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  currentValue: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  airportItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  airportItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  airportIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  airportInfo: {
    flex: 1,
  },
  airportIcao: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    fontFamily: fonts.mono,
  },
  airportName: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  airportLocation: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  emptySubtext: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
  },
  infoText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    flex: 1,
  },
});
