import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateBody } from '../middleware/validate.js';
import { layoutSchema, oauthTokenSchema } from '../validation/schemas.js';
import { broadcast } from '../server.js';

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
  /** Editor shelf: kept with the layout, never drawn on the mirror. */
  shelf?: ModuleInstance[];
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
export function loadCurrentLayout(): MirrorLayout {
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
    // The mirror UI (frontend App.tsx) swaps to the new layout on this message.
    broadcast('layout-update', { layout });
    res.json({ success: true, layout });
  } catch (err) {
    console.error('Failed to update layout:', err);
    res.status(500).json({ error: 'Failed to save layout' });
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

export default router;
