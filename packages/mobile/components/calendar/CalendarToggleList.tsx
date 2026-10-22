/**
 * The calendars inside one account: a colour swatch (tap to change it), the
 * name, and a switch for whether the mirror shows it. Purely controlled; the
 * caller decides whether a change is saved right away (Calendars screen) or
 * on Done (after connecting).
 */

import { useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { AccountCalendar } from '@/lib/api';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
import { TOUCH } from '@/components/config/fieldStyles';
import { CALENDAR_PALETTE, colorName } from './meta';
import { Sheet } from './ui';

interface CalendarToggleListProps {
  calendars: AccountCalendar[];
  onToggle: (calendar: AccountCalendar, enabled: boolean) => void;
  onColor: (calendar: AccountCalendar, color: string) => void;
  /** Shown when the account has no calendars yet. */
  emptyText?: string;
}

export function CalendarToggleList({ calendars, onToggle, onColor, emptyText }: CalendarToggleListProps) {
  const [picking, setPicking] = useState<AccountCalendar | null>(null);

  if (calendars.length === 0) {
    return (
      <Text style={styles.empty}>
        {emptyText ?? 'No calendars found yet. They’ll appear here after the next sync.'}
      </Text>
    );
  }

  return (
    <View>
      {calendars.map((cal, index) => (
        <View key={cal.id} style={[styles.row, index > 0 && styles.rowDivider]}>
          <TouchableOpacity
            style={styles.swatchButton}
            onPress={() => setPicking(cal)}
            accessibilityRole="button"
            accessibilityLabel={`Color for ${cal.name}: ${colorName(cal.color)}`}
            accessibilityHint="Choose a different color"
          >
            <View style={[styles.swatch, { backgroundColor: cal.color }, !cal.enabled && styles.swatchOff]} />
          </TouchableOpacity>
          <Text style={[styles.name, !cal.enabled && styles.nameOff]} numberOfLines={2}>
            {cal.name}
          </Text>
          <Switch
            value={cal.enabled}
            onValueChange={(value) => {
              Haptics.selectionAsync();
              onToggle(cal, value);
            }}
            trackColor={{ false: colors.surfaceHighlight, true: colors.primaryMuted }}
            thumbColor={cal.enabled ? colors.primary : colors.textMuted}
            accessibilityLabel={`Show ${cal.name} on the mirror`}
          />
        </View>
      ))}

      <Sheet
        visible={picking !== null}
        title={picking ? picking.name : 'Calendar color'}
        body="Events from this calendar use this color on the mirror."
        onClose={() => setPicking(null)}
      >
        <View style={styles.palette} accessibilityRole="radiogroup" accessibilityLabel="Calendar color">
          {paletteFor(picking?.color).map((hex) => {
            const active = picking?.color.toLowerCase() === hex.toLowerCase();
            return (
              <TouchableOpacity
                key={hex}
                style={[styles.paletteItem, active && styles.paletteItemActive]}
                onPress={() => {
                  if (picking && !active) {
                    Haptics.selectionAsync();
                    onColor(picking, hex);
                  }
                  setPicking(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={colorName(hex)}
              >
                <View style={[styles.paletteSwatch, { backgroundColor: hex }]}>
                  {active ? <Ionicons name="checkmark" size={22} color={colors.background} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

/** The palette, plus the calendar's own colour from its provider when that isn't one of them. */
function paletteFor(current: string | undefined): string[] {
  const base: string[] = [...CALENDAR_PALETTE];
  if (current && !base.some((c) => c.toLowerCase() === current.toLowerCase())) base.unshift(current);
  return base;
}

const styles = StyleSheet.create({
  empty: { ...typography.bodySmall, color: colors.textMuted, paddingVertical: spacing.sm },
  row: { minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  swatchButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  swatchOff: { opacity: 0.4 },
  name: { ...typography.body, color: colors.text, flex: 1 },
  nameOff: { color: colors.textMuted },
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    justifyContent: 'center',
  },
  paletteItem: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  paletteItemActive: { borderColor: colors.text },
  paletteSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
