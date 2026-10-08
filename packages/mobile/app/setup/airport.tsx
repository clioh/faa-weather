/**
 * Airport Setup Screen
 * Search and select home airport for aviation weather data
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, Airport } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

// Debounce helper
function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  let timeoutId: ReturnType<typeof setTimeout>;

  return ((...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  }) as T;
}

export default function AirportSetupScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Airport[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Airport | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError('Failed to search airports');
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
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save airport');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const renderAirport = ({ item }: { item: Airport }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleSelect(item)}
    >
      <View style={styles.resultIcon}>
        <Ionicons name="airplane" size={20} color={colors.primary} />
      </View>
      <View style={styles.resultContent}>
        <Text style={styles.resultIcao}>{item.icao}</Text>
        <Text style={styles.resultName}>{item.name}</Text>
        <Text style={styles.resultCity}>{item.city}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        {/* Instructions */}
        <View style={styles.instructions}>
          <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
          <Text style={styles.instructionsText}>
            Enter your home airport's ICAO code (e.g., KJFK, KLAX) or search by name
          </Text>
        </View>

        {/* Search input */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search airports..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleQueryChange}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery('');
                setSelected(null);
                setResults([]);
              }}
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Selected airport display */}
        {selected && (
          <View style={styles.selectedContainer}>
            <View style={styles.selectedHeader}>
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              <Text style={styles.selectedLabel}>Selected Airport</Text>
            </View>
            <View style={styles.selectedCard}>
              <Text style={styles.selectedIcao}>{selected.icao}</Text>
              <Text style={styles.selectedName}>{selected.name}</Text>
              <Text style={styles.selectedCity}>{selected.city}</Text>
            </View>
          </View>
        )}

        {/* Search results */}
        {!selected && (
          <View style={styles.resultsContainer}>
            {searching ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loadingText}>Searching...</Text>
              </View>
            ) : results.length > 0 ? (
              <FlatList
                data={results}
                renderItem={renderAirport}
                keyExtractor={(item) => item.icao}
                style={styles.resultsList}
                showsVerticalScrollIndicator={false}
              />
            ) : query.length >= 2 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="airplane-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>No airports found</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Error message */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="warning-outline" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>

      {/* Save button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, !selected && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!selected || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color={colors.background} />
              <Text style={styles.saveButtonText}>Save Airport</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  instructions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.accentMuted,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  instructionsText: {
    ...typography.bodySmall,
    color: colors.accent,
    flex: 1,
    lineHeight: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
  },
  selectedContainer: {
    marginBottom: spacing.lg,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  selectedLabel: {
    ...typography.label,
    color: colors.primary,
  },
  selectedCard: {
    padding: spacing.lg,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  selectedIcao: {
    ...typography.h2,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  selectedName: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  selectedCity: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  resultsContainer: {
    flex: 1,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  resultsList: {
    flex: 1,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  resultContent: {
    flex: 1,
  },
  resultIcao: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
  resultName: {
    ...typography.bodySmall,
    color: colors.text,
  },
  resultCity: {
    ...typography.caption,
    color: colors.textMuted,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  saveButtonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  saveButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
