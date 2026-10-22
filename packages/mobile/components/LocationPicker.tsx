/**
 * Location Picker Component
 * Detect GPS location or enter manually
 */

import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { colors, spacing, borderRadius, typography, fonts } from '@/lib/theme';
import { ScreenHeader } from './ScreenHeader';

export interface LocationData {
  latitude: number;
  longitude: number;
  city?: string;
  timezone?: string;
}

interface LocationPickerProps {
  visible: boolean;
  currentValue?: LocationData;
  onSelect: (location: LocationData) => void;
  onClose: () => void;
}

export function LocationPicker({
  visible,
  currentValue,
  onSelect,
  onClose,
}: LocationPickerProps) {
  const [detecting, setDetecting] = useState(false);
  const [location, setLocation] = useState<LocationData | null>(currentValue || null);
  const [manualLat, setManualLat] = useState(currentValue?.latitude?.toString() || '');
  const [manualLon, setManualLon] = useState(currentValue?.longitude?.toString() || '');
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && currentValue) {
      setLocation(currentValue);
      setManualLat(currentValue.latitude.toString());
      setManualLon(currentValue.longitude.toString());
    }
  }, [visible, currentValue]);

  const detectLocation = async () => {
    setDetecting(true);
    setError(null);

    try {
      // Request permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Please enable in settings.');
        setDetecting(false);
        return;
      }

      // Get current position
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = position.coords;

      // Try to get city name via reverse geocoding
      let city: string | undefined;
      try {
        const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (address) {
          city = address.city || address.subregion || address.region || undefined;
        }
      } catch (e) {
        // Geocoding failed, continue without city
      }

      const newLocation: LocationData = {
        latitude: Math.round(latitude * 10000) / 10000,
        longitude: Math.round(longitude * 10000) / 10000,
        city,
      };

      setLocation(newLocation);
      setManualLat(newLocation.latitude.toString());
      setManualLon(newLocation.longitude.toString());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError('Failed to detect location. Please try again or enter manually.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setDetecting(false);
    }
  };

  const handleManualSave = () => {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);

    if (isNaN(lat) || isNaN(lon)) {
      Alert.alert('Invalid Coordinates', 'Please enter valid latitude and longitude values.');
      return;
    }

    if (lat < -90 || lat > 90) {
      Alert.alert('Invalid Latitude', 'Latitude must be between -90 and 90.');
      return;
    }

    if (lon < -180 || lon > 180) {
      Alert.alert('Invalid Longitude', 'Longitude must be between -180 and 180.');
      return;
    }

    const newLocation: LocationData = {
      latitude: Math.round(lat * 10000) / 10000,
      longitude: Math.round(lon * 10000) / 10000,
    };

    setLocation(newLocation);
    setShowManual(false);
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleConfirm = () => {
    if (location) {
      onSelect(location);
    }
    onClose();
  };

  const handleClose = () => {
    setShowManual(false);
    setError(null);
    Keyboard.dismiss();
    onClose();
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
        <ScreenHeader
          title="Set Location"
          leftIcon="close"
          onLeftPress={handleClose}
          useTopInset={false}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* Detect Location Button */}
          <TouchableOpacity
            style={styles.detectButton}
            onPress={detectLocation}
            disabled={detecting}
          >
            {detecting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="locate" size={24} color={colors.primary} />
            )}
            <View style={styles.detectButtonText}>
              <Text style={styles.detectTitle}>
                {detecting ? 'Detecting...' : 'Detect My Location'}
              </Text>
              <Text style={styles.detectSubtitle}>Use GPS to find your location</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Manual Entry Toggle */}
          <TouchableOpacity
            style={styles.manualToggle}
            onPress={() => setShowManual(!showManual)}
          >
            <Ionicons name="create-outline" size={20} color={colors.textMuted} />
            <Text style={styles.manualToggleText}>Enter coordinates manually</Text>
            <Ionicons
              name={showManual ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {/* Manual Entry Form */}
          {showManual && (
            <View style={styles.manualForm}>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Latitude</Text>
                <TextInput
                  style={styles.input}
                  value={manualLat}
                  onChangeText={setManualLat}
                  placeholder="40.7128"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  returnKeyType="next"
                />
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Longitude</Text>
                <TextInput
                  style={styles.input}
                  value={manualLon}
                  onChangeText={setManualLon}
                  placeholder="-74.0060"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  returnKeyType="done"
                  onSubmitEditing={handleManualSave}
                />
              </View>
              <TouchableOpacity style={styles.manualSaveButton} onPress={handleManualSave}>
                <Text style={styles.manualSaveText}>Apply Coordinates</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Error */}
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="warning-outline" size={18} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Current Location Display */}
          {location && (
            <View style={styles.locationDisplay}>
              <View style={styles.locationHeader}>
                <Ionicons name="location" size={24} color={colors.primary} />
                <Text style={styles.locationTitle}>
                  {location.city || 'Location Set'}
                </Text>
              </View>
              <View style={styles.coordinatesRow}>
                <View style={styles.coordinate}>
                  <Text style={styles.coordinateLabel}>Latitude</Text>
                  <Text style={styles.coordinateValue}>{location.latitude}</Text>
                </View>
                <View style={styles.coordinate}>
                  <Text style={styles.coordinateLabel}>Longitude</Text>
                  <Text style={styles.coordinateValue}>{location.longitude}</Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.confirmButton, !location && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={!location}
          >
            <Text style={styles.confirmButtonText}>
              {location ? 'Use This Location' : 'Select a Location'}
            </Text>
          </TouchableOpacity>
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
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  detectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  detectButtonText: {
    flex: 1,
  },
  detectTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  detectSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  manualToggleText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  manualForm: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputRow: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  input: {
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  manualSaveButton: {
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  manualSaveText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
  },
  locationDisplay: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  locationTitle: {
    ...typography.h3,
    color: colors.text,
  },
  coordinatesRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  coordinate: {
    flex: 1,
  },
  coordinateLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  coordinateValue: {
    ...typography.body,
    color: colors.text,
    fontFamily: fonts.mono,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmButton: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  confirmButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
