/**
 * Layout templates
 *
 * Starting layouts for the 12x8 mirror grid. Every template must pass
 * validateTemplate(): known widget ids, allowed sizes, config keys that exist
 * in the catalog, tiles inside the grid and no overlaps. Configs only set
 * what differs from the catalog default (or what makes the template's point),
 * and never pin an airport or location so they follow the mirror's own.
 *
 * A portrait mirror keeps the 12x8 grid, but its rows come out ~240px tall
 * and its columns ~90px wide (1080x1920), so every landscape template has a
 * portrait variant (PORTRAIT_TEMPLATES, id `<id>-portrait`) that fills the
 * height: lists are at least four columns wide, METAR is large and TAF at
 * least six columns wide. templatesFor() picks the set for the mirror.
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
export type TemplateOrientation = 'landscape' | 'portrait';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // Ionicons name
  category: TemplateCategory;
  orientation: TemplateOrientation;
  modules: Omit<ModuleInstance, 'instanceId'>[];
}

export const TEMPLATE_CATEGORIES: Record<TemplateCategory, { label: string; icon: string }> = {
  aviation: { label: 'Aviation', icon: 'airplane' },
  weather: { label: 'Weather', icon: 'partly-sunny' },
  lifestyle: { label: 'Lifestyle', icon: 'home' },
  minimal: { label: 'Minimal', icon: 'remove' },
};

type TemplateModule = Omit<ModuleInstance, 'instanceId'>;

function tile(
  moduleId: string,
  x: number,
  y: number,
  size: ModuleSize,
  config: Record<string, unknown> = {}
): TemplateModule {
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
    orientation: 'landscape',
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
    orientation: 'landscape',
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
    orientation: 'landscape',
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
    orientation: 'landscape',
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
    orientation: 'landscape',
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
    orientation: 'landscape',
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
    orientation: 'landscape',
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

/** A portrait variant: same name, blurb and category as the landscape one. */
function portraitOf(id: string, modules: TemplateModule[]): LayoutTemplate {
  const base = LAYOUT_TEMPLATES.find((t) => t.id === id);
  if (!base) throw new Error(`No landscape template "${id}"`);
  return { ...base, id: `${id}-portrait`, orientation: 'portrait', modules };
}

export const PORTRAIT_TEMPLATES: LayoutTemplate[] = [
  // ------------------------------------------------------------- Aviation
  portraitOf('pilot-briefing', [
    // Rows 0-1: clock · flight rules · winds aloft
    tile('digital-clock', 0, 0, 'small', { format24h: true, showZulu: true }),
    tile('flight-rules', 3, 0, 'small'),
    tile('winds-aloft', 6, 0, 'wide'),
    // Rows 2-5: METAR · NOTAMs
    tile('metar', 0, 2, 'large', { showRaw: true }),
    tile('notams', 6, 2, 'large', { maxItems: 8 }),
    // Rows 6-7: TAF · TFRs
    tile('taf', 0, 6, 'wide', { hoursAhead: 24 }),
    tile('tfr', 6, 6, 'wide'),
  ]),
  portraitOf('crew-day', [
    tile('digital-clock', 0, 0, 'wide', { format24h: true, showZulu: true }),
    tile('world-clocks', 6, 0, 'wide', {
      timezones: ['America/New_York', 'America/Chicago', 'America/Los_Angeles'],
    }),
    tile('calendar', 0, 2, 'large', { mode: 'flights', daysAhead: 3 }),
    tile('metar', 6, 2, 'large'),
    tile('taf', 0, 6, 'wide'),
    tile('sun-times', 6, 6, 'small'),
    tile('flight-rules', 9, 6, 'small', { showDetails: false }),
  ]),

  // -------------------------------------------------------------- Weather
  portraitOf('weather-dashboard', [
    tile('digital-clock', 0, 0, 'wide', { showSeconds: true }),
    tile('current-weather', 6, 0, 'wide'),
    tile('radar-map', 0, 2, 'full', { animated: true }),
    tile('weather-forecast', 0, 6, 'wide', { days: 5 }),
    tile('sun-times', 6, 6, 'wide'),
  ]),

  // -------------------------------------------------------------- Minimal
  // Already a centred stack, which reads the same on a tall panel.
  portraitOf('minimal', [
    tile('digital-clock', 3, 1, 'large', { showZulu: false }),
    tile('current-weather', 3, 5, 'wide'),
  ]),

  // ------------------------------------------------------------ Lifestyle
  portraitOf('morning-routine', [
    tile('digital-clock', 0, 0, 'wide', { showZulu: false }),
    tile('current-weather', 6, 0, 'wide'),
    tile('calendar', 0, 2, 'large', { maxEvents: 8, daysAhead: 7 }),
    tile('news', 6, 2, 'large', { source: 'world', maxItems: 5 }),
    tile('quotes', 0, 6, 'wide', { category: 'motivational' }),
    tile('sun-times', 6, 6, 'wide', { showTwilight: false }),
  ]),
  portraitOf('home-hub', [
    tile('photo-frame', 0, 0, 'large', { interval: 30 }),
    tile('digital-clock', 6, 0, 'small', { showZulu: false }),
    tile('current-weather', 9, 0, 'small'),
    tile('stocks', 6, 2, 'wide', { symbols: ['SPY', 'QQQ', 'AAPL'] }),
    tile('calendar', 0, 4, 'large', { daysAhead: 7 }),
    tile('news', 6, 4, 'large', { source: 'world', maxItems: 5 }),
  ]),
  portraitOf('information-dense', [
    tile('digital-clock', 0, 0, 'small'),
    tile('current-weather', 3, 0, 'small'),
    tile('flight-rules', 6, 0, 'small'),
    tile('sun-times', 9, 0, 'small', { showTwilight: false }),
    tile('metar', 0, 2, 'large', { showRaw: false }),
    tile('calendar', 6, 2, 'large', { maxEvents: 6 }),
    tile('taf', 0, 6, 'wide'),
    tile('stocks', 6, 6, 'wide', { symbols: ['AAPL', 'GOOGL', 'MSFT'] }),
  ]),
];

