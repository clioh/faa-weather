/**
 * Layout templates
 *
 * Starting layouts for the 12x8 mirror grid. Every template must pass
 * validateTemplate(): known widget ids, allowed sizes, config keys that exist
 * in the catalog, tiles inside the grid and no overlaps. Configs only set
 * what differs from the catalog default (or what makes the template's point),
 * and never pin an airport or location so they follow the mirror's own.
 */

import {
  GRID_COLS,
  GRID_ROWS,
  SIZE_DIMENSIONS,
  getModuleById,
  ModuleInstance,
  ModuleSize,
} from './modules';

export type TemplateCategory = 'aviation' | 'weather' | 'lifestyle' | 'minimal';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // Ionicons name
  category: TemplateCategory;
  modules: Omit<ModuleInstance, 'instanceId'>[];
}

export const TEMPLATE_CATEGORIES: Record<TemplateCategory, { label: string; icon: string }> = {
  aviation: { label: 'Aviation', icon: 'airplane' },
  weather: { label: 'Weather', icon: 'partly-sunny' },
  lifestyle: { label: 'Lifestyle', icon: 'home' },
  minimal: { label: 'Minimal', icon: 'remove' },
};

type TemplateModule = Omit<ModuleInstance, 'instanceId'>;

function tile(moduleId: string, x: number, y: number, size: ModuleSize, config: Record<string, unknown> = {}): TemplateModule {
  return { moduleId, position: { x, y }, size, config };
}

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  // ------------------------------------------------------------- Aviation
  {
    id: 'pilot-briefing',
    name: 'Pilot Briefing',
    description: 'METAR, TAF, NOTAMs, TFRs and winds aloft for flight planning',
    icon: 'airplane',
    category: 'aviation',
    modules: [
      // Rows 0-1: clock · flight rules · sun
      tile('digital-clock', 0, 0, 'wide', { format24h: true, showZulu: true }),
      tile('flight-rules', 6, 0, 'small'),
      tile('sun-times', 9, 0, 'small', { showTwilight: true }),
      // Rows 2-5: METAR · NOTAMs · TFRs
      tile('metar', 0, 2, 'large', { showRaw: true }),
      tile('notams', 6, 2, 'tall', { maxItems: 5 }),
      tile('tfr', 9, 2, 'tall'),
      // Rows 6-7: TAF · winds aloft
      tile('taf', 0, 6, 'wide', { hoursAhead: 24 }),
      tile('winds-aloft', 6, 6, 'wide'),
    ],
  },
  {
    id: 'crew-day',
    name: 'Crew Day',
    description: 'Your trips, Zulu and home-base time, and the weather where you are',
    icon: 'briefcase',
    category: 'aviation',
    modules: [
      tile('digital-clock', 0, 0, 'wide', { format24h: true, showZulu: true }),
      tile('world-clocks', 6, 0, 'wide', {
        timezones: ['America/New_York', 'America/Chicago', 'America/Los_Angeles'],
      }),
      tile('calendar', 0, 2, 'tall', { mode: 'flights', daysAhead: 3 }),
      tile('metar', 3, 2, 'large'),
      tile('tfr', 9, 2, 'tall', { radiusNm: 50 }),
      tile('sun-times', 0, 6, 'small'),
      tile('taf', 3, 6, 'wide'),
      tile('flight-rules', 9, 6, 'small', { showDetails: false }),
    ],
  },

  // -------------------------------------------------------------- Weather
  {
    id: 'weather-dashboard',
    name: 'Weather Dashboard',
    description: 'Current conditions, the week ahead and live radar',
    icon: 'partly-sunny',
    category: 'weather',
    modules: [
      tile('digital-clock', 0, 0, 'medium', { showSeconds: true }),
      tile('current-weather', 4, 0, 'medium'),
      tile('sun-times', 8, 0, 'small'),
      tile('weather-forecast', 0, 3, 'wide', { days: 5 }),
      tile('radar-map', 6, 3, 'large', { animated: true }),
    ],
  },

  // -------------------------------------------------------------- Minimal
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'A large clock and the weather, nothing else',
    icon: 'remove',
    category: 'minimal',
    modules: [
      tile('digital-clock', 3, 1, 'large', { showZulu: false }),
      tile('current-weather', 3, 5, 'wide'),
    ],
  },

  // ------------------------------------------------------------ Lifestyle
  {
    id: 'morning-routine',
    name: 'Morning Routine',
    description: 'Time, weather, your day and the headlines',
    icon: 'sunny',
    category: 'lifestyle',
    modules: [
      tile('digital-clock', 0, 0, 'medium', { showZulu: false }),
      tile('current-weather', 4, 0, 'small'),
      tile('sun-times', 7, 0, 'small', { showTwilight: false }),
      tile('calendar', 0, 3, 'tall', { maxEvents: 8, daysAhead: 7 }),
      tile('news', 3, 3, 'tall', { source: 'world', maxItems: 5 }),
      tile('quotes', 6, 3, 'wide', { category: 'motivational' }),
    ],
  },
  {
    id: 'home-hub',
    name: 'Home Hub',
    description: 'Family photos with your schedule, headlines and markets',
    icon: 'images',
    category: 'lifestyle',
    modules: [
      tile('photo-frame', 0, 0, 'large', { interval: 30 }),
      tile('digital-clock', 6, 0, 'small', { showZulu: false }),
      tile('current-weather', 9, 0, 'small'),
      tile('calendar', 6, 2, 'tall', { daysAhead: 7 }),
      tile('news', 9, 2, 'tall', { source: 'world', maxItems: 5 }),
      tile('stocks', 0, 4, 'wide', { symbols: ['SPY', 'QQQ', 'AAPL'] }),
      tile('crypto', 6, 6, 'small', { coins: ['BTC', 'ETH'] }),
      tile('quotes', 0, 6, 'wide', { category: 'wisdom' }),
    ],
  },
  {
    id: 'information-dense',
    name: 'Information Dense',
    description: 'Everything at a glance: aviation, weather, schedule and markets',
    icon: 'grid',
    category: 'lifestyle',
    modules: [
      tile('digital-clock', 0, 0, 'small'),
      tile('current-weather', 3, 0, 'small'),
      tile('flight-rules', 6, 0, 'small'),
      tile('sun-times', 9, 0, 'small', { showTwilight: false }),
      tile('metar', 0, 2, 'medium', { showRaw: false }),
      tile('taf', 4, 2, 'medium'),
      tile('calendar', 8, 2, 'medium', { maxEvents: 4 }),
      tile('quotes', 0, 5, 'wide', { category: 'aviation' }),
      tile('stocks', 6, 5, 'wide', { symbols: ['AAPL', 'GOOGL', 'MSFT'] }),
    ],
  },
];

