/**
 * Module/Widget System
 * Defines available modules, their configurations, and layout system
 */

export type ModuleCategory =
  | 'aviation'
  | 'weather'
  | 'time'
  | 'calendar'
  | 'news'
  | 'smart-home'
  | 'health'
  | 'finance'
  | 'media'
  | 'productivity'
  | 'social'
  | 'utilities';

export type ModuleSize = 'small' | 'medium' | 'large' | 'wide' | 'tall' | 'full';

export interface ModuleConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'color' | 'airport' | 'location';
  default?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
  description?: string;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  icon: string; // Ionicons name
  sizes: ModuleSize[];
  defaultSize: ModuleSize;
  configFields: ModuleConfigField[];
  premium?: boolean;
}

export interface ModuleInstance {
  instanceId: string;
  moduleId: string;
  position: {
    x: number; // 0-11 (12 column grid)
    y: number; // row position
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

// Size dimensions in grid units (12 column grid)
export const SIZE_DIMENSIONS: Record<ModuleSize, { cols: number; rows: number }> = {
  small: { cols: 3, rows: 2 },
  medium: { cols: 4, rows: 3 },
  large: { cols: 6, rows: 4 },
  wide: { cols: 6, rows: 2 },
  tall: { cols: 3, rows: 4 },
  full: { cols: 12, rows: 4 },
};

// Category metadata
export const CATEGORIES: Record<ModuleCategory, { label: string; icon: string; color: string }> = {
  aviation: { label: 'Aviation', icon: 'airplane', color: '#00ff88' },
  weather: { label: 'Weather', icon: 'partly-sunny', color: '#ffaa00' },
  time: { label: 'Time & Date', icon: 'time', color: '#0088ff' },
  calendar: { label: 'Calendar', icon: 'calendar', color: '#ff6b6b' },
  news: { label: 'News', icon: 'newspaper', color: '#9b59b6' },
  'smart-home': { label: 'Smart Home', icon: 'home', color: '#1abc9c' },
  health: { label: 'Health', icon: 'fitness', color: '#e74c3c' },
  finance: { label: 'Finance', icon: 'trending-up', color: '#2ecc71' },
  media: { label: 'Media', icon: 'images', color: '#e91e63' },
  productivity: { label: 'Productivity', icon: 'checkbox', color: '#3498db' },
  social: { label: 'Social', icon: 'people', color: '#00bcd4' },
  utilities: { label: 'Utilities', icon: 'build', color: '#95a5a6' },
};

// Module definitions
export const MODULES: ModuleDefinition[] = [
  // Aviation modules
  {
    id: 'metar',
    name: 'METAR Display',
    description: 'Current weather conditions at an airport',
    category: 'aviation',
    icon: 'cloud',
    sizes: ['small', 'medium', 'wide'],
    defaultSize: 'medium',
    configFields: [
      {
        key: 'icao',
        label: 'Airport ICAO',
        type: 'airport',
        required: true,
        placeholder: 'KJFK',
      },
      {
        key: 'showRaw',
        label: 'Show Raw METAR',
        type: 'boolean',
        default: false,
      },
      {
        key: 'showDecoded',
        label: 'Show Decoded Data',
        type: 'boolean',
        default: true,
      },
    ],
  },
  {
    id: 'taf',
    name: 'TAF Forecast',
    description: 'Terminal aerodrome forecast',
    category: 'aviation',
    icon: 'calendar-outline',
    sizes: ['medium', 'large', 'wide'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'icao',
        label: 'Airport ICAO',
        type: 'airport',
        required: true,
      },
      {
        key: 'hoursAhead',
        label: 'Hours to Show',
        type: 'number',
        default: 24,
      },
    ],
  },
  {
    id: 'flight-rules',
    name: 'Flight Rules',
    description: 'VFR/MVFR/IFR/LIFR indicator',
    category: 'aviation',
    icon: 'flag',
    sizes: ['small'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'icao',
        label: 'Airport ICAO',
        type: 'airport',
        required: true,
      },
      {
        key: 'showCeiling',
        label: 'Show Ceiling',
        type: 'boolean',
        default: true,
      },
      {
        key: 'showVisibility',
        label: 'Show Visibility',
        type: 'boolean',
        default: true,
      },
    ],
  },
  {
    id: 'winds-aloft',
    name: 'Winds Aloft',
    description: 'Wind forecasts at altitude',
    category: 'aviation',
    icon: 'analytics',
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    configFields: [
      {
        key: 'location',
        label: 'Location',
        type: 'location',
        required: true,
      },
      {
        key: 'altitudes',
        label: 'Altitudes',
        type: 'text',
        default: '3000,6000,9000,12000',
        description: 'Comma-separated altitudes in feet',
      },
    ],
  },
  {
    id: 'notams',
    name: 'NOTAMs',
    description: 'Notices to Air Missions',
    category: 'aviation',
    icon: 'warning',
    sizes: ['medium', 'large', 'tall'],
    defaultSize: 'tall',
    configFields: [
      {
        key: 'icao',
        label: 'Airport ICAO',
        type: 'airport',
        required: true,
      },
      {
        key: 'maxItems',
        label: 'Max Items',
        type: 'number',
        default: 5,
      },
    ],
  },
  {
    id: 'sectional-map',
    name: 'Sectional Map',
    description: 'Aviation sectional chart view',
    category: 'aviation',
    icon: 'map',
    sizes: ['large', 'full'],
    defaultSize: 'large',
    configFields: [
      {
        key: 'center',
        label: 'Center Location',
        type: 'location',
        required: true,
      },
      {
        key: 'zoom',
        label: 'Zoom Level',
        type: 'number',
        default: 10,
      },
    ],
    premium: true,
  },

