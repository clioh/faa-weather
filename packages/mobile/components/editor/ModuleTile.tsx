/**
 * One widget on the editor canvas.
 *
 * All drag and resize motion lives in shared values on the UI thread; React
 * state only changes once, on release, through onMove/onResize. The canvas
 * owns a single drop ghost (shared values in `ghost`) that whichever tile is
 * being dragged writes to, so only one outline is ever drawn.
 */

import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  CATEGORIES,
  GRID_COLS,
  GRID_ROWS,
  SIZE_DIMENSIONS,
  SIZE_LABELS,
  missingRequiredFields,
  type ModuleDefinition,
  type ModuleInstance,
  type ModuleSize,
} from '@/lib/modules';
import { colors } from '@/lib/theme';
import { canPlace, dimsOf, type GridRect } from './layoutUtils';

const COLS = GRID_COLS;
const ROWS = GRID_ROWS;
/** Gap drawn inside each tile's cell rect so neighbours read as separate. */
export const TILE_INSET = 2;
const SPRING = { damping: 22, stiffness: 260, mass: 0.7 };
const LIFT_SCALE = 1.04;

export interface GhostValues {
  x: SharedValue<number>;
  y: SharedValue<number>;
  cols: SharedValue<number>;
  rows: SharedValue<number>;
  visible: SharedValue<number>;
  valid: SharedValue<number>;
  /**
   * Key of the one gesture (tile id + kind) allowed to drive the ghost.
   * Empty when idle. Stops a second finger on another tile from starting a
   * competing drag that would fight over the ghost and the collision state.
   */
  lock: SharedValue<string>;
}

interface ModuleTileProps {
  instance: ModuleInstance;
  definition: ModuleDefinition | undefined;
  cellW: number;
  cellH: number;
  selected: boolean;
  /** Footprints of every tile, kept current by the canvas, for UI-thread collision checks. */
  rects: SharedValue<GridRect[]>;
  ghost: GhostValues;
  /** Bumped by the editor to draw attention to a freshly added tile. */
  pulseKey: number;
  /**
   * Bumped when the editor refuses a drop the UI thread thought was valid
   * (its collision snapshot was stale), so the tile springs back to its
   * committed spot instead of staying where it was released.
   */
  revision: number;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, size: ModuleSize) => void;
  /** Screen-reader move: shift by whole cells. */
  onNudge: (id: string, dx: number, dy: number) => void;
}

// Haptics are JS-side; these are the only things the worklets schedule besides commits.
const tick = () => {
  Haptics.selectionAsync().catch(() => {});
};
const pickUp = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
const reject = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
};

