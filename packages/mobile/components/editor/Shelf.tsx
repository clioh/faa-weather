/**
 * The shelf: a strip under the mirror canvas for widgets set aside while
 * rearranging. Shelf widgets are saved with the layout but never shown on
 * the mirror.
 *
 * In: drag a tile below the canvas (ModuleTile), or "Shelf" in the selection
 * bar. Out: drag a chip up onto the canvas (the canvas ghost shows where it
 * lands), or select it and use "Put back". Tapping a chip selects it.
 *
 * Chips scroll sideways; a chip drag only starts on a mostly vertical move so
 * horizontal swipes still scroll the strip.
 */

import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/ui/Text';
import { GRID_COLS, GRID_ROWS, SIZE_LABELS, getModuleById, type ModuleInstance } from '@/lib/modules';
import { colors } from '@/lib/theme';
import { canPlace, dimsOf, type GridRect } from './layoutUtils';
import type { GhostValues } from './ModuleTile';

const COLS = GRID_COLS;
const ROWS = GRID_ROWS;
const SPRING = { damping: 22, stiffness: 260, mass: 0.7 };

/** Gap above the shelf plus its height; the canvas leaves this much room. */
export const SHELF_SPACE = 12 + 84;

const tick = () => {
  Haptics.selectionAsync().catch(() => {});
};
const pickUp = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
const reject = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
};

interface ShelfProps {
  shelf: ModuleInstance[];
  selectedId: string | null;
  /** Canvas size and cells, for mapping a chip drag onto the grid. */
  width: number;
  cellW: number;
  cellH: number;
  /** The canvas glass's top-left in window coordinates. */
  origin: SharedValue<{ x: number; y: number }>;
  rects: SharedValue<GridRect[]>;
  ghost: GhostValues;
  onSelect: (id: string) => void;
  /** Dropped on the canvas with its top-left at (x, y). */
  onUnshelve: (id: string, x: number, y: number) => void;
}

