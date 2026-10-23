/**
 * Location Setup Screen
 * Set location for astronomical data (sunrise/sunset)
 */

import { useState, useEffect } from 'react';
import { View, StyleSheet, Alert, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { Button, Footer, Notice, Text } from '@/components/ui';
import { colors, spacing, typography, fonts } from '@/lib/theme';

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
          'Permission required',
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
      // Hand straight over to the airport step, which suggests fields near
      // this location. replace() keeps the checklist as the screen behind it.
      router.replace('/setup/airport');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save location');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const formatCoordinate = (value: number, isLat: boolean): string => {
    const direction = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
    return `${Math.abs(value).toFixed(4)}° ${direction}`;
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Instructions */}
        <Text style={styles.instructionsText}>
          Your location is used to calculate accurate sunrise, sunset, and twilight times for pilot
          currency tracking
        </Text>

        {location ? (
          <View style={styles.locationSet}>
            <View style={styles.locationHeader}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.locationTitle}>Location set</Text>
            </View>

            <View style={styles.rows}>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Latitude</Text>
                <Text style={styles.dataValue}>{formatCoordinate(location.latitude, true)}</Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Longitude</Text>
                <Text style={styles.dataValue}>{formatCoordinate(location.longitude, false)}</Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Timezone</Text>
                <Text style={[styles.dataValue, styles.dataValueSmall]}>{location.timezone}</Text>
              </View>
            </View>

            <Button
              label="Update location"
              variant="secondary"
              size="small"
              icon="refresh"
              onPress={detectLocation}
              loading={detecting}
              style={styles.updateButton}
            />
          </View>
        ) : (
          <View style={styles.detect}>
            <Text style={styles.detectTitle}>Detect your location</Text>
            <Text style={styles.detectSubtitle}>
              Tap below to automatically detect your current location using your phone's GPS
            </Text>
            <Button
              label="Detect location"
              variant="secondary"
              icon="locate-outline"
              onPress={detectLocation}
              loading={detecting}
            />
          </View>
        )}

        {/* Error message */}
        {error && <Notice tone="error" message={error} />}

        <View style={styles.spacer} />

        {/* Privacy note */}
        <Notice
          tone="info"
          icon="shield-checkmark-outline"
          message="Your location is stored locally on your mirror and never shared with third parties"
        />
      </ScrollView>

      {/* Save button */}
      <Footer>
        <Button label="Save location" onPress={handleSave} disabled={!location} loading={saving} />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  instructionsText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  locationSet: {
    gap: 10,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  locationTitle: {
    ...typography.label,
    color: colors.primary,
  },
  rows: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  dataRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  dataLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
  },
  dataValue: {
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.text,
  },
  dataValueSmall: {
    fontSize: 14,
  },
  updateButton: {
    marginTop: 6,
  },
  detect: {
    gap: 10,
  },
  detectTitle: {
    ...typography.h3,
    color: colors.text,
  },
  detectSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
});
