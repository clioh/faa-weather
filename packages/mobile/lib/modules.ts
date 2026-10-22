/**
 * Widget catalog
 *
 * Single source of truth for the widgets a mirror can show: ids, categories,
 * allowed sizes, and the settings the phone app exposes for each one.
 *
 * The mirror UI keeps a matching registry in
 * packages/frontend/src/components/modules/index.ts; every id listed here must
 * have a component there. Ids are stable and stored in saved layouts.
 */

export type ModuleCategory =
  | 'aviation'
  | 'weather'
  | 'time'
  | 'calendar'
  | 'news'
  | 'finance'
  | 'productivity'
  | 'media'
  | 'utilities';

export type ModuleSize = 'small' | 'medium' | 'large' | 'wide' | 'tall' | 'full';

export type ModuleConfigFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  | 'airport'
  | 'location'
  | 'timezone'
  | 'date'
  | 'list';

export interface ModuleConfigField {
  key: string;
  label: string;
  type: ModuleConfigFieldType;
  default?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
  /** One-line helper shown under the control. */
  description?: string;
  /** Only show this field when another field has the given value. */
  showWhen?: { key: string; value: unknown };
  /** For 'number' fields. */
  min?: number;
  max?: number;
  step?: number;
  /** Suffix shown next to a number input, e.g. "min" or "nm". */
  unit?: string;
  /** For 'list' fields: how an entry is labelled in the chip input. */
  itemLabel?: string;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  /** Short blurb for the library card. */
  description: string;
  category: ModuleCategory;
  /** Ionicons name. */
  icon: string;
  sizes: ModuleSize[];
  defaultSize: ModuleSize;
  configFields: ModuleConfigField[];
  /**
   * Set when the widget has data the phone manages beyond settings (to-do
   * items, photos, connected calendar accounts). The editor's config sheet
   * shows a manager or link for it.
   */
  manages?: 'todos' | 'photos' | 'calendars';
}

export interface ModuleInstance {
  instanceId: string;
  moduleId: string;
  position: {
    x: number; // 0-11 (12 column grid)
    y: number; // 0-7 (8 row grid)
  };
  size: ModuleSize;
  config: Record<string, unknown>;
}

export interface MirrorLayout {
  id: string;
  name: string;
  modules: ModuleInstance[];
  createdAt: string;
  updatedAt: string;
}

export const GRID_COLS = 12;
export const GRID_ROWS = 8;

// Size presets in grid units (12 columns x 8 rows)
export const SIZE_DIMENSIONS: Record<ModuleSize, { cols: number; rows: number }> = {
  small: { cols: 3, rows: 2 },
  medium: { cols: 4, rows: 3 },
  large: { cols: 6, rows: 4 },
  wide: { cols: 6, rows: 2 },
  tall: { cols: 3, rows: 4 },
  full: { cols: 12, rows: 4 },
};

export const SIZE_LABELS: Record<ModuleSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  wide: 'Wide',
  tall: 'Tall',
  full: 'Full width',
};

export const CATEGORIES: Record<ModuleCategory, { label: string; icon: string; color: string }> = {
  aviation: { label: 'Aviation', icon: 'airplane', color: '#00ff88' },
  weather: { label: 'Weather', icon: 'partly-sunny', color: '#ffaa00' },
  time: { label: 'Time', icon: 'time', color: '#3388ff' },
  calendar: { label: 'Calendar', icon: 'calendar', color: '#ff6b6b' },
  news: { label: 'News', icon: 'newspaper', color: '#b388ff' },
  finance: { label: 'Finance', icon: 'trending-up', color: '#2ecc71' },
  productivity: { label: 'Productivity', icon: 'checkbox', color: '#4fc3f7' },
  media: { label: 'Media', icon: 'images', color: '#f06292' },
  utilities: { label: 'Utilities', icon: 'construct', color: '#9e9e9e' },
};

export const CATEGORY_ORDER: ModuleCategory[] = [
  'aviation',
  'weather',
  'time',
  'calendar',
  'news',
  'finance',
  'productivity',
  'media',
  'utilities',
];

