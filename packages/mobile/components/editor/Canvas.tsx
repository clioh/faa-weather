/**
 * The mirror canvas: a framed 12 x 8 grid at the mirror's real aspect ratio,
 * so a tile's proportions on the phone match what the mirror will draw.
 * Cells are width/12 by height/8 and therefore not square.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle } from 'react-native-svg';
import { GRID_COLS, GRID_ROWS, getModuleById, type ModuleInstance, type ModuleSize } from '@/lib/modules';
import { colors } from '@/lib/theme';
import { toRects, type GridRect } from './layoutUtils';
import { ModuleTile, TILE_INSET, type GhostValues } from './ModuleTile';

export type MirrorOrientation = 'landscape' | 'portrait';

const FRAME = 1; // hairline frame around the glass
const GUTTER = 24; // screen gutter

interface CanvasProps {
  modules: ModuleInstance[];
  orientation: MirrorOrientation;
  selectedId: string | null;
  pulse: { id: string; key: number } | null;
  revision: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, size: ModuleSize) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
  /** Rendered centred over the glass, e.g. the empty state. */
  overlay?: ReactNode;
}

function fitCanvas(availW: number, availH: number, orientation: MirrorOrientation) {
  const aspect = orientation === 'portrait' ? 9 / 16 : 16 / 9;
  const maxW = Math.max(0, availW - GUTTER * 2 - FRAME * 2);
  const maxH = Math.max(0, availH - FRAME * 2);
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { width: Math.floor(w), height: Math.floor(h) };
}

export function Canvas({
  modules,
  orientation,
  selectedId,
  pulse,
  revision,
  onSelect,
  onMove,
  onResize,
  onNudge,
  overlay,
}: CanvasProps) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  const { width, height } = fitCanvas(area.width, area.height, orientation);
  const cellW = width / GRID_COLS;
  const cellH = height / GRID_ROWS;

  const rects = useSharedValue<GridRect[]>([]);
  useEffect(() => {
    rects.value = toRects(modules);
  }, [modules, rects]);

  const ghost: GhostValues = {
    x: useSharedValue(0),
    y: useSharedValue(0),
    cols: useSharedValue(1),
    rows: useSharedValue(1),
    visible: useSharedValue(0),
    valid: useSharedValue(1),
    lock: useSharedValue(''),
  };
  // Stable identity so memoised tiles don't rebuild their gestures every render.
  const [ghostRef] = useState(ghost);

  const ghostStyle = useAnimatedStyle(() => {
    const valid = ghostRef.valid.value === 1;
    // Glide between snapped cells, but jump straight to the first cell of a
    // new drag instead of sliding over from where the last one ended.
    const hidden = ghostRef.visible.value < 0.05;
    const glide = (v: number) => (hidden ? v : withTiming(v, { duration: 90 }));
    return {
      opacity: ghostRef.visible.value,
      left: glide(ghostRef.x.value * cellW + TILE_INSET),
      top: glide(ghostRef.y.value * cellH + TILE_INSET),
      width: glide(ghostRef.cols.value * cellW - TILE_INSET * 2),
      height: glide(ghostRef.rows.value * cellH - TILE_INSET * 2),
      borderColor: valid ? colors.primary : colors.error,
      backgroundColor: valid ? colors.ghostValid : colors.ghostInvalid,
    };
  });

  const deselect = () => onSelect(null);
  const backgroundTap = Gesture.Tap().onEnd((_e, success) => {
    if (success) scheduleOnRN(deselect);
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== area.width || h !== area.height) setArea({ width: w, height: h });
  };

  const ready = width > 0 && height > 0;

  return (
    <View style={styles.area} onLayout={onLayout}>
      {ready && (
        <View style={styles.frame}>
          <View
            style={[styles.glass, { width, height }]}
            accessibilityLabel={`Mirror canvas, ${orientation}, ${modules.length} widget${modules.length === 1 ? '' : 's'}`}
          >
            {/* Sibling under the tiles (not a parent) so a tap on a tile never also deselects. */}
            <GestureDetector gesture={backgroundTap}>
              <View style={StyleSheet.absoluteFill}>
                <Svg width={width} height={height}>
                  {Array.from({ length: (GRID_COLS + 1) * (GRID_ROWS + 1) }, (_, i) => {
                    const cx = (i % (GRID_COLS + 1)) * cellW;
                    const cy = Math.floor(i / (GRID_COLS + 1)) * cellH;
                    return <Circle key={i} cx={cx} cy={cy} r={1} fill={colors.gridDot} />;
                  })}
                </Svg>
              </View>
            </GestureDetector>

            <Animated.View pointerEvents="none" style={[styles.ghost, ghostStyle]} />

            {modules.map((m) => (
              <ModuleTile
                key={m.instanceId}
                instance={m}
                definition={getModuleById(m.moduleId)}
                cellW={cellW}
                cellH={cellH}
                selected={m.instanceId === selectedId}
                rects={rects}
                ghost={ghostRef}
                pulseKey={pulse && pulse.id === m.instanceId ? pulse.key : 0}
                revision={revision}
                onSelect={onSelect}
                onMove={onMove}
                onResize={onResize}
                onNudge={onNudge}
              />
            ))}

            {overlay ? (
              <View style={styles.overlay} pointerEvents="box-none">
                {overlay}
              </View>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Canvas sits right under the status row, as in the mockup.
  area: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  frame: {
    borderRadius: 10,
    borderWidth: FRAME,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  glass: {
    backgroundColor: colors.background,
  },
  ghost: {
    position: 'absolute',
    borderRadius: 5,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
