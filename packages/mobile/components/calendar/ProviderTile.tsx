/**
 * Monochrome provider tile (36pt, outlined) used wherever a calendar
 * account or provider is listed.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CalendarProviderId } from '@/lib/api';
import { colors } from '@/lib/theme';
import { PROVIDER_META } from './meta';

export function ProviderTile({ provider, style }: { provider: CalendarProviderId; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tile, style]}>
      <Ionicons name={PROVIDER_META[provider]?.icon ?? 'calendar-outline'} size={18} color={colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
