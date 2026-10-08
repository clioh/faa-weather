/**
 * Location Setup Screen
 * Set location for astronomical data (sunrise/sunset)
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

interface LocationData {
  latitude: number;
  longitude: number;
  timezone: string;
}

export default function LocationSetupScreen() {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we already have a location saved
  useEffect(() => {
    checkExistingLocation();
  }, []);

  const checkExistingLocation = async () => {
    try {
      const existing = await api.getLocation();
      if (existing) {
        setLocation(existing);
      }
    } catch {
      // No existing location
    }
  };

  const detectLocation = async () => {
    setDetecting(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Location permission is needed to automatically detect your position. You can also enter coordinates manually.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Get current location
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Get timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timezone,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError('Failed to detect location. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    if (!location) return;

    setSaving(true);
    setError(null);

    try {
      await api.setLocation(location);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save location');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const formatCoordinate = (value: number, isLat: boolean): string => {
    const direction = isLat
      ? value >= 0 ? 'N' : 'S'
      : value >= 0 ? 'E' : 'W';
    return `${Math.abs(value).toFixed(4)}° ${direction}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Instructions */}
        <View style={styles.instructions}>
          <Ionicons name="location-outline" size={20} color={colors.accent} />
          <Text style={styles.instructionsText}>
            Your location is used to calculate accurate sunrise, sunset, and twilight times for pilot currency tracking
          </Text>
        </View>

        {/* Location card */}
        <View style={styles.locationCard}>
          {location ? (
            <>
              <View style={styles.locationHeader}>
                <View style={styles.locationIconContainer}>
                  <Ionicons name="checkmark-circle" size={32} color={colors.primary} />
                </View>
                <Text style={styles.locationTitle}>Location Set</Text>
              </View>

              <View style={styles.coordinatesContainer}>
                <View style={styles.coordinateRow}>
                  <Text style={styles.coordinateLabel}>Latitude</Text>
                  <Text style={styles.coordinateValue}>
                    {formatCoordinate(location.latitude, true)}
                  </Text>
                </View>
                <View style={styles.coordinateRow}>
                  <Text style={styles.coordinateLabel}>Longitude</Text>
                  <Text style={styles.coordinateValue}>
                    {formatCoordinate(location.longitude, false)}
                  </Text>
                </View>
                <View style={styles.coordinateRow}>
                  <Text style={styles.coordinateLabel}>Timezone</Text>
                  <Text style={styles.coordinateValue}>{location.timezone}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.updateButton}
                onPress={detectLocation}
                disabled={detecting}
              >
                {detecting ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={18} color={colors.text} />
                    <Text style={styles.updateButtonText}>Update Location</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.detectContainer}>
                <View style={styles.detectIconContainer}>
                  <Ionicons name="navigate-outline" size={48} color={colors.primary} />
                </View>
                <Text style={styles.detectTitle}>Detect Your Location</Text>
                <Text style={styles.detectSubtitle}>
                  Tap below to automatically detect your current location using your phone's GPS
                </Text>

                <TouchableOpacity
                  style={styles.detectButton}
                  onPress={detectLocation}
                  disabled={detecting}
                >
                  {detecting ? (
                    <ActivityIndicator size="small" color={colors.background} />
                  ) : (
                    <>
                      <Ionicons name="locate" size={20} color={colors.background} />
                      <Text style={styles.detectButtonText}>Detect Location</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Privacy note */}
        <View style={styles.privacyNote}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
          <Text style={styles.privacyNoteText}>
            Your location is stored locally on your mirror and never shared with third parties
          </Text>
        </View>

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
          style={[styles.saveButton, !location && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!location || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color={colors.background} />
              <Text style={styles.saveButtonText}>Save Location</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
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
  locationCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  locationIconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTitle: {
    ...typography.h3,
    color: colors.text,
  },
  coordinatesContainer: {
    padding: spacing.lg,
  },
  coordinateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  coordinateLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  coordinateValue: {
    ...typography.body,
    color: colors.text,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  updateButtonText: {
    ...typography.bodySmall,
    color: colors.text,
  },
  detectContainer: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  detectIconContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  detectTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  detectSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  detectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  detectButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.md,
  },
  privacyNoteText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 16,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: borderRadius.md,
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