/** The templates that suit a mirror mounted this way. */
export function templatesFor(orientation: TemplateOrientation): LayoutTemplate[] {
  return orientation === 'portrait' ? PORTRAIT_TEMPLATES : LAYOUT_TEMPLATES;
}

/**
 * Narrowest a widget may be on a portrait mirror, in columns: lists need four
 * to keep their lines readable, TAF's timeline six. METAR must be large.
 */
const PORTRAIT_MIN_COLS: Record<string, number> = {
  notams: 4,
  tfr: 4,
  'winds-aloft': 4,
  calendar: 4,
  news: 4,
  stocks: 4,
  crypto: 4,
  'todo-list': 4,
  taf: 6,
};

/**
 * Problems with a template, as human-readable strings; empty when valid.
 * Checks the template against the widget catalog and the 12x8 grid, and a
 * portrait template against PORTRAIT_MIN_COLS.
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
          else if (
            (field.min !== undefined && value < field.min) ||
            (field.max !== undefined && value > field.max)
          )
            bad(`within ${field.min}–${field.max}`);
          break;
        case 'boolean':
          if (typeof value !== 'boolean') bad('a boolean');
          break;
        case 'list':
          if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
            bad('an array of strings');
          break;
        case 'select':
          if (!field.options?.some((o) => o.value === value)) {
            bad(`one of ${field.options?.map((o) => o.value).join(', ')}`);
          }
          break;
        case 'date':
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
            bad('a YYYY-MM-DD string');
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
      if (
        field.showWhen &&
        (mod.config?.[field.showWhen.key] ??
          def.configFields.find((f) => f.key === field.showWhen!.key)?.default) !==
          field.showWhen.value
      )
        continue;
      const v = mod.config?.[field.key] ?? field.default;
      if (
        v === undefined ||
        v === null ||
        (typeof v === 'string' && v.trim() === '') ||
        (Array.isArray(v) && v.length === 0)
      ) {
        problems.push(`${where}: required field "${field.key}" is empty`);
      }
    }

    const dims = SIZE_DIMENSIONS[mod.size];
    if (!dims) return;
    if (template.orientation === 'portrait') {
      const minCols = PORTRAIT_MIN_COLS[mod.moduleId];
      if (minCols && dims.cols < minCols)
        problems.push(`${where}: ${dims.cols} columns is too narrow in portrait (min ${minCols})`);
      if (mod.moduleId === 'metar' && mod.size !== 'large')
        problems.push(`${where}: METAR should be large in portrait`);
    }
    const { x, y } = mod.position;
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x + dims.cols > GRID_COLS ||
      y + dims.rows > GRID_ROWS
    ) {
      problems.push(
        `${where}: at (${x},${y}) size ${dims.cols}x${dims.rows} falls outside the ${GRID_COLS}x${GRID_ROWS} grid`
      );
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

/** Either orientation's template, by id. */
export function getTemplateById(id: string): LayoutTemplate | undefined {
  return LAYOUT_TEMPLATES.find((t) => t.id === id) ?? PORTRAIT_TEMPLATES.find((t) => t.id === id);
}