function ModuleTileImpl({
  instance,
  definition,
  cellW,
  cellH,
  selected,
  rects,
  ghost,
  pulseKey,
  revision,
  onSelect,
  onMove,
  onResize,
  onNudge,
}: ModuleTileProps) {
  const id = instance.instanceId;
  const { cols, rows } = dimsOf(instance.size);
  const { x, y } = instance.position;

  const left = useSharedValue(x * cellW);
  const top = useSharedValue(y * cellH);
  const width = useSharedValue(cols * cellW);
  const height = useSharedValue(rows * cellH);
  // Committed grid footprint, mirrored into a shared value so gesture
  // callbacks never read a stale prop if React re-renders mid-gesture.
  const grid = useSharedValue({ x, y, cols, rows });
  const lifted = useSharedValue(0);
  const pulse = useSharedValue(0);
  const dragStart = useSharedValue({ left: 0, top: 0, width: 0, height: 0 });
  // Per-gesture flags: RNGH can finalize a gesture that never started (the
  // tile pan when the resize pan wins), and that must not undo the other
  // gesture's lift or hide its ghost.
  const panActive = useSharedValue(0);
  const resizeActive = useSharedValue(0);
  const target = useSharedValue({ x, y, cols, rows, size: instance.size as string });

  useEffect(() => {
    grid.value = { x, y, cols, rows };
    // After a successful drop the tile is already springing to this spot;
    // only animate when the change came from elsewhere (undo, chips, tidy).
    const settle = (sv: SharedValue<number>, to: number) => {
      if (Math.abs(sv.value - to) > 0.5) sv.value = withSpring(to, SPRING);
    };
    settle(left, x * cellW);
    settle(top, y * cellH);
    settle(width, cols * cellW);
    settle(height, rows * cellH);
  }, [x, y, cols, rows, cellW, cellH, revision, grid, left, top, width, height]);

  useEffect(() => {
    if (pulseKey <= 0) return;
    pulse.value = withSequence(
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 220 }),
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 260 })
    );
  }, [pulseKey, pulse]);

  const canvasW = COLS * cellW;
  const canvasH = ROWS * cellH;

  // Allowed presets with their footprints, as plain data the resize worklet can read.
  const sizeOptions = useMemo(
    () =>
      (definition?.sizes ?? [instance.size]).map((s) => ({
        size: s as string,
        cols: dimsOf(s).cols,
        rows: dimsOf(s).rows,
      })),
    [definition, instance.size]
  );

  const gesture = useMemo(() => {
    const showGhost = (gx: number, gy: number, gc: number, gr: number, valid: boolean) => {
      'worklet';
      ghost.x.value = gx;
      ghost.y.value = gy;
      ghost.cols.value = gc;
      ghost.rows.value = gr;
      ghost.valid.value = valid ? 1 : 0;
    };

    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((_e, success) => {
        // A second finger tapping another tile mid-drag must not steal selection.
        if (!success || ghost.lock.value !== '') return;
        scheduleOnRN(pickUp);
        scheduleOnRN(onSelect, id);
      });

    const panKey = `${id}:move`;
    const resizeKey = `${id}:resize`;

    const pan = Gesture.Pan()
      .minDistance(6)
      .maxPointers(1)
      .onStart(() => {
        if (ghost.lock.value !== '') return;
        ghost.lock.value = panKey;
        panActive.value = 1;
        const g = grid.value;
        dragStart.value = { left: left.value, top: top.value, width: width.value, height: height.value };
        target.value = { x: g.x, y: g.y, cols: g.cols, rows: g.rows, size: target.value.size };
        lifted.value = withSpring(1, SPRING);
        showGhost(g.x, g.y, g.cols, g.rows, true);
        ghost.visible.value = withTiming(1, { duration: 120 });
        scheduleOnRN(onSelect, id);
        scheduleOnRN(pickUp);
      })
      .onUpdate((e) => {
        if (panActive.value !== 1) return;
        const g = grid.value;
        const s = dragStart.value;
        // The tile follows the finger but stays over the canvas.
        left.value = Math.max(0, Math.min(canvasW - s.width, s.left + e.translationX));
        top.value = Math.max(0, Math.min(canvasH - s.height, s.top + e.translationY));
        const nx = Math.max(0, Math.min(COLS - g.cols, Math.round(left.value / cellW)));
        const ny = Math.max(0, Math.min(ROWS - g.rows, Math.round(top.value / cellH)));
        const t = target.value;
        if (nx !== t.x || ny !== t.y) {
          target.value = { ...t, x: nx, y: ny };
          showGhost(nx, ny, g.cols, g.rows, canPlace(rects.value, { x: nx, y: ny, cols: g.cols, rows: g.rows }, id));
          scheduleOnRN(tick);
        }
      })
      .onEnd((_e, success) => {
        if (panActive.value !== 1) return;
        const g = grid.value;
        const t = target.value;
        const ok = success && ghost.valid.value === 1;
        const dest = ok ? t : g;
        left.value = withSpring(dest.x * cellW, SPRING);
        top.value = withSpring(dest.y * cellH, SPRING);
        if (ok && (t.x !== g.x || t.y !== g.y)) {
          grid.value = { ...g, x: t.x, y: t.y };
          scheduleOnRN(onMove, id, t.x, t.y);
        } else if (!ok) {
          scheduleOnRN(reject);
        }
      })
      .onFinalize(() => {
        if (panActive.value !== 1) return;
        panActive.value = 0;
        ghost.lock.value = '';
        lifted.value = withSpring(0, SPRING);
        ghost.visible.value = withTiming(0, { duration: 120 });
      });

    // Activates at 1 px, well before the tile's 6 px pan, so a drag that
    // starts on the handle always resizes rather than moves.
    const resize = Gesture.Pan()
      .minDistance(1)
      .maxPointers(1)
      // View hitSlop is ignored by RNGH on Android; the gesture's own hitSlop
      // works on both platforms. Mostly up/left so it stays over the tile.
      .hitSlop({ top: 12, left: 12, right: 4, bottom: 4 })
      .onStart(() => {
        if (ghost.lock.value !== '') return;
        ghost.lock.value = resizeKey;
        resizeActive.value = 1;
        const g = grid.value;
        dragStart.value = { left: left.value, top: top.value, width: width.value, height: height.value };
        target.value = { x: g.x, y: g.y, cols: g.cols, rows: g.rows, size: target.value.size };
        lifted.value = withSpring(1, SPRING);
        showGhost(g.x, g.y, g.cols, g.rows, true);
        ghost.visible.value = withTiming(1, { duration: 120 });
        scheduleOnRN(pickUp);
      })
      .onUpdate((e) => {
        if (resizeActive.value !== 1) return;
        const g = grid.value;
        const s = dragStart.value;
        const w = Math.max(cellW, Math.min(canvasW - s.left, s.width + e.translationX));
        const h = Math.max(cellH, Math.min(canvasH - s.top, s.height + e.translationY));
        width.value = w;
        height.value = h;
        const cornerX = s.left + w;
        const cornerY = s.top + h;
        // Snap to the allowed preset whose bottom-right corner is nearest the
        // finger. Presets that would hang off the grid are skipped: the tile
        // is anchored top-left while resizing.
        let best = -1;
        let bestD = Number.MAX_VALUE;
        for (let i = 0; i < sizeOptions.length; i++) {
          const o = sizeOptions[i];
          if (g.x + o.cols > COLS || g.y + o.rows > ROWS) continue;
          const dx = (g.x + o.cols) * cellW - cornerX;
          const dy = (g.y + o.rows) * cellH - cornerY;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best < 0) return;
        const o = sizeOptions[best];
        const t = target.value;
        if (o.cols !== t.cols || o.rows !== t.rows) {
          target.value = { x: g.x, y: g.y, cols: o.cols, rows: o.rows, size: o.size };
          showGhost(g.x, g.y, o.cols, o.rows, canPlace(rects.value, { x: g.x, y: g.y, cols: o.cols, rows: o.rows }, id));
          scheduleOnRN(tick);
        }
      })
      .onEnd((_e, success) => {
        if (resizeActive.value !== 1) return;
        const g = grid.value;
        const t = target.value;
        const ok = success && ghost.valid.value === 1;
        const changed = t.cols !== g.cols || t.rows !== g.rows;
        width.value = withSpring((ok ? t.cols : g.cols) * cellW, SPRING);
        height.value = withSpring((ok ? t.rows : g.rows) * cellH, SPRING);
        if (ok && changed) {
          grid.value = { ...g, cols: t.cols, rows: t.rows };
          scheduleOnRN(onResize, id, t.size as ModuleSize);
        } else if (!ok) {
          scheduleOnRN(reject);
        }
      })
      .onFinalize(() => {
        if (resizeActive.value !== 1) return;
        resizeActive.value = 0;
        ghost.lock.value = '';
        lifted.value = withSpring(0, SPRING);
        ghost.visible.value = withTiming(0, { duration: 120 });
      });

    return { tile: Gesture.Race(pan, tap), resize };
  }, [
    id,
    cellW,
    cellH,
    canvasW,
    canvasH,
    sizeOptions,
    rects,
    ghost,
    grid,
    left,
    top,
    width,
    height,
    lifted,
    dragStart,
    target,
    panActive,
    resizeActive,
    onSelect,
    onMove,
    onResize,
  ]);

  const animatedStyle = useAnimatedStyle(() => {
    const l = lifted.value;
    return {
      left: left.value,
      top: top.value,
      width: width.value,
      height: height.value,
      zIndex: l > 0.01 ? 100 : selected ? 10 : 1,
      transform: [{ scale: 1 + l * (LIFT_SCALE - 1) + pulse.value * 0.05 }],
      shadowOpacity: l * 0.5,
      shadowRadius: 4 + l * 10,
      elevation: l * 10,
    };
  });

  const category = definition ? CATEGORIES[definition.category] : null;
  const tint = category?.color ?? colors.textMuted;
  const name = definition?.name ?? 'Unavailable widget';
  const needsSetup = definition ? missingRequiredFields(definition, instance.config ?? {}).length > 0 : false;

  // Layout decisions use the committed footprint; during a resize the content
  // simply reflows inside the stretching box.
  const pxW = cols * cellW;
  const pxH = rows * cellH;
  const horizontal = pxW > pxH * 1.6;
  const iconSize = Math.max(14, Math.min(22, Math.min(pxW, pxH) * 0.32));
  const sizeLabel = SIZE_DIMENSIONS[instance.size] ? SIZE_LABELS[instance.size] : instance.size;

  const a11yActions = [
    { name: 'activate', label: 'Select' },
    { name: 'moveLeft', label: 'Move left' },
    { name: 'moveRight', label: 'Move right' },
    { name: 'moveUp', label: 'Move up' },
    { name: 'moveDown', label: 'Move down' },
  ];
  const handleA11yAction = (e: AccessibilityActionEvent) => {
    switch (e.nativeEvent.actionName) {
      case 'activate':
        return onSelect(id);
      case 'moveLeft':
        return onNudge(id, -1, 0);
      case 'moveRight':
        return onNudge(id, 1, 0);
      case 'moveUp':
        return onNudge(id, 0, -1);
      case 'moveDown':
        return onNudge(id, 0, 1);
    }
  };

  return (
    <GestureDetector gesture={gesture.tile}>
      <Animated.View
        style={[styles.slot, animatedStyle]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${sizeLabel}, column ${x + 1}, row ${y + 1}${needsSetup ? ', needs setup' : ''}`}
        accessibilityHint="Drag to move. Use the actions to move one cell at a time."
        accessibilityState={{ selected }}
        accessibilityActions={a11yActions}
        onAccessibilityAction={handleA11yAction}
      >
        <View
          style={[
            styles.tile,
            {
              backgroundColor: `${tint}${selected ? '33' : '1f'}`,
              borderColor: selected ? colors.primary : `${tint}55`,
              borderWidth: selected ? 2 : 1,
            },
            horizontal ? styles.row : styles.column,
          ]}
        >
          <Ionicons
            name={(definition?.icon ?? 'help-circle-outline') as keyof typeof Ionicons.glyphMap}
            size={iconSize}
            color={tint}
          />
          {pxH >= 30 || horizontal ? (
            <Text
              style={[styles.name, horizontal ? styles.nameRow : styles.nameColumn]}
              numberOfLines={horizontal ? 1 : 2}
            >
              {name}
            </Text>
          ) : null}
          {needsSetup && <View style={styles.badge} accessibilityElementsHidden />}
        </View>
        {selected && (
          <GestureDetector gesture={gesture.resize}>
            <View
              style={styles.handleHit}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={`Resize ${name}`}
              accessibilityHint="Use the size buttons below the canvas to change size."
            >
              <View style={styles.handle}>
                <Ionicons name="resize" size={10} color={colors.background} style={styles.handleIcon} />
              </View>
            </View>
          </GestureDetector>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

export const ModuleTile = memo(ModuleTileImpl);

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    padding: TILE_INSET,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
  },
  tile: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  column: {
    flexDirection: 'column',
    gap: 2,
  },
  name: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  nameRow: {
    flexShrink: 1,
  },
  nameColumn: {
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warning,
    borderWidth: 1,
    borderColor: colors.background,
  },
  // Inside the tile's own bounds: Android does not deliver touches outside a
  // parent's frame, so a handle hanging off the corner would be half dead.
  handleHit: {
    position: 'absolute',
    right: TILE_INSET,
    bottom: TILE_INSET,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleIcon: {
    transform: [{ rotate: '90deg' }],
  },
});