export function Shelf({
  shelf,
  selectedId,
  width,
  cellW,
  cellH,
  origin,
  rects,
  ghost,
  onSelect,
  onUnshelve,
}: ShelfProps) {
  const highlight = useAnimatedStyle(() => {
    const on = ghost.shelf.value === 1;
    return {
      borderColor: withTiming(on ? colors.primary : colors.borderStrong, { duration: 120 }),
      backgroundColor: withTiming(on ? colors.primaryMuted : 'transparent', { duration: 120 }),
    };
  });

  return (
    <Animated.View style={[styles.shelf, { width }, highlight]} accessibilityLabel={`Shelf, ${shelf.length} widget${shelf.length === 1 ? '' : 's'}`}>
      <View style={styles.header}>
        <Text style={styles.label}>SHELF</Text>
        <Text style={styles.caption}>Not shown on the mirror</Text>
      </View>
      {shelf.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="arrow-down" size={14} color={colors.textMuted} />
          <Text style={styles.emptyText}>Drag a widget here to set it aside while you rearrange</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {shelf.map((m) => (
            <ShelfChip
              key={m.instanceId}
              instance={m}
              selected={m.instanceId === selectedId}
              cellW={cellW}
              cellH={cellH}
              origin={origin}
              rects={rects}
              ghost={ghost}
              onSelect={onSelect}
              onUnshelve={onUnshelve}
            />
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

interface ShelfChipProps {
  instance: ModuleInstance;
  selected: boolean;
  cellW: number;
  cellH: number;
  origin: SharedValue<{ x: number; y: number }>;
  rects: SharedValue<GridRect[]>;
  ghost: GhostValues;
  onSelect: (id: string) => void;
  onUnshelve: (id: string, x: number, y: number) => void;
}

const ShelfChip = memo(function ShelfChip({
  instance,
  selected,
  cellW,
  cellH,
  origin,
  rects,
  ghost,
  onSelect,
  onUnshelve,
}: ShelfChipProps) {
  const id = instance.instanceId;
  const definition = getModuleById(instance.moduleId);
  const { cols, rows } = dimsOf(instance.size);
  const active = useSharedValue(0);
  const overCanvas = useSharedValue(0);
  const lifted = useSharedValue(0);
  const target = useSharedValue({ x: 0, y: 0 });

  const gesture = useMemo(() => {
    const canvasW = COLS * cellW;
    const canvasH = ROWS * cellH;
    const key = `${id}:unshelve`;

    const pan = Gesture.Pan()
      .maxPointers(1)
      // Vertical moves pick the chip up; horizontal ones scroll the shelf.
      .activeOffsetY([-10, 10])
      .failOffsetX([-14, 14])
      .onStart(() => {
        if (ghost.lock.value !== '') return;
        ghost.lock.value = key;
        active.value = 1;
        lifted.value = withSpring(1, SPRING);
        scheduleOnRN(onSelect, id);
        scheduleOnRN(pickUp);
      })
      .onUpdate((e) => {
        if (active.value !== 1) return;
        const fx = e.absoluteX - origin.value.x;
        const fy = e.absoluteY - origin.value.y;
        if (fx < 0 || fx > canvasW || fy < 0 || fy > canvasH) {
          if (overCanvas.value === 1) {
            overCanvas.value = 0;
            ghost.visible.value = withTiming(0, { duration: 120 });
          }
          return;
        }
        // The widget is centred under the finger.
        const gx = Math.max(0, Math.min(COLS - cols, Math.round(fx / cellW - cols / 2)));
        const gy = Math.max(0, Math.min(ROWS - rows, Math.round(fy / cellH - rows / 2)));
        const t = target.value;
        if (overCanvas.value === 1 && gx === t.x && gy === t.y) return;
        target.value = { x: gx, y: gy };
        ghost.x.value = gx;
        ghost.y.value = gy;
        ghost.cols.value = cols;
        ghost.rows.value = rows;
        ghost.valid.value = canPlace(rects.value, { x: gx, y: gy, cols, rows }, null) ? 1 : 0;
        if (overCanvas.value !== 1) {
          overCanvas.value = 1;
          ghost.visible.value = withTiming(1, { duration: 120 });
        }
        scheduleOnRN(tick);
      })
      .onEnd((_e, success) => {
        if (active.value !== 1 || overCanvas.value !== 1) return;
        if (success && ghost.valid.value === 1) {
          scheduleOnRN(onUnshelve, id, target.value.x, target.value.y);
        } else {
          scheduleOnRN(reject);
        }
      })
      .onFinalize(() => {
        if (active.value !== 1) return;
        active.value = 0;
        overCanvas.value = 0;
        ghost.lock.value = '';
        lifted.value = withSpring(0, SPRING);
        ghost.visible.value = withTiming(0, { duration: 120 });
      });

    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (!success || ghost.lock.value !== '') return;
        scheduleOnRN(pickUp);
        scheduleOnRN(onSelect, id);
      });

    return Gesture.Race(pan, tap);
  }, [id, cols, rows, cellW, cellH, origin, rects, ghost, active, overCanvas, lifted, target, onSelect, onUnshelve]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lifted.value * 0.06 }],
    opacity: 1 - overCanvas.value * 0.5,
  }));

  const name = definition?.name ?? 'Unavailable widget';
  const sizeLabel = SIZE_LABELS[instance.size] ?? instance.size;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.chip, selected && styles.chipSelected, style]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${sizeLabel}, on the shelf`}
        accessibilityHint="Drag up onto the mirror to place it, or select it and choose Put back."
        accessibilityState={{ selected }}
      >
        <Ionicons
          name={(definition?.icon ?? 'help-circle-outline') as keyof typeof Ionicons.glyphMap}
          size={16}
          color={colors.tileText}
        />
        <View style={styles.chipText}>
          <Text style={styles.chipName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.chipSize}>{sizeLabel}</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  shelf: {
    height: SHELF_SPACE - 12,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingTop: 8,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 10,
    color: colors.textMuted,
  },
  empty: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  emptyText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  chips: {
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 8,
    alignItems: 'center',
  },
  chip: {
    height: 44,
    maxWidth: 170,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.tileFill,
    borderWidth: 1,
    borderColor: colors.tileBorder,
  },
  chipSelected: {
    backgroundColor: colors.primaryMuted,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  chipText: {
    flexShrink: 1,
  },
  chipName: {
    fontSize: 12,
    color: colors.tileText,
  },
  chipSize: {
    fontSize: 10,
    color: colors.textMuted,
  },
});
