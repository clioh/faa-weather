/**
 * Individual controls used by ModuleConfigForm. Each one is controlled: it
 * shows `value` and reports changes, but keeps a local text buffer where the
 * user can be mid-edit (a half-typed number or date) without the parent
 * config ever holding an invalid value.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, borderRadius, typography, fonts } from '@/lib/theme';
import { fieldStyles, TOUCH } from './fieldStyles';
import { TimezonePickerModal } from './TimezonePickerModal';
import { isValidTimezone, timezoneCity } from './timezones';

// ------------------------------------------------------------------ Number

interface NumberStepperProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

function clamp(n: number, min?: number, max?: number): number {
  let out = n;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

export function NumberStepper({ label, value, min, max, step = 1, unit, onChange }: NumberStepperProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  // Round to the step's precision so 0.1 + 0.2 never shows as 0.30000000000000004.
  const decimals = (String(step).split('.')[1] ?? '').length;
  const round = (n: number) => Number(n.toFixed(decimals));

  const bump = (dir: 1 | -1) => {
    const next = clamp(round(value + dir * step), min, max);
    setText(String(next));
    if (next !== value) {
      Haptics.selectionAsync();
      onChange(next);
    }
  };

  // Commit on every parseable keystroke: iOS number pads have no return key
  // and hosts put Save outside the scroll view, so waiting for blur loses edits.
  const handleText = (raw: string) => {
    setText(raw);
    const parsed = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(parsed)) return;
    const next = clamp(round(parsed), min, max);
    if (next !== value) onChange(next);
  };

  // Blur only tidies the display (e.g. an out-of-range or half-typed value).
  const handleBlur = () => {
    setFocused(false);
    setText(String(value));
  };

  const atMin = min !== undefined && value <= min;
  const atMax = max !== undefined && value >= max;
  const range =
    min !== undefined && max !== undefined ? `${min}–${max}${unit ? ` ${unit}` : ''}` : undefined;

  return (
    <View style={styles.stepper}>
      <TouchableOpacity
        style={[styles.stepButton, atMin && styles.stepButtonDisabled]}
        onPress={() => bump(-1)}
        disabled={atMin}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
      >
        <Ionicons name="remove" size={20} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.stepValueWrap}>
        <TextInput
          style={styles.stepValue}
          value={text}
          onChangeText={handleText}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onSubmitEditing={handleBlur}
          keyboardType={decimals > 0 ? 'decimal-pad' : 'number-pad'}
          returnKeyType="done"
          selectTextOnFocus
          accessibilityLabel={label}
          accessibilityHint={range ? `Between ${range}` : undefined}
        />
        {unit ? <Text style={styles.stepUnit}>{unit}</Text> : null}
      </View>
      <TouchableOpacity
        style={[styles.stepButton, atMax && styles.stepButtonDisabled]}
        onPress={() => bump(1)}
        disabled={atMax}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
      >
        <Ionicons name="add" size={20} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

// ------------------------------------------------------------------ Select

interface SelectChipsProps {
  label: string;
  value: string | undefined;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

export function SelectChips({ label, value, options, onChange }: SelectChipsProps) {
  // Up to three options read best as one segmented bar; more wrap as chips.
  const segmented = options.length <= 3;
  return (
    <View
      style={segmented ? styles.segmented : styles.chipWrap}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => {
              if (active) return;
              Haptics.selectionAsync();
              onChange(opt.value);
            }}
            style={[
              segmented ? styles.segment : fieldStyles.chip,
              active && (segmented ? styles.segmentActive : fieldStyles.chipActive),
            ]}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={opt.label}
          >
            <Text
              style={[fieldStyles.chipText, active && fieldStyles.chipTextActive]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ Picker row

interface PickerRowProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value?: string;
  subvalue?: string;
  placeholder?: string;
  swatch?: string;
  onPress: () => void;
  /** Shown as an × when there is a value; resets the field to the mirror default. */
  onClear?: () => void;
}

