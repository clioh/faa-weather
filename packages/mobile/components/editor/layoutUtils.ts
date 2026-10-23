/**
 * Pure layout logic for the editor.
 *
 * Invariant the editor maintains: every tile sits fully inside the
 * GRID_COLS x GRID_ROWS grid and no two tiles overlap. Every mutation goes
 * through a helper here that returns `null` instead of producing a layout
 * that would break it.
 *
 * The small geometry helpers carry the 'worklet' directive because the drag
 * gestures call them on the UI thread to colour the drop ghost without a
 * round trip to JS.
 */

import {
  GRID_COLS,
  GRID_ROWS,
  SIZE_DIMENSIONS,
  defaultConfigFor,
  generateInstanceId,
  type ModuleDefinition,
  type ModuleInstance,
  type ModuleSize,
} from '@/lib/modules';

// Captured as plain numbers so worklets get a copy, not a module reference.
const COLS = GRID_COLS;
const ROWS = GRID_ROWS;

export interface GridRect {
  id: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
}

export interface Placement {
  x: number;
  y: number;
}

// ------------------------------------------------------------ geometry

export function rectsOverlap(
  a: { x: number; y: number; cols: number; rows: number },
  b: { x: number; y: number; cols: number; rows: number }
): boolean {
  'worklet';
  return a.x < b.x + b.cols && b.x < a.x + a.cols && a.y < b.y + b.rows && b.y < a.y + a.rows;
}

export function isInBounds(r: { x: number; y: number; cols: number; rows: number }): boolean {
  'worklet';
  return r.x >= 0 && r.y >= 0 && r.x + r.cols <= COLS && r.y + r.rows <= ROWS;
}

/** True when `r` fits in the grid and touches no tile other than `ignoreId`. */
export function canPlace(
  rects: GridRect[],
  r: { x: number; y: number; cols: number; rows: number },
  ignoreId: string | null
): boolean {
  'worklet';
  if (!isInBounds(r)) return false;
  for (let i = 0; i < rects.length; i++) {
    const other = rects[i];
    if (other.id !== ignoreId && rectsOverlap(r, other)) return false;
  }
  return true;
}

/** Shift a top-left corner just enough to keep a tile of this size on the grid. */
export function clampToGrid(x: number, y: number, cols: number, rows: number): Placement {
  'worklet';
  return {
    x: Math.max(0, Math.min(COLS - cols, x)),
    y: Math.max(0, Math.min(ROWS - rows, y)),
  };
}

// ------------------------------------------------------------ instances

/**
 * Grid footprint of a size. Saved layouts can carry sizes this build does not
 * know; treat those as small so the tile stays visible and removable.
 */
export function dimsOf(size: string): { cols: number; rows: number } {
  return SIZE_DIMENSIONS[size as ModuleSize] ?? SIZE_DIMENSIONS.small;
}

export function rectOf(m: ModuleInstance): GridRect {
  const d = dimsOf(m.size);
  return { id: m.instanceId, x: m.position.x, y: m.position.y, cols: d.cols, rows: d.rows };
}

export function toRects(modules: ModuleInstance[]): GridRect[] {
  return modules.map(rectOf);
}

/** First free top-left (row by row, then column) for a footprint, or null. */
export function findFreeSlot(
  rects: GridRect[],
  cols: number,
  rows: number,
  ignoreId: string | null = null
): Placement | null {
  for (let y = 0; y + rows <= ROWS; y++) {
    for (let x = 0; x + cols <= COLS; x++) {
      if (canPlace(rects, { x, y, cols, rows }, ignoreId)) return { x, y };
    }
  }
  return null;
}

/** Sizes ordered by area, so fallbacks shrink as little as possible. */
export function sizesSmallestFirst(sizes: ModuleSize[]): ModuleSize[] {
  return [...sizes].sort((a, b) => {
    const da = SIZE_DIMENSIONS[a];
    const db = SIZE_DIMENSIONS[b];
    return da.cols * da.rows - db.cols * db.rows || da.cols - db.cols;
  });
}

/**
 * Where a widget of this definition can go: the preferred size first, then
 * its other sizes smallest-first. Null when nothing fits anywhere.
 */
export function findPlacement(
  modules: ModuleInstance[],
  definition: ModuleDefinition,
  preferred: ModuleSize = definition.defaultSize
): { size: ModuleSize; position: Placement } | null {
  const rects = toRects(modules);
  const order = [preferred, ...sizesSmallestFirst(definition.sizes.filter((s) => s !== preferred))];
  for (const size of order) {
    const d = SIZE_DIMENSIONS[size];
    const position = findFreeSlot(rects, d.cols, d.rows);
    if (position) return { size, position };
  }
  return null;
}

/** A new instance of `definition` placed in the first free spot, or null. */
export function createInstance(
  modules: ModuleInstance[],
  definition: ModuleDefinition
): ModuleInstance | null {
  const spot = findPlacement(modules, definition);
  if (!spot) return null;
  return {
    instanceId: generateInstanceId(),
    moduleId: definition.id,
    position: spot.position,
    size: spot.size,
    config: defaultConfigFor(definition),
  };
}

