/**
 * Airport Setup Screen
 * Search and select home airport for aviation weather data
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, Airport } from '@/lib/api';
import { KeyboardAvoidingScreen, HEADER_HIT_SLOP } from '@/components';
import { goBack } from '@/lib/navigation';
import { Button, Field, Footer, Notice, Row, SectionLabel, Spinner, Text } from '@/components/ui';
import { colors, spacing, typography, fonts } from '@/lib/theme';

// Debounce helper. The timer lives in a ref so it survives re-renders;
// a per-render local would start a fresh timer on every keystroke.
function useDebounce<T extends (...args: never[]) => void>(callback: T, delay: number): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callbackRef.current(...args), delay);
    }) as T,
    [delay]
  );
}

export default function AirportSetupScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Airport[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Airport | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Airport[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(true);

  // Suggest airports near the location saved in the previous step.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const location = await api.getLocation();
        if (!location) return;
        const airports = await api.getNearbyAirports(location.latitude, location.longitude, 8);
        if (!cancelled) setNearby(airports);
      } catch (err) {
        console.warn('[AirportSetup] nearby lookup failed:', err);
      } finally {
        if (!cancelled) setLoadingNearby(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const searchAirports = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const airports = await api.searchAirports(searchQuery);
      setResults(airports);
    } catch (err) {
      console.warn('[AirportSetup] search failed:', err);
      setError(
        err instanceof Error
          ? `Failed to search airports: ${err.message}`
          : 'Failed to search airports'
      );
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const debouncedSearch = useDebounce(searchAirports, 300);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    setSelected(null);
    debouncedSearch(text);
  };

  const handleSelect = (airport: Airport) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(airport);
    setQuery(airport.icao);
    setResults([]);
  };

  const handleSave = async () => {
    if (!selected) return;

    setSaving(true);
    setError(null);

    try {
      await api.setAirport(selected.icao);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      goBack('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save airport');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const airportRow = (item: Airport, selectedRow = false) => (
    <Row
      leading={<Text style={[styles.icao, selectedRow && styles.icaoSelected]}>{item.icao}</Text>}
      title={item.name}
      caption={
        <>
          {item.city}
          {item.distanceNm !== undefined ? (
            <>
              {' · '}
              <Text style={styles.mono}>{item.distanceNm} NM</Text>
            </>
          ) : null}
        </>
      }
      selected={selectedRow}
      onPress={selectedRow ? undefined : () => handleSelect(item)}
      accessibilityLabel={`${item.icao}, ${item.name}, ${item.city}`}
      trailing={
        selectedRow ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : undefined
      }
      chevron={false}
    />
  );

  const renderAirport = ({ item }: { item: Airport }) => airportRow(item);

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <View style={styles.content}>
        {/* Instructions */}
        <Text style={styles.instructionsText}>
          {nearby.length > 0
            ? 'Pick an airport near you, or search by ICAO code, city or name'
            : "Enter your home airport's ICAO code (e.g., KJFK, KLAX) or search by name"}
        </Text>

        {/* Search input */}
        <Field
          icon="search"
          mono
          placeholder="Search airports..."
          accessibilityLabel="Search airports"
          value={query}
          onChangeText={handleQueryChange}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          trailing={
            query.length > 0 ? (
              <TouchableOpacity
                style={styles.clearButton}
                hitSlop={HEADER_HIT_SLOP}
                accessibilityLabel="Clear search"
                onPress={() => {
                  setQuery('');
                  setSelected(null);
                  setResults([]);
                }}
              >
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ) : undefined
          }
        />

        {/* Selected airport display */}
        {selected && (
          <View>
            <SectionLabel>Selected Airport</SectionLabel>
            {airportRow(selected, true)}
          </View>
        )}

        {/* Search results */}
        {!selected && (
          <View style={styles.resultsContainer}>
            {searching ? (
              <View style={styles.loadingContainer}>
                <Spinner />
                <Text style={styles.loadingText}>Searching...</Text>
              </View>
            ) : results.length > 0 ? (
              <FlatList
                data={results}
                renderItem={renderAirport}
                keyExtractor={(item) => item.icao}
                style={styles.resultsList}
                contentContainerStyle={styles.listRows}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              />
            ) : query.length >= 2 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="airplane-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>No airports found</Text>
              </View>
            ) : nearby.length > 0 ? (
              <>
                <SectionLabel>Near your location</SectionLabel>
                <FlatList
                  data={nearby}
                  renderItem={renderAirport}
                  keyExtractor={(item) => item.icao}
                  style={styles.resultsList}
                  contentContainerStyle={styles.listRows}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                />
              </>
            ) : loadingNearby ? (
              <View style={styles.loadingContainer}>
                <Spinner />
                <Text style={styles.loadingText}>Finding airports near you...</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Error message */}
        {error && <Notice tone="error" message={error} />}
      </View>

      {/* Save button */}
      <Footer>
        <Button label="Save airport" onPress={handleSave} disabled={!selected} loading={saving} />
      </Footer>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: 20,
  },
  instructionsText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  clearButton: {
    width: 44,
    height: 44,
    marginRight: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsContainer: {
    flex: 1,
  },
  resultsList: {
    flex: 1,
  },
  listRows: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  icao: {
    width: 56,
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.text,
  },
  icaoSelected: {
    fontFamily: fonts.monoMedium,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