/**
 * Problems with a template, as human-readable strings; empty when valid.
 * Checks the template against the widget catalog and the 12x8 grid.
 */
export function validateTemplate(template: LayoutTemplate): string[] {
  const problems: string[] = [];
  const occupied: (string | null)[][] = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => null as string | null)
  );

  template.modules.forEach((mod, index) => {
    const where = `${template.id}[${index}] ${mod.moduleId}`;
    const def = getModuleById(mod.moduleId);
    if (!def) {
      problems.push(`${where}: unknown widget id`);
      return;
    }
    if (!def.sizes.includes(mod.size)) {
      problems.push(`${where}: size "${mod.size}" not allowed (allowed: ${def.sizes.join(', ')})`);
    }

    for (const [key, value] of Object.entries(mod.config ?? {})) {
      const field = def.configFields.find((f) => f.key === key);
      if (!field) {
        problems.push(`${where}: config key "${key}" is not a field of this widget`);
        continue;
      }
      const bad = (expected: string) =>
        problems.push(`${where}: "${key}" should be ${expected}, got ${JSON.stringify(value)}`);
      switch (field.type) {
        case 'number':
          if (typeof value !== 'number' || !Number.isFinite(value)) bad('a number');
          else if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))
            bad(`within ${field.min}–${field.max}`);
          break;
        case 'boolean':
          if (typeof value !== 'boolean') bad('a boolean');
          break;
        case 'list':
          if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) bad('an array of strings');
          break;
        case 'select':
          if (!field.options?.some((o) => o.value === value)) {
            bad(`one of ${field.options?.map((o) => o.value).join(', ')}`);
          }
          break;
        case 'date':
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('a YYYY-MM-DD string');
          break;
        case 'location':
          if (
            typeof value !== 'object' ||
            value === null ||
            typeof (value as { latitude?: unknown }).latitude !== 'number' ||
            typeof (value as { longitude?: unknown }).longitude !== 'number'
          )
            bad('{ latitude, longitude }');
          break;
        default:
          if (typeof value !== 'string') bad('a string');
      }
    }

    // A template should never land on the mirror already asking for setup.
    for (const field of def.configFields) {
      if (!field.required) continue;
      if (field.showWhen && (mod.config?.[field.showWhen.key] ?? def.configFields.find((f) => f.key === field.showWhen!.key)?.default) !== field.showWhen.value) continue;
      const v = mod.config?.[field.key] ?? field.default;
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)) {
        problems.push(`${where}: required field "${field.key}" is empty`);
      }
    }

    const dims = SIZE_DIMENSIONS[mod.size];
    if (!dims) return;
    const { x, y } = mod.position;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + dims.cols > GRID_COLS || y + dims.rows > GRID_ROWS) {
      problems.push(`${where}: at (${x},${y}) size ${dims.cols}x${dims.rows} falls outside the ${GRID_COLS}x${GRID_ROWS} grid`);
      return;
    }
    for (let r = y; r < y + dims.rows; r++) {
      for (let c = x; c < x + dims.cols; c++) {
        const other = occupied[r][c];
        if (other) {
          problems.push(`${where}: overlaps ${other} at cell (${c},${r})`);
          return;
        }
      }
    }
    for (let r = y; r < y + dims.rows; r++) {
      for (let c = x; c < x + dims.cols; c++) occupied[r][c] = `${mod.moduleId}#${index}`;
    }
  });

  if (template.modules.length === 0) problems.push(`${template.id}: has no widgets`);
  return problems;
}

export function getTemplateById(id: string): LayoutTemplate | undefined {
  return LAYOUT_TEMPLATES.find((t) => t.id === id);
}