/** A copy of `source` with its own id and config, placed where it fits. */
export function duplicateInstance(
  modules: ModuleInstance[],
  source: ModuleInstance,
  definition: ModuleDefinition | undefined
): ModuleInstance | null {
  const config = JSON.parse(JSON.stringify(source.config ?? {})) as Record<string, unknown>;
  if (definition) {
    const sourceSize = definition.sizes.includes(source.size) ? source.size : definition.defaultSize;
    const spot = findPlacement(modules, definition, sourceSize);
    if (!spot) return null;
    return { ...source, instanceId: generateInstanceId(), position: spot.position, size: spot.size, config };
  }
  const d = dimsOf(source.size);
  const position = findFreeSlot(toRects(modules), d.cols, d.rows);
  if (!position) return null;
  return { ...source, instanceId: generateInstanceId(), position, config };
}

/** Move a tile, or null if the target is off-grid or occupied. */
export function moveInstance(
  modules: ModuleInstance[],
  instanceId: string,
  x: number,
  y: number
): ModuleInstance[] | null {
  const target = modules.find((m) => m.instanceId === instanceId);
  if (!target) return null;
  const d = dimsOf(target.size);
  if (!canPlace(toRects(modules), { x, y, cols: d.cols, rows: d.rows }, instanceId)) return null;
  if (target.position.x === x && target.position.y === y) return modules;
  return modules.map((m) => (m.instanceId === instanceId ? { ...m, position: { x, y } } : m));
}

/**
 * Where a tile would sit at a new size: same top-left, nudged back onto the
 * grid if the bigger footprint would hang off an edge. Null when that spot
 * collides with another tile.
 */
export function placementForSize(
  modules: ModuleInstance[],
  instance: ModuleInstance,
  size: ModuleSize
): Placement | null {
  const d = SIZE_DIMENSIONS[size];
  const p = clampToGrid(instance.position.x, instance.position.y, d.cols, d.rows);
  return canPlace(toRects(modules), { ...p, cols: d.cols, rows: d.rows }, instance.instanceId) ? p : null;
}

export function resizeInstance(
  modules: ModuleInstance[],
  instanceId: string,
  size: ModuleSize
): ModuleInstance[] | null {
  const target = modules.find((m) => m.instanceId === instanceId);
  if (!target) return null;
  if (target.size === size) return modules;
  const p = placementForSize(modules, target, size);
  if (!p) return null;
  return modules.map((m) => (m.instanceId === instanceId ? { ...m, size, position: p } : m));
}

/**
 * Pull every tile up as far as it goes, then left, repeating until nothing
 * moves. Processing in reading order keeps the user's arrangement recognisable
 * (things only ever slide toward the top-left, never reshuffle).
 */
export function tidyLayout(modules: ModuleInstance[]): ModuleInstance[] {
  const order = [...modules].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const rects = toRects(order);
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 64) {
    moved = false;
    for (const r of rects) {
      while (r.y > 0 && canPlace(rects, { ...r, y: r.y - 1 }, r.id)) {
        r.y -= 1;
        moved = true;
      }
      while (r.x > 0 && canPlace(rects, { ...r, x: r.x - 1 }, r.id)) {
        r.x -= 1;
        moved = true;
      }
    }
  }
  const byId = new Map(rects.map((r) => [r.id, r]));
  // Keep the original array order so undo/redo and saved diffs stay minimal.
  return modules.map((m) => {
    const r = byId.get(m.instanceId)!;
    return r.x === m.position.x && r.y === m.position.y ? m : { ...m, position: { x: r.x, y: r.y } };
  });
}

/**
 * Bring a layout from the server or a template into line with the invariant.
 * Older layouts were saved by an editor that allowed overlaps and off-grid
 * tiles, so: clamp onto the grid, then move (or as a last resort shrink) any
 * tile that collides. Tiles that cannot fit at all are returned in `dropped`
 * so the caller can tell the user instead of losing them silently.
 */
