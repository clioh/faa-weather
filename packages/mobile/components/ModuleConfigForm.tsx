/**
 * ModuleConfigForm
 *
 * Renders the settings for one widget straight from its catalog definition,
 * so adding a field in lib/modules.ts is enough to expose it in the app.
 * Used by the layout editor's config sheet.
 *
 * It renders a plain View (no ScrollView) so the host decides how it scrolls;
 * hosts should wrap it in a ScrollView with keyboardShouldPersistTaps="handled"
 * inside a KeyboardAvoidingScreen. Picker modals are owned here.
 *
 * Config conventions (see CONTRACT): an absent key means "use the default"
 * (mirror airport/location/time zone, or the field's default), so clearing a
 * picker deletes the key rather than storing an empty value.
 */

import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';
import type { ModuleConfigField, ModuleDefinition } from '@/lib/modules';
import { isFieldVisible } from '@/lib/modules';
import { colors, spacing, typography } from '@/lib/theme';
import { AirportPicker } from './AirportPicker';
import { LocationPicker, type LocationData } from './LocationPicker';
import { ColorPicker } from './ColorPicker';
import { fieldStyles, TOUCH } from './config/fieldStyles';
import { DateField, ListField, NumberStepper, PickerRow, SelectChips } from './config/controls';
import { TimezonePickerModal } from './config/TimezonePickerModal';
import { timezoneCity, timezoneOffsetLabel } from './config/timezones';

export interface ModuleConfigFormProps {
  definition: ModuleDefinition;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

type OpenPicker = { key: string; type: 'airport' | 'location' | 'color' | 'timezone' } | null;

function isLocation(value: unknown): value is LocationData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LocationData).latitude === 'number' &&
    typeof (value as LocationData).longitude === 'number'
  );
}