  // Weather modules
  {
    id: 'current-weather',
    name: 'Current Weather',
    description: 'Current conditions with temperature',
    category: 'weather',
    icon: 'partly-sunny',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'location',
        label: 'Location',
        type: 'location',
        required: true,
      },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'imperial',
        options: [
          { label: 'Imperial (°F)', value: 'imperial' },
          { label: 'Metric (°C)', value: 'metric' },
        ],
      },
    ],
  },
  {
    id: 'weather-forecast',
    name: 'Weather Forecast',
    description: '5-day weather forecast',
    category: 'weather',
    icon: 'calendar',
    sizes: ['wide', 'large'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'location',
        label: 'Location',
        type: 'location',
        required: true,
      },
      {
        key: 'days',
        label: 'Days to Show',
        type: 'number',
        default: 5,
      },
    ],
  },
  {
    id: 'radar-map',
    name: 'Weather Radar',
    description: 'Animated radar imagery',
    category: 'weather',
    icon: 'radio',
    sizes: ['medium', 'large'],
    defaultSize: 'large',
    configFields: [
      {
        key: 'location',
        label: 'Location',
        type: 'location',
        required: true,
      },
      {
        key: 'animated',
        label: 'Show Animation',
        type: 'boolean',
        default: true,
      },
    ],
  },
  {
    id: 'sun-times',
    name: 'Sunrise & Sunset',
    description: 'Sun times with twilight phases',
    category: 'weather',
    icon: 'sunny',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'location',
        label: 'Location',
        type: 'location',
        required: true,
      },
      {
        key: 'showTwilight',
        label: 'Show Twilight Times',
        type: 'boolean',
        default: true,
        description: 'Civil, nautical, and astronomical twilight',
      },
    ],
  },

  // Time modules
  {
    id: 'digital-clock',
    name: 'Digital Clock',
    description: 'Large digital time display',
    category: 'time',
    icon: 'time',
    sizes: ['small', 'medium', 'wide'],
    defaultSize: 'medium',
    configFields: [
      {
        key: 'timezone',
        label: 'Timezone',
        type: 'text',
        default: 'local',
        placeholder: 'America/New_York or "local"',
      },
      {
        key: 'format24h',
        label: '24-Hour Format',
        type: 'boolean',
        default: false,
      },
      {
        key: 'showSeconds',
        label: 'Show Seconds',
        type: 'boolean',
        default: true,
      },
      {
        key: 'showDate',
        label: 'Show Date',
        type: 'boolean',
        default: true,
      },
    ],
  },
  {
    id: 'analog-clock',
    name: 'Analog Clock',
    description: 'Classic analog clock face',
    category: 'time',
    icon: 'timer',
    sizes: ['small', 'medium'],
    defaultSize: 'medium',
    configFields: [
      {
        key: 'timezone',
        label: 'Timezone',
        type: 'text',
        default: 'local',
      },
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 'modern',
        options: [
          { label: 'Modern', value: 'modern' },
          { label: 'Classic', value: 'classic' },
          { label: 'Minimal', value: 'minimal' },
        ],
      },
    ],
  },
  {
    id: 'world-clocks',
    name: 'World Clocks',
    description: 'Multiple timezone clocks',
    category: 'time',
    icon: 'globe',
    sizes: ['wide', 'large'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'timezones',
        label: 'Timezones',
        type: 'text',
        default: 'America/New_York,Europe/London,Asia/Tokyo',
        description: 'Comma-separated timezone names',
      },
    ],
  },

  // Calendar modules
  {
    id: 'calendar',
    name: 'Calendar Events',
    description: 'Upcoming calendar events',
    category: 'calendar',
    icon: 'calendar',
    sizes: ['medium', 'tall', 'large'],
    defaultSize: 'tall',
    configFields: [
      {
        key: 'calendarUrl',
        label: 'Calendar URL (iCal)',
        type: 'text',
        placeholder: 'https://calendar.google.com/...',
      },
      {
        key: 'maxEvents',
        label: 'Max Events',
        type: 'number',
        default: 10,
      },
      {
        key: 'daysAhead',
        label: 'Days Ahead',
        type: 'number',
        default: 7,
      },
    ],
  },
  {
    id: 'countdown',
    name: 'Countdown Timer',
    description: 'Countdown to a specific date',
    category: 'calendar',
    icon: 'hourglass',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'targetDate',
        label: 'Target Date',
        type: 'text',
        placeholder: '2024-12-25',
        required: true,
      },
      {
        key: 'label',
        label: 'Event Label',
        type: 'text',
        placeholder: 'Days until...',
      },
    ],
  },

  // News modules
  {
    id: 'news-headlines',
    name: 'News Headlines',
    description: 'Top news headlines',
    category: 'news',
    icon: 'newspaper',
    sizes: ['medium', 'tall', 'large'],
    defaultSize: 'tall',
    configFields: [
      {
        key: 'source',
        label: 'News Source',
        type: 'select',
        default: 'top',
        options: [
          { label: 'Top Headlines', value: 'top' },
          { label: 'Technology', value: 'technology' },
          { label: 'Business', value: 'business' },
          { label: 'Sports', value: 'sports' },
          { label: 'Aviation', value: 'aviation' },
        ],
      },
      {
        key: 'maxItems',
        label: 'Max Headlines',
        type: 'number',
        default: 5,
      },
    ],
  },
  {
    id: 'rss-feed',
    name: 'RSS Feed',
    description: 'Custom RSS feed reader',
    category: 'news',
    icon: 'logo-rss',
    sizes: ['medium', 'tall'],
    defaultSize: 'tall',
    configFields: [
      {
        key: 'feedUrl',
        label: 'Feed URL',
        type: 'text',
        required: true,
        placeholder: 'https://...',
      },
      {
        key: 'maxItems',
        label: 'Max Items',
        type: 'number',
        default: 5,
      },
    ],
  },

  // Smart Home modules
  {
    id: 'hue-lights',
    name: 'Philips Hue',
    description: 'Control Hue lights',
    category: 'smart-home',
    icon: 'bulb',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'bridgeIp',
        label: 'Bridge IP',
        type: 'text',
        required: true,
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'text',
        required: true,
      },
    ],
    premium: true,
  },
  {
    id: 'thermostat',
    name: 'Thermostat',
    description: 'Smart thermostat display',
    category: 'smart-home',
    icon: 'thermometer',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        default: 'nest',
        options: [
          { label: 'Nest', value: 'nest' },
          { label: 'Ecobee', value: 'ecobee' },
          { label: 'Honeywell', value: 'honeywell' },
        ],
      },
    ],
    premium: true,
  },

  // Health modules
  {
    id: 'fitness-ring',
    name: 'Fitness Rings',
    description: 'Activity, exercise, and stand goals',
    category: 'health',
    icon: 'fitness',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'source',
        label: 'Data Source',
        type: 'select',
        default: 'apple',
        options: [
          { label: 'Apple Health', value: 'apple' },
          { label: 'Google Fit', value: 'google' },
          { label: 'Fitbit', value: 'fitbit' },
        ],
      },
    ],
    premium: true,
  },

  // Finance modules
  {
    id: 'stocks',
    name: 'Stock Ticker',
    description: 'Stock prices and changes',
    category: 'finance',
    icon: 'trending-up',
    sizes: ['small', 'wide'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'symbols',
        label: 'Stock Symbols',
        type: 'text',
        default: 'AAPL,GOOGL,MSFT',
        description: 'Comma-separated stock symbols',
      },
    ],
  },
  {
    id: 'crypto',
    name: 'Crypto Prices',
    description: 'Cryptocurrency prices',
    category: 'finance',
    icon: 'logo-bitcoin',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'coins',
        label: 'Cryptocurrencies',
        type: 'text',
        default: 'BTC,ETH',
        description: 'Comma-separated coin symbols',
      },
      {
        key: 'currency',
        label: 'Display Currency',
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

  // Media modules
  {
    id: 'photo-frame',
    name: 'Photo Frame',
    description: 'Rotating photo display',
    category: 'media',
    icon: 'images',
    sizes: ['medium', 'large', 'full'],
    defaultSize: 'large',
    configFields: [
      {
        key: 'source',
        label: 'Photo Source',
        type: 'select',
        default: 'local',
        options: [
          { label: 'Local Folder', value: 'local' },
          { label: 'Google Photos', value: 'google' },
          { label: 'iCloud', value: 'icloud' },
        ],
      },
      {
        key: 'interval',
        label: 'Rotation Interval (sec)',
        type: 'number',
        default: 30,
      },
    ],
  },
  {
    id: 'spotify',
    name: 'Now Playing',
    description: 'Spotify now playing display',
    category: 'media',
    icon: 'musical-notes',
    sizes: ['small', 'medium', 'wide'],
    defaultSize: 'wide',
    configFields: [],
    premium: true,
  },

  // Productivity modules
  {
    id: 'todo-list',
    name: 'To-Do List',
    description: 'Task list from various sources',
    category: 'productivity',
    icon: 'checkbox',
    sizes: ['medium', 'tall'],
    defaultSize: 'tall',
    configFields: [
      {
        key: 'source',
        label: 'Source',
        type: 'select',
        default: 'todoist',
        options: [
          { label: 'Todoist', value: 'todoist' },
          { label: 'Apple Reminders', value: 'reminders' },
          { label: 'Google Tasks', value: 'google' },
        ],
      },
      {
        key: 'maxItems',
        label: 'Max Items',
        type: 'number',
        default: 10,
      },
    ],
  },
  {
    id: 'quotes',
    name: 'Daily Quote',
    description: 'Inspirational quotes',
    category: 'productivity',
    icon: 'chatbox-ellipses',
    sizes: ['wide', 'medium'],
    defaultSize: 'wide',
    configFields: [
      {
        key: 'category',
        label: 'Quote Category',
        type: 'select',
        default: 'motivational',
        options: [
          { label: 'Motivational', value: 'motivational' },
          { label: 'Aviation', value: 'aviation' },
          { label: 'Wisdom', value: 'wisdom' },
          { label: 'Humor', value: 'humor' },
        ],
      },
    ],
  },

  // Utilities
  {
    id: 'qr-code',
    name: 'QR Code',
    description: 'Display a QR code',
    category: 'utilities',
    icon: 'qr-code',
    sizes: ['small'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'content',
        label: 'QR Content',
        type: 'text',
        required: true,
        placeholder: 'URL or text',
      },
      {
        key: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'WiFi Password',
      },
    ],
  },
  {
    id: 'text-label',
    name: 'Text Label',
    description: 'Custom text display',
    category: 'utilities',
    icon: 'text',
    sizes: ['small', 'wide'],
    defaultSize: 'small',
    configFields: [
      {
        key: 'text',
        label: 'Text',
        type: 'text',
        required: true,
      },
      {
        key: 'fontSize',
        label: 'Font Size',
        type: 'select',
        default: 'medium',
        options: [
          { label: 'Small', value: 'small' },
          { label: 'Medium', value: 'medium' },
          { label: 'Large', value: 'large' },
          { label: 'X-Large', value: 'xlarge' },
        ],
      },
    ],
  },
  {
    id: 'spacer',
    name: 'Spacer',
    description: 'Empty space for layout',
    category: 'utilities',
    icon: 'resize',
    sizes: ['small', 'medium', 'wide', 'tall'],
    defaultSize: 'small',
    configFields: [],
  },
];

// Helper functions
export function getModuleById(id: string): ModuleDefinition | undefined {
  return MODULES.find((m) => m.id === id);
}

export function getModulesByCategory(category: ModuleCategory): ModuleDefinition[] {
  return MODULES.filter((m) => m.category === category);
}

export function generateInstanceId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