const AIRPORT_FIELD: ModuleConfigField = {
  key: 'icao',
  label: 'Airport',
  type: 'airport',
  placeholder: 'Mirror default',
  description: 'Leave empty to use the mirror’s home airport.',
};

const LOCATION_FIELD: ModuleConfigField = {
  key: 'location',
  label: 'Location',
  type: 'location',
  description: 'Leave empty to use the mirror’s location.',
};

const UNITS_FIELD: ModuleConfigField = {
  key: 'units',
  label: 'Units',
  type: 'select',
  default: 'imperial',
  options: [
    { label: '°F, mph', value: 'imperial' },
    { label: '°C, km/h', value: 'metric' },
  ],
};

export const MODULES: ModuleDefinition[] = [
  // ---------------------------------------------------------------- Aviation
  {
    id: 'metar',
    name: 'METAR',
    description: 'Current conditions with flight rules, wind, visibility and ceiling',
    category: 'aviation',
    icon: 'cloud',
    sizes: ['small', 'medium', 'wide', 'large'],
    defaultSize: 'medium',
    configFields: [
      AIRPORT_FIELD,
      { key: 'showRaw', label: 'Show raw METAR', type: 'boolean', default: true },
    ],
  },
  {
    id: 'taf',
    name: 'TAF',
    description: 'Terminal forecast as a timeline of flight-rule periods',
    category: 'aviation',
    icon: 'time-outline',
    sizes: ['medium', 'wide', 'large', 'full'],
    defaultSize: 'wide',
    configFields: [
      AIRPORT_FIELD,
      {
        key: 'hoursAhead',
        label: 'Hours to show',
        type: 'number',
        default: 24,
        min: 6,
        max: 30,
        step: 6,
        unit: 'h',
      },
      { key: 'showRaw', label: 'Show raw TAF', type: 'boolean', default: false },
    ],
  },
  {
    id: 'flight-rules',
    name: 'Flight Rules',
    description: 'Big VFR / MVFR / IFR / LIFR indicator',
    category: 'aviation',
    icon: 'flag',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      AIRPORT_FIELD,
      { key: 'showDetails', label: 'Show ceiling and visibility', type: 'boolean', default: true },
    ],
  },
  {
    id: 'notams',
    name: 'NOTAMs',
    description: 'Active notices for an airport, grouped by category',
    category: 'aviation',
    icon: 'warning',
    sizes: ['medium', 'tall', 'large', 'full'],
    defaultSize: 'tall',
    configFields: [
      AIRPORT_FIELD,
      { key: 'maxItems', label: 'Max notices', type: 'number', default: 6, min: 1, max: 20 },
      {
        key: 'categories',
        label: 'Categories',
        type: 'select',
        default: 'all',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Runways and taxiways', value: 'runway,taxiway' },
          { label: 'Airspace and obstacles', value: 'airspace,obstacle' },
          { label: 'Navaids and approaches', value: 'navaid,approach' },
        ],
      },
    ],
  },
  {
    id: 'tfr',
    name: 'TFRs',
    description: 'Temporary flight restrictions near the mirror’s location',
    category: 'aviation',
    icon: 'alert-circle',
    sizes: ['small', 'medium', 'tall', 'wide'],
    defaultSize: 'medium',
    configFields: [
      { key: 'radiusNm', label: 'Radius', type: 'number', default: 100, min: 25, max: 500, step: 25, unit: 'nm' },
      { key: 'maxItems', label: 'Max items', type: 'number', default: 5, min: 1, max: 15 },
    ],
  },
  {
    id: 'winds-aloft',
    name: 'Winds Aloft',
    description: 'Forecast winds and temperatures by altitude',
    category: 'aviation',
    icon: 'analytics',
    sizes: ['small', 'medium', 'tall', 'wide'],
    defaultSize: 'medium',
    configFields: [
      LOCATION_FIELD,
      {
        key: 'maxAltitude',
        label: 'Highest altitude',
        type: 'select',
        default: '12000',
        options: [
          { label: '9,000 ft', value: '9000' },
          { label: '12,000 ft', value: '12000' },
          { label: '18,000 ft', value: '18000' },
          { label: '30,000 ft', value: '30000' },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------- Weather
  {
    id: 'current-weather',
    name: 'Current Weather',
    description: 'Temperature, conditions, wind and humidity',
    category: 'weather',
    icon: 'partly-sunny',
    sizes: ['small', 'medium', 'wide'],
    defaultSize: 'small',
    configFields: [LOCATION_FIELD, UNITS_FIELD],
  },
  {
    id: 'weather-forecast',
    name: 'Forecast',
    description: 'Daily highs, lows and conditions for the week ahead',
    category: 'weather',
    icon: 'calendar-outline',
    sizes: ['wide', 'large', 'full'],
    defaultSize: 'wide',
    configFields: [
      LOCATION_FIELD,
      UNITS_FIELD,
      { key: 'days', label: 'Days', type: 'number', default: 5, min: 3, max: 7 },
    ],
  },
  {
    id: 'radar-map',
    name: 'Radar',
    description: 'Animated precipitation radar centred on a location',
    category: 'weather',
    icon: 'radio',
    sizes: ['medium', 'large', 'tall', 'full'],
    defaultSize: 'large',
    configFields: [
      LOCATION_FIELD,
      {
        key: 'zoom',
        label: 'Zoom',
        type: 'select',
        default: '6',
        options: [
          { label: 'Region', value: '5' },
          { label: 'Local', value: '6' },
          { label: 'City', value: '7' },
        ],
      },
      { key: 'animated', label: 'Animate', type: 'boolean', default: true },
    ],
  },
  {
    id: 'sun-times',
    name: 'Sun & Moon',
    description: 'Sunrise, sunset, civil twilight and moon phase',
    category: 'weather',
    icon: 'sunny',
    sizes: ['small', 'medium', 'wide'],
    defaultSize: 'small',
    configFields: [
      { key: 'showTwilight', label: 'Show civil twilight', type: 'boolean', default: true },
      { key: 'showMoon', label: 'Show moon phase', type: 'boolean', default: true },
      { key: 'showZulu', label: 'Show Zulu times', type: 'boolean', default: false },
    ],
  },

  // -------------------------------------------------------------------- Time
  {
    id: 'digital-clock',
    name: 'Clock',
    description: 'Large time display with date and optional Zulu time',
    category: 'time',
    icon: 'time',
    sizes: ['small', 'medium', 'wide', 'large'],
    defaultSize: 'medium',
    configFields: [
      { key: 'timezone', label: 'Time zone', type: 'timezone', placeholder: 'Mirror default' },
      { key: 'format24h', label: '24-hour', type: 'boolean', default: false },
      { key: 'showSeconds', label: 'Show seconds', type: 'boolean', default: false },
      { key: 'showDate', label: 'Show date', type: 'boolean', default: true },
      { key: 'showZulu', label: 'Show Zulu time', type: 'boolean', default: true },
    ],
  },
  {
    id: 'analog-clock',
    name: 'Analog Clock',
    description: 'Clock face with hour, minute and second hands',
    category: 'time',
    icon: 'timer',
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'medium',
    configFields: [
      { key: 'timezone', label: 'Time zone', type: 'timezone', placeholder: 'Mirror default' },
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 'minimal',
        options: [
          { label: 'Minimal', value: 'minimal' },
          { label: 'Classic', value: 'classic' },
        ],
      },
      { key: 'showSeconds', label: 'Second hand', type: 'boolean', default: true },
    ],
  },
  {
    id: 'world-clocks',
    name: 'World Clocks',
    description: 'Time in several cities side by side',
    category: 'time',
    icon: 'globe',
    sizes: ['small', 'wide', 'tall', 'large'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'timezones',
        label: 'Time zones',
        type: 'list',
        itemLabel: 'time zone',
        default: ['America/New_York', 'Europe/London', 'Asia/Tokyo'],
        description: 'IANA names such as Europe/Paris.',
      },
      { key: 'format24h', label: '24-hour', type: 'boolean', default: true },
    ],
  },

  // ---------------------------------------------------------------- Calendar
  {
    id: 'calendar',
    name: 'Schedule',
    description: 'Events from Google, Outlook, iCloud or a calendar link, plus imported crew schedules',
    category: 'calendar',
    icon: 'calendar',
    sizes: ['medium', 'tall', 'large', 'wide'],
    defaultSize: 'tall',
    manages: 'calendars',
    configFields: [
      {
        key: 'mode',
        label: 'Show',
        type: 'select',
        default: 'all',
        options: [
          { label: 'All events', value: 'all' },
          { label: 'Flights only', value: 'flights' },
        ],
      },
      { key: 'daysAhead', label: 'Days ahead', type: 'number', default: 7, min: 1, max: 30, unit: 'days' },
      { key: 'maxEvents', label: 'Max events', type: 'number', default: 8, min: 1, max: 20 },
      { key: 'showLocation', label: 'Show locations', type: 'boolean', default: true },
    ],
  },
  {
    id: 'countdown',
    name: 'Countdown',
    description: 'Days, hours and minutes until a date',
    category: 'calendar',
    icon: 'hourglass',
    sizes: ['small', 'medium', 'wide'],
    defaultSize: 'small',
    configFields: [
      { key: 'label', label: 'Label', type: 'text', placeholder: 'Checkride', required: true },
      { key: 'targetDate', label: 'Date', type: 'date', required: true },
    ],
  },

  // -------------------------------------------------------------------- News
  {
    id: 'news',
    name: 'News',
    description: 'Headlines from a preset source or any RSS feed',
    category: 'news',
    icon: 'newspaper',
    sizes: ['medium', 'tall', 'wide', 'large', 'full'],
    defaultSize: 'tall',
    configFields: [
      {
        key: 'source',
        label: 'Source',
        type: 'select',
        default: 'world',
        options: [
          { label: 'World', value: 'world' },
          { label: 'US', value: 'us' },
          { label: 'Business', value: 'business' },
          { label: 'Technology', value: 'technology' },
          { label: 'Sports', value: 'sports' },
          { label: 'Aviation', value: 'aviation' },
          { label: 'Custom RSS feed', value: 'custom' },
        ],
      },
      {
        key: 'feedUrl',
        label: 'Feed URL',
        type: 'text',
        placeholder: 'https://example.com/feed.xml',
        required: true,
        showWhen: { key: 'source', value: 'custom' },
      },
      { key: 'maxItems', label: 'Headlines', type: 'number', default: 6, min: 1, max: 15 },
      { key: 'showSource', label: 'Show source and time', type: 'boolean', default: true },
    ],
  },

  // ----------------------------------------------------------------- Finance
  {
    id: 'stocks',
    name: 'Stocks',
    description: 'Prices, daily change and a 30-day trend for your symbols',
    category: 'finance',
    icon: 'trending-up',
    sizes: ['small', 'medium', 'wide', 'tall', 'large'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'symbols',
        label: 'Symbols',
        type: 'list',
        itemLabel: 'symbol',
        default: ['AAPL', 'MSFT', 'SPY'],
        description: 'US tickers and ETFs, e.g. AAPL or VOO.',
      },
      { key: 'showSparkline', label: 'Show 30-day trend', type: 'boolean', default: true },
    ],
  },
  {
    id: 'crypto',
    name: 'Crypto',
    description: 'Coin prices with 24-hour change',
    category: 'finance',
    icon: 'logo-bitcoin',
    sizes: ['small', 'medium', 'wide', 'tall'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'coins',
        label: 'Coins',
        type: 'list',
        itemLabel: 'coin',
        default: ['BTC', 'ETH'],
        description: 'Symbols such as BTC, ETH, SOL.',
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'select',
        default: 'USD',
        options: [
          { label: 'USD', value: 'USD' },
          { label: 'EUR', value: 'EUR' },
          { label: 'GBP', value: 'GBP' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Productivity
  {
    id: 'todo-list',
    name: 'To-do',
    description: 'A short list you manage from the app',
    category: 'productivity',
    icon: 'checkbox',
    sizes: ['small', 'medium', 'tall', 'large'],
    defaultSize: 'tall',
    manages: 'todos',
    configFields: [
      { key: 'title', label: 'Title', type: 'text', default: 'To-do', placeholder: 'To-do' },
      { key: 'showCompleted', label: 'Show completed items', type: 'boolean', default: false },
      { key: 'maxItems', label: 'Max items', type: 'number', default: 8, min: 1, max: 20 },
    ],
  },
  {
    id: 'quotes',
    name: 'Quote of the Day',
    description: 'A new quote each day',
    category: 'productivity',
    icon: 'chatbox-ellipses',
    sizes: ['wide', 'medium', 'full'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'category',
        label: 'Theme',
        type: 'select',
        default: 'aviation',
        options: [
          { label: 'Aviation', value: 'aviation' },
          { label: 'Motivation', value: 'motivational' },
          { label: 'Wisdom', value: 'wisdom' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------- Media
  {
    id: 'photo-frame',
    name: 'Photos',
    description: 'A slideshow of photos uploaded from your phone',
    category: 'media',
    icon: 'images',
    sizes: ['medium', 'large', 'tall', 'full'],
    defaultSize: 'large',
    manages: 'photos',
    configFields: [
      { key: 'interval', label: 'Change every', type: 'number', default: 30, min: 5, max: 600, unit: 's' },
      {
        key: 'fit',
        label: 'Fit',
        type: 'select',
        default: 'cover',
        options: [
          { label: 'Fill', value: 'cover' },
          { label: 'Fit', value: 'contain' },
        ],
      },
    ],
  },

  // --------------------------------------------------------------- Utilities
  {
    id: 'qr-code',
    name: 'QR Code',
    description: 'Share a link or Wi-Fi details with a scannable code',
    category: 'utilities',
    icon: 'qr-code',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      { key: 'content', label: 'Content', type: 'text', required: true, placeholder: 'https://...' },
      { key: 'label', label: 'Caption', type: 'text', placeholder: 'Guest Wi-Fi' },
    ],
  },
  {
    id: 'text-label',
    name: 'Text',
    description: 'A line of your own text',
    category: 'utilities',
    icon: 'text',
    sizes: ['small', 'wide', 'full'],
    defaultSize: 'wide',
    configFields: [
      { key: 'text', label: 'Text', type: 'text', required: true, placeholder: 'Fly safe' },
      {
        key: 'fontSize',
        label: 'Size',
        type: 'select',
        default: 'medium',
        options: [
          { label: 'Small', value: 'small' },
          { label: 'Medium', value: 'medium' },
          { label: 'Large', value: 'large' },
        ],
      },
      {
        key: 'align',
        label: 'Align',
        type: 'select',
        default: 'left',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Center', value: 'center' },
          { label: 'Right', value: 'right' },
        ],
      },
    ],
  },
  {
    id: 'spacer',
    name: 'Spacer',
    description: 'Empty space to shape the layout',
    category: 'utilities',
    icon: 'resize',
    sizes: ['small', 'medium', 'wide', 'tall'],
    defaultSize: 'small',
    configFields: [],
  },
];

export function getModuleById(id: string): ModuleDefinition | undefined {
  return MODULES.find((m) => m.id === id);
}

/** Config populated with every field's default. */
export function defaultConfigFor(definition: ModuleDefinition): Record<string, unknown> {
  return definition.configFields.reduce((acc, field) => {
    if (field.default !== undefined) acc[field.key] = field.default;
    return acc;
  }, {} as Record<string, unknown>);
}

/**
 * Whether a field should be shown given the current config. Pass the
 * definition so an unset controlling field falls back to its default.
 */
export function isFieldVisible(
  field: ModuleConfigField,
  config: Record<string, unknown>,
  definition?: ModuleDefinition
): boolean {
  if (!field.showWhen) return true;
  const { key, value } = field.showWhen;
  let current = config[key];
  if (current === undefined && definition) {
    current = definition.configFields.find((f) => f.key === key)?.default;
  }
  return current === value;
}

/** Required fields that are still empty, for the editor's attention badge. */
export function missingRequiredFields(
  definition: ModuleDefinition,
  config: Record<string, unknown>
): ModuleConfigField[] {
  return definition.configFields.filter((field) => {
    if (!field.required || !isFieldVisible(field, config, definition)) return false;
    const value = config[field.key];
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  });
}

export function generateInstanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