/** A tappable row that opens a picker modal, with an optional clear button. */
export function PickerRow({
  label,
  icon,
  value,
  subvalue,
  placeholder = 'Mirror default',
  swatch,
  onPress,
  onClear,
}: PickerRowProps) {
  return (
    <View style={fieldStyles.pickerRow}>
      <TouchableOpacity
        style={fieldStyles.pickerRowMain}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        accessibilityHint="Opens a picker"
      >
        {swatch ? (
          <View style={[styles.swatch, { backgroundColor: swatch }]} />
        ) : (
          <Ionicons name={icon} size={18} color={value ? colors.text : colors.textMuted} />
        )}
        <View style={styles.pickerTextCol}>
          <Text style={value ? fieldStyles.pickerValue : fieldStyles.pickerPlaceholder} numberOfLines={1}>
            {value ?? placeholder}
          </Text>
          {subvalue ? (
            <Text style={fieldStyles.pickerSubvalue} numberOfLines={1}>
              {subvalue}
            </Text>
          ) : null}
        </View>
        {!(value && onClear) && (
          <Ionicons name="chevron-forward" size={14} color={colors.chevron} style={styles.chevron} />
        )}
      </TouchableOpacity>
      {value && onClear ? (
        <TouchableOpacity
          style={fieldStyles.iconButton}
          onPress={() => {
            Haptics.selectionAsync();
            onClear();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Reset ${label} to mirror default`}
        >
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Date

const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Digits-only input shaped as YYYY-MM-DD; dashes appear once the next digit is typed so backspace never fights them. */
function maskDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 4);
  if (digits.length > 4) out += `-${digits.slice(4, 6)}`;
  if (digits.length > 6) out += `-${digits.slice(6, 8)}`;
  return out;
}

function addMonthsClamped(base: Date, months: number): Date {
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(base.getDate(), lastDay));
  return target;
}

interface DateFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

export function DateField({ label, value, onChange }: DateFieldProps) {
  const [text, setText] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(value ?? '');
    setError(null);
  }, [value]);

  const handleText = (raw: string) => {
    const masked = maskDate(raw);
    setText(masked);
    setError(null);
    if (masked === '') {
      if (value !== undefined) onChange(undefined);
    } else if (masked.length === 10) {
      if (isValidIsoDate(masked)) {
        if (masked !== value) onChange(masked);
      } else {
        setError('That date doesn’t exist.');
      }
    }
  };

  const handleBlur = () => {
    if (text.length > 0 && text.length < 10) setError('Use the format YYYY-MM-DD.');
  };

  const today = new Date();
  const quick: { label: string; date: Date }[] = [
    { label: 'Today', date: today },
    { label: '+1 week', date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7) },
    { label: '+1 month', date: addMonthsClamped(today, 1) },
  ];

  return (
    <View>
      <TextInput
        style={[fieldStyles.input, styles.mono, error && fieldStyles.inputError]}
        value={text}
        onChangeText={handleText}
        onBlur={handleBlur}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        maxLength={10}
        returnKeyType="done"
        accessibilityLabel={`${label}, year month day`}
      />
      {error ? <Text style={fieldStyles.errorText}>{error}</Text> : null}
      <View style={styles.quickRow}>
        {quick.map((q) => {
          const iso = formatLocalDate(q.date);
          const active = iso === value;
          return (
            <TouchableOpacity
              key={q.label}
              style={[fieldStyles.chip, active && fieldStyles.chipActive]}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(iso);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Set ${label} to ${q.label}, ${iso}`}
            >
              <Text style={[fieldStyles.chipText, active && fieldStyles.chipTextActive]}>{q.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ List

/** Matches the backend's per-request caps so the phone never saves more than the mirror will show. */
const LIST_LIMITS: Record<string, number> = { symbol: 12, coin: 10, 'time zone': 8 };

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  // Layouts saved before list fields existed stored comma-separated strings.
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

interface ListFieldProps {
  label: string;
  itemLabel?: string;
  value: unknown;
  placeholder?: string;
  onChange: (items: string[]) => void;
}

export function ListField({ label, itemLabel = 'item', value, placeholder, onChange }: ListFieldProps) {
  const items = normalizeList(value);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);

  const isTicker = itemLabel === 'symbol' || itemLabel === 'coin';
  const isTimezone = itemLabel === 'time zone';
  const limit = LIST_LIMITS[itemLabel];
  const full = limit !== undefined && items.length >= limit;

  const add = (raw: string) => {
    const entry = isTicker ? raw.trim().toUpperCase() : raw.trim();
    if (!entry) return;
    if (full) {
      setError(`Up to ${limit} ${itemLabel}s.`);
      return;
    }
    if (isTicker && !/^[A-Z0-9.^-]{1,12}$/.test(entry)) {
      setError(`“${entry}” doesn’t look like a ${itemLabel}.`);
      return;
    }
    if (isTimezone && !isValidTimezone(entry)) {
      setError(`“${entry}” isn’t a known time zone. Try Browse.`);
      return;
    }
    if (items.some((i) => i.toLowerCase() === entry.toLowerCase())) {
      setError(`${entry} is already in the list.`);
      return;
    }
    Haptics.selectionAsync();
    setError(null);
    setDraft('');
    onChange([...items, entry]);
  };

  const remove = (index: number) => {
    Haptics.selectionAsync();
    setError(null);
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <View>
      {items.length > 0 ? (
        <View style={styles.chipWrap}>
          {items.map((item, index) => (
            <View key={`${item}-${index}`} style={[fieldStyles.chip, styles.listChip]}>
              <Text style={[fieldStyles.chipText, styles.listChipText]} numberOfLines={1}>
                {isTimezone ? timezoneCity(item) : item}
              </Text>
              <TouchableOpacity
                onPress={() => remove(index)}
                style={styles.listChipRemove}
                hitSlop={{ top: 5, bottom: 5 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item}`}
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.listEmpty}>No {itemLabel}s yet.</Text>
      )}

      {!full && (
        <View style={styles.listInputRow}>
          <TextInput
            style={[fieldStyles.input, styles.listInput, error && fieldStyles.inputError]}
            value={draft}
            onChangeText={(t) => {
              setDraft(isTicker ? t.toUpperCase() : t);
              if (error) setError(null);
            }}
            onSubmitEditing={() => add(draft)}
            placeholder={placeholder ?? `Add a ${itemLabel}`}
            placeholderTextColor={colors.textMuted}
            autoCapitalize={isTicker ? 'characters' : 'none'}
            autoCorrect={false}
            returnKeyType="done"
            submitBehavior="submit"
            accessibilityLabel={`New ${itemLabel} for ${label}`}
          />
          {isTimezone && (
            <TouchableOpacity
              style={styles.listButtonSecondary}
              onPress={() => setTzPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Browse time zones"
            >
              <Text style={styles.listButtonSecondaryText}>Browse</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.listButton, !draft.trim() && styles.listButtonDisabled]}
            onPress={() => add(draft)}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel={`Add ${itemLabel}`}
          >
            <Text style={[styles.listButtonText, !draft.trim() && styles.listButtonTextDisabled]}>Add</Text>
          </TouchableOpacity>
        </View>
      )}
      {error ? <Text style={fieldStyles.errorText}>{error}</Text> : null}
      {full && !error ? (
        <Text style={styles.listLimit}>
          {limit} {itemLabel}s is the most this widget shows.
        </Text>
      ) : null}

      {isTimezone && (
        <TimezonePickerModal
          visible={tzPickerOpen}
          title="Add Time Zone"
          onClose={() => setTzPickerOpen(false)}
          onSelect={(tz) => {
            setTzPickerOpen(false);
            add(tz);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Pill: − | value + unit (mono) | +
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    height: TOUCH,
    borderRadius: TOUCH / 2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  stepButton: {
    width: TOUCH,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: { opacity: 0.35 },
  stepValueWrap: {
    minWidth: 88,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    gap: 4,
  },
  stepValue: {
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
    minWidth: 32,
    paddingVertical: 0,
  },
  stepUnit: { fontFamily: fonts.mono, fontSize: 13, color: colors.textMuted },
  segmented: {
    flexDirection: 'row',
    borderRadius: borderRadius.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: TOUCH - 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  segmentActive: { backgroundColor: colors.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  pickerTextCol: { flex: 1, paddingVertical: spacing.xs },
  chevron: { marginRight: 14 },
  mono: { fontFamily: fonts.mono, letterSpacing: 1 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  listChip: { flexDirection: 'row', paddingRight: 0, maxWidth: '100%' },
  listChipText: { color: colors.text, flexShrink: 1 },
  listChipRemove: { width: TOUCH, height: 34, alignItems: 'center', justifyContent: 'center' },
  listEmpty: { ...typography.bodySmall, color: colors.textMuted },
  listInputRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  listInput: { flex: 1, minHeight: 48 },
  listButton: {
    minWidth: 64,
    height: 48,
    borderRadius: borderRadius.input,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  listButtonDisabled: { backgroundColor: colors.disabledFill },
  listButtonText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  listButtonTextDisabled: { color: colors.textDisabled },
  listButtonSecondary: {
    height: 48,
    borderRadius: borderRadius.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  listButtonSecondaryText: { fontSize: 14, fontWeight: '500', color: colors.text },
  listLimit: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
});
