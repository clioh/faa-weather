/**
 * Location Picker Component
 * Detect GPS location or enter manually
 */

import { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, ScrollView, Alert, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import {
  Button,
  Field,
  Footer,
  Notice,
  PageSheetHeader,
  Row,
  RowGroup,
  Spinner,
  Text,
} from '@/components/ui';
import { KeyboardAvoidingScreen } from '@/components/KeyboardAvoidingScreen';
import { colors, spacing, typography, fonts } from '@/lib/theme';

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

export function LocationPicker({ visible, currentValue, onSelect, onClose }: LocationPickerProps) {
  const [detecting, setDetecting] = useState(false);
  const [location, setLocation] = useState<LocationData | null>(currentValue || null);
  const [manualLat, setManualLat] = useState(currentValue?.latitude?.toString() || '');
  const [manualLon, setManualLon] = useState(currentValue?.longitude?.toString() || '');
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from the saved value (or nothing), so a location
  // detected and then abandoned last time isn't offered again.
  useEffect(() => {
    if (!visible) return;
    setLocation(currentValue ?? null);
    setManualLat(currentValue ? currentValue.latitude.toString() : '');
    setManualLon(currentValue ? currentValue.longitude.toString() : '');
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
    // Number(), not parseFloat(): "40abc" must be rejected, not read as 40.
    const parse = (raw: string) => (raw.trim() === '' ? NaN : Number(raw.trim().replace(',', '.')));
    const lat = parse(manualLat);
    const lon = parse(manualLon);

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
        <PageSheetHeader title="Set Location" onClose={handleClose} />
        {/* iOS: the ScrollView/FlatList insets itself (exact in a page sheet); Android: padding. */}
        <KeyboardAvoidingScreen avoidOnIOS={false}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
          >
            <RowGroup>
              {/* Detect Location Button */}
              <Row
                leading={
                  detecting ? (
                    <Spinner />
                  ) : (
                    <Ionicons name="locate-outline" size={22} color={colors.primary} />
                  )
                }
                title={detecting ? 'Detecting...' : 'Detect My Location'}
                caption="Use GPS to find your location"
                onPress={detectLocation}
                disabled={detecting}
                style={detecting ? styles.active : undefined}
              />

              {/* Manual Entry Toggle */}
              <Row
                icon="create-outline"
                title="Enter coordinates manually"
                onPress={() => setShowManual(!showManual)}
                trailing={
                  <Ionicons
                    name={showManual ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.chevron}
                  />
                }
              />
            </RowGroup>

            {/* Manual Entry Form */}
            {showManual && (
              <View style={styles.manualForm}>
                <View style={styles.inputRow}>
                  <Field
                    style={styles.inputCol}
                    label="Latitude"
                    mono
                    value={manualLat}
                    onChangeText={setManualLat}
                    placeholder="40.7128"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                  <Field
                    style={styles.inputCol}
                    label="Longitude"
                    mono
                    value={manualLon}
                    onChangeText={setManualLon}
                    placeholder="-74.0060"
                    keyboardType="numeric"
                    returnKeyType="done"
                    onSubmitEditing={handleManualSave}
                  />
                </View>
                <Button
                  label="Apply Coordinates"
                  variant="secondary"
                  onPress={handleManualSave}
                  style={styles.apply}
                />
              </View>
            )}

            {/* Error */}
            {error && <Notice tone="error" message={error} />}

            {/* Current Location Display */}
            {location && (
              <View style={styles.locationDisplay}>
                <View style={styles.locationHeader}>
                  <Ionicons name="location-outline" size={18} color={colors.primary} />
                  <Text style={styles.locationTitle}>{location.city || 'Location Set'}</Text>
                </View>
                <Text style={styles.coordinates}>
                  {location.latitude}, {location.longitude}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <Footer>
            <Button
              label={location ? 'Use This Location' : 'Select a Location'}
              onPress={handleConfirm}
              disabled={!location}
            />
          </Footer>
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: 18,
  },
  active: {
    opacity: 1,
  },
  manualForm: {
    gap: 18,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputCol: {
    flex: 1,
  },
  apply: {
    height: 44,
  },
  locationDisplay: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  locationTitle: {
    fontSize: 16,
    color: colors.text,
  },
  coordinates: {
    ...typography.caption,
    fontFamily: fonts.mono,
    color: colors.textMuted,
  },
});
