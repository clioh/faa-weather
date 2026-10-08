import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateBody } from '../middleware/validate.js';
import {
  layoutSchema,
  addModuleSchema,
  moduleUpdateSchema,
  oauthTokenSchema,
  saveLayoutSchema,
} from '../validation/schemas.js';
import { resolveSafePath } from '../validation/safe-id.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Layout storage path
const DATA_DIR = path.resolve(__dirname, '../../../../data');
const LAYOUTS_DIR = path.join(DATA_DIR, 'layouts');
const CURRENT_LAYOUT_FILE = path.join(LAYOUTS_DIR, 'current.json');
const OAUTH_TOKENS_FILE = path.join(DATA_DIR, 'oauth_tokens.json');

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
  createdAt: string;
  updatedAt: string;
}

interface OAuthTokens {
  [widgetInstanceId: string]: {
    provider: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry?: number;
  };
}

// Default layout for new installations
const DEFAULT_LAYOUT: MirrorLayout = {
  id: 'default',
  name: 'Default Layout',
  modules: [
    {
      instanceId: 'clock-1',
      moduleId: 'digital-clock',
      position: { x: 0, y: 0 },
      size: 'medium',
      config: { format24h: false, showSeconds: true, showDate: true },
    },
    {
      instanceId: 'metar-1',
      moduleId: 'metar',
      position: { x: 4, y: 0 },
      size: 'medium',
      config: { icao: 'KJFK', showDecoded: true },
    },
    {
      instanceId: 'flight-rules-1',
      moduleId: 'flight-rules',
      position: { x: 8, y: 0 },
      size: 'small',
      config: { icao: 'KJFK' },
    },
    {
      instanceId: 'sun-times-1',
      moduleId: 'sun-times',
      position: { x: 0, y: 3 },
      size: 'small',
      config: {},
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Load OAuth tokens from storage
 */
function loadOAuthTokens(): OAuthTokens {
  try {
    if (fs.existsSync(OAUTH_TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(OAUTH_TOKENS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load OAuth tokens:', err);
  }
  return {};
}

/**
 * Save OAuth tokens to storage
 */
function saveOAuthTokens(tokens: OAuthTokens): void {
  try {
    fs.writeFileSync(OAUTH_TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save OAuth tokens:', err);
  }
}

/**
 * Load current layout from storage
 */
function loadCurrentLayout(): MirrorLayout {
  try {
    if (fs.existsSync(CURRENT_LAYOUT_FILE)) {
      return JSON.parse(fs.readFileSync(CURRENT_LAYOUT_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load layout:', err);
  }
  return { ...DEFAULT_LAYOUT };
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

    // Preserve OAuth tokens when updating layout
    loadOAuthTokens(); // Ensure tokens are loaded
    const existingLayout = loadCurrentLayout();

    // Validate each module
    for (const module of layout.modules) {
      if (!module.instanceId || !module.moduleId || !module.position || !module.size) {
        return res.status(400).json({ error: 'Invalid module structure' });
      }

      // Preserve OAuth tokens from existing modules
      const existingModule = existingLayout.modules.find(
        (m) => m.instanceId === module.instanceId
      );
      if (existingModule?.config.accessToken) {
        module.config.accessToken = existingModule.config.accessToken;
        module.config.refreshToken = existingModule.config.refreshToken;
        module.config.tokenExpiry = existingModule.config.tokenExpiry;
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
    res.json({ success: true, layout });
  } catch (err) {
    console.error('Failed to update layout:', err);
    res.status(500).json({ error: 'Failed to save layout' });
  }
});

/**
 * POST /api/layout/module
 * Add a new module to the layout
 */
router.post('/module', validateBody(addModuleSchema), (req, res) => {
  try {
    const module: ModuleInstance = req.body;

    const layout = loadCurrentLayout();

    // Check if instance ID already exists
    const existing = layout.modules.findIndex((m) => m.instanceId === module.instanceId);
    if (existing !== -1) {
      return res.status(409).json({ error: 'Module with this instanceId already exists' });
    }

    layout.modules.push(module);
    saveCurrentLayout(layout);

    res.json({ success: true, module });
  } catch {
    res.status(500).json({ error: 'Failed to add module' });
  }
});

/**
 * GET /api/layout/module/:instanceId
 * Get a specific module by its instance ID
 */
router.get('/module/:instanceId', (req, res) => {
  try {
    const { instanceId } = req.params;
    const layout = loadCurrentLayout();

    const module = layout.modules.find((m) => m.instanceId === instanceId);
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    res.json(module);
  } catch {
    res.status(500).json({ error: 'Failed to load module' });
  }
});

/**
 * PATCH /api/layout/module/:instanceId
 * Update a module's configuration or position
 */
router.patch('/module/:instanceId', validateBody(moduleUpdateSchema), (req, res) => {
  try {
    const instanceId = req.params.instanceId as string;
    const updates = req.body;

    const layout = loadCurrentLayout();
    const moduleIndex = layout.modules.findIndex((m) => m.instanceId === instanceId);

    if (moduleIndex === -1) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const module = layout.modules[moduleIndex];

    // Update position if provided
    if (updates.position) {
      module.position = { ...module.position, ...updates.position };
    }

    // Update size if provided
    if (updates.size) {
      module.size = updates.size;
    }

    // Update config if provided
    if (updates.config) {
      module.config = { ...module.config, ...updates.config };

      // Handle OAuth tokens specially - store them securely
      if (updates.config.accessToken) {
        const oauthTokens = loadOAuthTokens();
        oauthTokens[instanceId] = {
          provider: updates.config.provider as string || 'unknown',
          accessToken: updates.config.accessToken as string,
          refreshToken: updates.config.refreshToken as string | undefined,
          tokenExpiry: updates.config.tokenExpiry as number | undefined,
        };
        saveOAuthTokens(oauthTokens);
      }
    }

    layout.modules[moduleIndex] = module;
    saveCurrentLayout(layout);

    res.json({ success: true, module });
  } catch (err) {
    console.error('Failed to update module:', err);
    res.status(500).json({ error: 'Failed to update module' });
  }
});

/**
 * DELETE /api/layout/module/:instanceId
 * Remove a module from the layout
 */
router.delete('/module/:instanceId', (req, res) => {
  try {
    const { instanceId } = req.params;

    const layout = loadCurrentLayout();
    const moduleIndex = layout.modules.findIndex((m) => m.instanceId === instanceId);

    if (moduleIndex === -1) {
      return res.status(404).json({ error: 'Module not found' });
    }

    layout.modules.splice(moduleIndex, 1);
    saveCurrentLayout(layout);

    // Also remove any stored OAuth tokens
    const oauthTokens = loadOAuthTokens();
    if (oauthTokens[instanceId]) {
      delete oauthTokens[instanceId];
      saveOAuthTokens(oauthTokens);
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete module' });
  }
});

/**
 * POST /api/layout/oauth/:instanceId
 * Store OAuth tokens for a widget (called by mobile app after OAuth flow)
 */
router.post('/oauth/:instanceId', validateBody(oauthTokenSchema), (req, res) => {
  try {
    const instanceId = req.params.instanceId as string;
    const { provider, accessToken, refreshToken, tokenExpiry } = req.body;

    // Store in OAuth tokens file
    const oauthTokens = loadOAuthTokens();
    oauthTokens[instanceId] = {
      provider: provider || 'unknown',
      accessToken,
      refreshToken,
      tokenExpiry,
    };
    saveOAuthTokens(oauthTokens);

    // Also update the module config
    const layout = loadCurrentLayout();
    const module = layout.modules.find((m) => m.instanceId === instanceId);
    if (module) {
      module.config.accessToken = accessToken;
      module.config.refreshToken = refreshToken;
      module.config.tokenExpiry = tokenExpiry;
      saveCurrentLayout(layout);
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to store OAuth tokens' });
  }
});

/**
 * DELETE /api/layout/oauth/:instanceId
 * Remove OAuth tokens for a widget (disconnect account)
 */
router.delete('/oauth/:instanceId', (req, res) => {
  try {
    const { instanceId } = req.params;

    // Remove from OAuth tokens file
    const oauthTokens = loadOAuthTokens();
    if (oauthTokens[instanceId]) {
      delete oauthTokens[instanceId];
      saveOAuthTokens(oauthTokens);
    }

    // Also update the module config
    const layout = loadCurrentLayout();
    const module = layout.modules.find((m) => m.instanceId === instanceId);
    if (module) {
      delete module.config.accessToken;
      delete module.config.refreshToken;
      delete module.config.tokenExpiry;
      saveCurrentLayout(layout);
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to remove OAuth tokens' });
  }
});

/**
 * GET /api/layout/saved
 * List all saved layouts
 */
router.get('/saved', (_req, res) => {
  try {
    const files = fs.readdirSync(LAYOUTS_DIR).filter((f) => f.endsWith('.json'));
    const layouts = [];
    for (const file of files) {
      const filePath = resolveSafePath(LAYOUTS_DIR, file.slice(0, -'.json'.length), '.json');
      if (!filePath) continue; // skip anything not matching the safe id format
      try {
        const layout: MirrorLayout = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        layouts.push({
          id: layout.id,
          name: layout.name,
          moduleCount: Array.isArray(layout.modules) ? layout.modules.length : 0,
          updatedAt: layout.updatedAt,
        });
      } catch {
        // Skip unreadable/corrupt layout files rather than failing the whole list
      }
    }
    res.json(layouts);
  } catch {
    res.status(500).json({ error: 'Failed to list layouts' });
  }
});

/**
 * POST /api/layout/save
 * Save current layout with a name
 */
router.post('/save', validateBody(saveLayoutSchema), (req, res) => {
  try {
    const { name } = req.body;

    const layout = loadCurrentLayout();
    const layoutId = `layout-${Date.now()}`;

    const savedLayout: MirrorLayout = {
      ...layout,
      id: layoutId,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const filePath = resolveSafePath(LAYOUTS_DIR, layoutId, '.json');
    if (!filePath) {
      return res.status(500).json({ error: 'Failed to save layout' });
    }
    fs.writeFileSync(filePath, JSON.stringify(savedLayout, null, 2), 'utf-8');

    res.json({ success: true, layout: savedLayout });
  } catch {
    res.status(500).json({ error: 'Failed to save layout' });
  }
});

/**
 * POST /api/layout/load/:layoutId
 * Load a saved layout as the current layout
 */
router.post('/load/:layoutId', (req, res) => {
  try {
    const { layoutId } = req.params;
    const filePath = resolveSafePath(LAYOUTS_DIR, layoutId, '.json');
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid layout id' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Layout not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const layout: MirrorLayout = JSON.parse(content);

    // Make it the current layout
    saveCurrentLayout(layout);

    res.json({ success: true, layout });
  } catch {
    res.status(500).json({ error: 'Failed to load layout' });
  }
});

/**
 * DELETE /api/layout/saved/:layoutId
 * Delete a saved layout
 */
router.delete('/saved/:layoutId', (req, res) => {
  try {
    const { layoutId } = req.params;

    // Prevent deleting the current layout file
    if (layoutId === 'current') {
      return res.status(400).json({ error: 'Cannot delete current layout' });
    }

    const filePath = resolveSafePath(LAYOUTS_DIR, layoutId, '.json');
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid layout id' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Layout not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete layout' });
  }
});

/**
 * POST /api/layout/reset
 * Reset to the default layout
 */
router.post('/reset', (_req, res) => {
  try {
    const defaultLayout = { ...DEFAULT_LAYOUT };
    defaultLayout.createdAt = new Date().toISOString();
    defaultLayout.updatedAt = new Date().toISOString();

    saveCurrentLayout(defaultLayout);
    res.json({ success: true, layout: defaultLayout });
  } catch {
    res.status(500).json({ error: 'Failed to reset layout' });
  }
});

export default router;