function formatCoords(loc: LocationData): string {
  const lat = `${Math.abs(loc.latitude).toFixed(2)}°${loc.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(loc.longitude).toFixed(2)}°${loc.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

/** Text fields whose placeholder is a URL get a URL keyboard and no autocapitalisation. */
function looksLikeUrlField(field: ModuleConfigField): boolean {
  return /url/i.test(field.key) || (field.placeholder ?? '').startsWith('http');
}

export function ModuleConfigForm({ definition, config, onChange }: ModuleConfigFormProps) {
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);

  const setValue = (key: string, value: unknown) => {
    const next = { ...config };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const valueOf = (field: ModuleConfigField): unknown =>
    config[field.key] !== undefined ? config[field.key] : field.default;

  const fields = definition.configFields.filter((f) => isFieldVisible(f, config, definition));

  if (definition.configFields.length === 0) {
    return <Text style={styles.noSettings}>This widget has no settings.</Text>;
  }

  const renderControl = (field: ModuleConfigField) => {
    const value = valueOf(field);

    switch (field.type) {
      case 'text':
        return (
          <TextInput
            style={fieldStyles.input}
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChangeText={(t) => setValue(field.key, t)}
            placeholder={field.placeholder}
            placeholderTextColor={colors.textMuted}
            keyboardType={looksLikeUrlField(field) ? 'url' : 'default'}
            autoCapitalize={looksLikeUrlField(field) ? 'none' : 'sentences'}
            autoCorrect={!looksLikeUrlField(field)}
            returnKeyType="done"
            accessibilityLabel={field.label}
          />
        );

      case 'number': {
        const num = typeof value === 'number' ? value : Number(value);
        return (
          <NumberStepper
            label={field.label}
            value={Number.isFinite(num) ? num : field.min ?? 0}
            min={field.min}
            max={field.max}
            step={field.step}
            unit={field.unit}
            onChange={(n) => setValue(field.key, n)}
          />
        );
      }

      case 'select':
        return (
          <SelectChips
            label={field.label}
            value={value == null ? undefined : String(value)}
            options={field.options ?? []}
            onChange={(v) => setValue(field.key, v)}
          />
        );

      case 'color': {
        const color = typeof value === 'string' && value ? value : undefined;
        return (
          <PickerRow
            label={field.label}
            icon="color-palette-outline"
            value={color?.toUpperCase()}
            swatch={color}
            placeholder={field.placeholder ?? 'Default'}
            onPress={() => setOpenPicker({ key: field.key, type: 'color' })}
            onClear={field.default === undefined ? () => setValue(field.key, undefined) : undefined}
          />
        );
      }

      case 'airport': {
        const icao = typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : undefined;
        return (
          <PickerRow
            label={field.label}
            icon="airplane-outline"
            value={icao}
            placeholder="Mirror default"
            onPress={() => setOpenPicker({ key: field.key, type: 'airport' })}
            onClear={() => setValue(field.key, undefined)}
          />
        );
      }

      case 'location': {
        const loc = isLocation(value) ? value : undefined;
        return (
          <PickerRow
            label={field.label}
            icon="location-outline"
            value={loc ? loc.city || formatCoords(loc) : undefined}
            subvalue={loc?.city ? formatCoords(loc) : undefined}
            placeholder="Mirror default"
            onPress={() => setOpenPicker({ key: field.key, type: 'location' })}
            onClear={() => setValue(field.key, undefined)}
          />
        );
      }

      case 'timezone': {
        const tz = typeof value === 'string' && value ? value : undefined;
        const offset = tz ? timezoneOffsetLabel(tz) : '';
        return (
          <PickerRow
            label={field.label}
            icon="globe-outline"
            value={tz ? timezoneCity(tz) : undefined}
            subvalue={tz ? `${tz}${offset ? ` · ${offset}` : ''}` : undefined}
            placeholder="Mirror default"
            onPress={() => setOpenPicker({ key: field.key, type: 'timezone' })}
            onClear={() => setValue(field.key, undefined)}
          />
        );
      }

      case 'date':
        return (
          <DateField
            label={field.label}
            value={typeof value === 'string' && value ? value : undefined}
            onChange={(v) => setValue(field.key, v)}
          />
        );

      case 'list':
        return (
          <ListField
            label={field.label}
            itemLabel={field.itemLabel}
            value={value}
            placeholder={field.placeholder}
            onChange={(items) => setValue(field.key, items)}
          />
        );

      case 'boolean':
        // Rendered as a full row in renderField.
        return null;
    }
  };

  const renderField = (field: ModuleConfigField) => {
    const required = field.required ? (
      <Text style={styles.required} accessibilityLabel="required">
        {' '}
        *
      </Text>
    ) : null;

    if (field.type === 'boolean') {
      const on = Boolean(valueOf(field));
      return (
        <View key={field.key} style={styles.field}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              {field.label}
              {required}
            </Text>
            <Switch
              value={on}
              onValueChange={(v) => {
                Haptics.selectionAsync();
                setValue(field.key, v);
              }}
              trackColor={{ false: colors.surfaceHighlight, true: colors.primaryDark }}
              thumbColor={colors.text}
              ios_backgroundColor={colors.surfaceHighlight}
              accessibilityLabel={field.label}
            />
          </View>
          {field.description ? <Text style={styles.description}>{field.description}</Text> : null}
        </View>
      );
    }

    return (
      <View key={field.key} style={styles.field}>
        <Text style={styles.label}>
          {field.label}
          {required}
        </Text>
        {renderControl(field)}
        {field.description ? <Text style={styles.description}>{field.description}</Text> : null}
      </View>
    );
  };

  const pickerValue = openPicker ? config[openPicker.key] : undefined;

  return (
    <View style={styles.form}>
      {fields.map(renderField)}

      <AirportPicker
        visible={openPicker?.type === 'airport'}
        currentValue={typeof pickerValue === 'string' ? pickerValue : undefined}
        onSelect={(icao) => {
          if (openPicker) setValue(openPicker.key, icao.toUpperCase());
          setOpenPicker(null);
        }}
        onClose={() => setOpenPicker(null)}
      />
      <LocationPicker
        visible={openPicker?.type === 'location'}
        currentValue={isLocation(pickerValue) ? pickerValue : undefined}
        onSelect={(loc) => {
          if (openPicker) setValue(openPicker.key, loc);
          setOpenPicker(null);
        }}
        onClose={() => setOpenPicker(null)}
      />
      <ColorPicker
        visible={openPicker?.type === 'color'}
        currentValue={typeof pickerValue === 'string' ? pickerValue : undefined}
        onSelect={(color) => {
          if (openPicker) setValue(openPicker.key, color);
          setOpenPicker(null);
        }}
        onClose={() => setOpenPicker(null)}
      />
      <TimezonePickerModal
        visible={openPicker?.type === 'timezone'}
        currentValue={typeof pickerValue === 'string' ? pickerValue : undefined}
        onSelect={(tz) => {
          if (openPicker) setValue(openPicker.key, tz);
          setOpenPicker(null);
        }}
        onClose={() => setOpenPicker(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  field: {},
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  required: { color: colors.warning },
  description: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  switchRow: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchLabel: { ...typography.body, color: colors.text, flex: 1 },
  noSettings: { ...typography.bodySmall, color: colors.textMuted },
});