export function normalizeLayout(
  modules: ModuleInstance[],
  getDefinition: (id: string) => ModuleDefinition | undefined
): { modules: ModuleInstance[]; dropped: ModuleInstance[] } {
  const placed: ModuleInstance[] = [];
  const dropped: ModuleInstance[] = [];
  const seen = new Set<string>();

  for (const raw of modules) {
    if (!raw || typeof raw !== 'object') continue;
    let m: ModuleInstance = {
      ...raw,
      instanceId: raw.instanceId && !seen.has(raw.instanceId) ? raw.instanceId : generateInstanceId(),
      position: {
        x: Math.round(Number(raw.position?.x) || 0),
        y: Math.round(Number(raw.position?.y) || 0),
      },
      config: raw.config ?? {},
    };
    seen.add(m.instanceId);

    const d = dimsOf(m.size);
    m = { ...m, position: clampToGrid(m.position.x, m.position.y, d.cols, d.rows) };
    const rects = toRects(placed);
    if (canPlace(rects, { ...m.position, cols: d.cols, rows: d.rows }, null)) {
      placed.push(m);
      continue;
    }

    const def = getDefinition(m.moduleId);
    const sizes: ModuleSize[] = def
      ? [m.size, ...sizesSmallestFirst(def.sizes.filter((s) => s !== m.size))]
      : [m.size];
    let fixed: ModuleInstance | null = null;
    for (const size of sizes) {
      const sd = dimsOf(size);
      const slot = findFreeSlot(rects, sd.cols, sd.rows);
      if (slot) {
        fixed = { ...m, size, position: slot };
        break;
      }
    }
    if (fixed) placed.push(fixed);
    else dropped.push(m);
  }

  return { modules: placed, dropped };
}

// ------------------------------------------------------------ shelf

/*
 * The editor keeps one working list: the mirror's tiles plus shelf entries
 * marked `shelved`. Undo/redo and the unsaved-changes check then cover the
 * shelf for free. The grid invariant only applies to the unshelved tiles.
 */

export function splitShelf(all: ModuleInstance[]): { placed: ModuleInstance[]; shelf: ModuleInstance[] } {
  const placed: ModuleInstance[] = [];
  const shelf: ModuleInstance[] = [];
  for (const m of all) (m.shelved ? shelf : placed).push(m);
  return { placed, shelf };
}

/** Replace the mirror's tiles, keeping the shelf as it is. */
export function withShelf(placed: ModuleInstance[], all: ModuleInstance[]): ModuleInstance[] {
  return [...placed, ...all.filter((m) => m.shelved)];
}

/** Move a tile off the mirror onto the end of the shelf; null if it isn't on the mirror. */
export function shelveInstance(all: ModuleInstance[], id: string): ModuleInstance[] | null {
  const tile = all.find((m) => m.instanceId === id && !m.shelved);
  if (!tile) return null;
  return [...all.filter((m) => m !== tile), { ...tile, shelved: true }];
}

/**
 * Put a shelf entry back on the mirror: at `at` when given (a drop), else in
 * the first spot it fits, shrinking to another allowed size if it must.
 * Null when there is no room.
 */
export function unshelveInstance(
  all: ModuleInstance[],
  id: string,
  definition: ModuleDefinition | undefined,
  at?: Placement
): ModuleInstance[] | null {
  const entry = all.find((m) => m.instanceId === id && m.shelved);
  if (!entry) return null;
  const { placed } = splitShelf(all);
  const { shelved: _shelved, ...tile } = entry;
  let next: ModuleInstance | null = null;
  if (at) {
    const d = dimsOf(tile.size);
    if (canPlace(toRects(placed), { ...at, cols: d.cols, rows: d.rows }, null)) {
      next = { ...tile, position: at };
    }
  } else if (definition) {
    const spot = findPlacement(placed, definition, tile.size);
    if (spot) next = { ...tile, size: spot.size, position: spot.position };
  } else {
    const d = dimsOf(tile.size);
    const slot = findFreeSlot(toRects(placed), d.cols, d.rows);
    if (slot) next = { ...tile, position: slot };
  }
  if (!next) return null;
  return [...placed, next, ...all.filter((m) => m.shelved && m !== entry)];
}

/** The shelf as saved: plain instances without the editor's flag. */
export function shelfForSave(all: ModuleInstance[]): ModuleInstance[] {
  return all.filter((m) => m.shelved).map(({ shelved: _shelved, ...m }) => m);
}

export function layoutsEqual(a: ModuleInstance[], b: ModuleInstance[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// ------------------------------------------------------------ undo / redo

export const HISTORY_LIMIT = 50;

export interface LayoutHistory {
  past: ModuleInstance[][];
  present: ModuleInstance[];
  future: ModuleInstance[][];
}

export function createHistory(present: ModuleInstance[]): LayoutHistory {
  return { past: [], present, future: [] };
}

/** Record a new state; the old one becomes the undo point. */
export function pushHistory(h: LayoutHistory, next: ModuleInstance[]): LayoutHistory {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

/**
 * Change the present without an undo point. Used while a sheet streams live
 * edits (every keystroke in a text field) so the whole session can later be
 * recorded as one step with `commitFrom`.
 */
export function replacePresent(h: LayoutHistory, next: ModuleInstance[]): LayoutHistory {
  return next === h.present ? h : { ...h, present: next };
}

/** Record `base` as the undo point for changes already applied to present. */
export function commitFrom(h: LayoutHistory, base: ModuleInstance[]): LayoutHistory {
  if (layoutsEqual(base, h.present)) return h;
  return { past: [...h.past, base].slice(-HISTORY_LIMIT), present: h.present, future: [] };
}

export function undoHistory(h: LayoutHistory): LayoutHistory {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redoHistory(h: LayoutHistory): LayoutHistory {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: rest };
}
