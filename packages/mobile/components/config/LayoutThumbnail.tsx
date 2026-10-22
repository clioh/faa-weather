/**
 * A miniature of a layout on the 12x8 mirror grid: one neutral glass tile
 * per widget (the Flight Rules tile is outlined in VFR green, as on the
 * mirror). Uses percentages so it scales to whatever width the parent gives
 * it without measuring.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  GRID_COLS,
  GRID_ROWS,
  SIZE_DIMENSIONS,
  getModuleById,
  type ModuleInstance,
} from '@/lib/modules';
import { colors } from '@/lib/theme';

interface LayoutThumbnailProps {
  modules: Pick<ModuleInstance, 'moduleId' | 'position' | 'size'>[];
  /** Width / height. The mirror is 16:9 in landscape. */
  aspectRatio?: number;
  showIcons?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const pct = (n: number) => `${n}%` as const;

export function LayoutThumbnail({
  modules,
  aspectRatio = 16 / 9,
  showIcons = false,
  style,
  accessibilityLabel,
}: LayoutThumbnailProps) {
  return (
    <View
      style={[styles.canvas, { aspectRatio }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `Layout preview with ${modules.length} widgets`}
    >
      {modules.map((mod, i) => {
        const dims = SIZE_DIMENSIONS[mod.size];
        if (!dims) return null;
        const def = getModuleById(mod.moduleId);
        const flightRules = mod.moduleId === 'flight-rules';
        return (
          <View
            key={`${mod.moduleId}-${i}`}
            style={[
              styles.cell,
              {
                left: pct((mod.position.x / GRID_COLS) * 100),
                top: pct((mod.position.y / GRID_ROWS) * 100),
                width: pct((dims.cols / GRID_COLS) * 100),
                height: pct((dims.rows / GRID_ROWS) * 100),
              },
            ]}
          >
            <View style={[styles.tile, flightRules && styles.flightRules]}>
              {showIcons && def ? (
                <Ionicons name={def.icon as keyof typeof Ionicons.glyphMap} size={12} color={colors.textSecondary} />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    overflow: 'hidden',
  },
  cell: {
    position: 'absolute',
    padding: 1.5,
  },
  tile: {
    flex: 1,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: colors.thumbTile,
    borderColor: colors.thumbTileBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flightRules: {
    borderColor: colors.vfr,
  },
});
