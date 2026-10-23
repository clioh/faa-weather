import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateBody } from '../middleware/validate.js';
import { layoutSchema } from '../validation/schemas.js';
import { broadcast } from '../server.js';
import { loadConfig, type MirrorOrientation } from '../config/index.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Layout storage path
const DATA_DIR = path.resolve(__dirname, '../../../../data');
const LAYOUTS_DIR = path.join(DATA_DIR, 'layouts');
const CURRENT_LAYOUT_FILE = path.join(LAYOUTS_DIR, 'current.json');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(LAYOUTS_DIR)) {
  fs.mkdirSync(LAYOUTS_DIR, { recursive: true });
}

// Types matching the mobile app's module system
interface ModulePosition {
  x: number; // 0-11 (12 column grid)
  y: number; // row position
}

type ModuleSize = 'small' | 'medium' | 'large' | 'wide' | 'tall' | 'full';

interface ModuleInstance {
  instanceId: string;
  moduleId: string;
  position: ModulePosition;
  size: ModuleSize;
  config: Record<string, unknown>;
}

interface MirrorLayout {
  id: string;
  name: string;
  modules: ModuleInstance[];
  /** Editor shelf: kept with the layout, never drawn on the mirror. */
  shelf?: ModuleInstance[];
  createdAt: string;
  updatedAt: string;
}

// Default layout for new installations: what the mirror shows until a layout
// is saved, and what new users' layouts are copied from (routes/users.ts). No
// airport is pinned, so the aviation widgets use the mirror's configured one.
function tile(
  instanceId: string,
  moduleId: string,
  x: number,
  y: number,
  size: ModuleSize,
  config: Record<string, unknown> = {}
): ModuleInstance {
  return { instanceId, moduleId, position: { x, y }, size, config };
}

const CLOCK_CONFIG = { format24h: false, showSeconds: true, showDate: true };

// Landscape: one band across the top of the 12x8 grid.
const LANDSCAPE_MODULES: ModuleInstance[] = [
  tile('clock-1', 'digital-clock', 0, 0, 'medium', CLOCK_CONFIG),
  tile('metar-1', 'metar', 4, 0, 'medium'),
  tile('flight-rules-1', 'flight-rules', 8, 0, 'small'),
  tile('sun-times-1', 'sun-times', 0, 3, 'small'),
];

// Portrait keeps the 12x8 grid but rows come out ~240px tall and columns
// ~90px wide, so tiles go six columns wide and fill the height.
const PORTRAIT_MODULES: ModuleInstance[] = [
  // Rows 0-1: clock · flight rules · sun
  tile('clock-1', 'digital-clock', 0, 0, 'wide', CLOCK_CONFIG),
  tile('flight-rules-1', 'flight-rules', 6, 0, 'small'),
  tile('sun-times-1', 'sun-times', 9, 0, 'small'),
  // Rows 2-5: METAR · TAF
  tile('metar-1', 'metar', 0, 2, 'large'),
  tile('taf-1', 'taf', 6, 2, 'large'),
  // Rows 6-7: TFRs · winds aloft
  tile('tfr-1', 'tfr', 0, 6, 'wide'),
  tile('winds-aloft-1', 'winds-aloft', 6, 6, 'wide'),
];

export function defaultLayout(orientation: MirrorOrientation = 'landscape'): MirrorLayout {
  const now = new Date().toISOString();
  const modules = orientation === 'landscape' ? LANDSCAPE_MODULES : PORTRAIT_MODULES;
  return {
    id: 'default',
    name: 'Default Layout',
    modules: structuredClone(modules),
    createdAt: now,
    updatedAt: now,
  };
}

/** The mirror's display.orientation; landscape if the config can't be read. */
function currentOrientation(): MirrorOrientation {
  try {
    return loadConfig().display?.orientation ?? 'landscape';
  } catch {
    return 'landscape';
  }
}

/**
 * Load current layout from storage
 */
export function loadCurrentLayout(): MirrorLayout {
  try {
    if (fs.existsSync(CURRENT_LAYOUT_FILE)) {
      return JSON.parse(fs.readFileSync(CURRENT_LAYOUT_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load layout:', err);
  }
  return defaultLayout(currentOrientation());
}

/**
 * Save layout to storage
 */
function saveCurrentLayout(layout: MirrorLayout): void {
  try {
    layout.updatedAt = new Date().toISOString();
    fs.writeFileSync(CURRENT_LAYOUT_FILE, JSON.stringify(layout, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save layout:', err);
    throw new Error('Failed to save layout');
  }
}

/**
 * GET /api/layout
 * Get the current mirror layout
 */
router.get('/', (_req, res) => {
  try {
    const layout = loadCurrentLayout();
    res.json(layout);
  } catch {
    res.status(500).json({ error: 'Failed to load layout' });
  }
});

/**
 * PUT /api/layout
 * Replace the entire layout
 */
router.put('/', validateBody(layoutSchema), (req, res) => {
  try {
    const layout: MirrorLayout = req.body;

    const existingLayout = loadCurrentLayout();

    // Validate each module
    for (const module of layout.modules) {
      if (!module.instanceId || !module.moduleId || !module.position || !module.size) {
        return res.status(400).json({ error: 'Invalid module structure' });
      }
    }

    layout.updatedAt = new Date().toISOString();
    if (!layout.createdAt) {
      layout.createdAt = existingLayout.createdAt || new Date().toISOString();
    }
    if (!layout.id) {
      layout.id = existingLayout.id || 'custom';
    }
    if (!layout.name) {
      layout.name = existingLayout.name || 'Custom Layout';
    }

    saveCurrentLayout(layout);
    // The mirror UI (frontend App.tsx) shows it now, or, while a recognized
    // user's own layout is up, once they leave.
    broadcast('layout-update', { layout });
    res.json({ success: true, layout });
  } catch (err) {
    console.error('Failed to update layout:', err);
    res.status(500).json({ error: 'Failed to save layout' });
  }
});

export default router;
