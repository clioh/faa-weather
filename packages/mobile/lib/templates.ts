/**
 * Layout Templates
 * Pre-built layout configurations for quick setup
 */

import { ModuleInstance, ModuleSize } from './modules';

export type TemplateCategory = 'aviation' | 'weather' | 'lifestyle' | 'minimal';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // Ionicons name
  category: TemplateCategory;
  modules: Omit<ModuleInstance, 'instanceId'>[];
}

// Aviation modules that accept ICAO airport codes
const AVIATION_MODULES = ['metar', 'taf', 'flight-rules', 'notams', 'winds-aloft', 'sectional-map'];

// Modules that accept location config
const LOCATION_MODULES = ['current-weather', 'weather-forecast', 'radar-map', 'sun-times', 'winds-aloft'];

export function isAviationModule(moduleId: string): boolean {
  return AVIATION_MODULES.includes(moduleId);
}

export function isLocationModule(moduleId: string): boolean {
  return LOCATION_MODULES.includes(moduleId);
}

export const TEMPLATE_CATEGORIES: Record<TemplateCategory, { label: string; icon: string; color: string }> = {
  aviation: { label: 'Aviation', icon: 'airplane', color: '#00ff88' },
  weather: { label: 'Weather', icon: 'partly-sunny', color: '#ffaa00' },
  lifestyle: { label: 'Lifestyle', icon: 'home', color: '#0088ff' },
  minimal: { label: 'Minimal', icon: 'remove', color: '#95a5a6' },
};

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  // ============================================================
  // AVIATION TEMPLATES
  // ============================================================
  {
    id: 'pilot-briefing',
    name: 'Pilot Briefing',
    description: 'Comprehensive aviation weather and NOTAMs for flight planning',
    icon: 'airplane',
    category: 'aviation',
    modules: [
      // Row 0: Clock (wide) + METAR (medium) + Flight Rules (small)
      {
        moduleId: 'digital-clock',
        position: { x: 0, y: 0 },
        size: 'wide' as ModuleSize,
        config: { format24h: true, showDate: true, showSeconds: false },
      },
      {
        moduleId: 'metar',
        position: { x: 6, y: 0 },
        size: 'medium' as ModuleSize,
        config: { showDecoded: true, showRaw: false },
      },
      {
        moduleId: 'flight-rules',
        position: { x: 10, y: 0 },
        size: 'small' as ModuleSize,
        config: { showCeiling: true, showVisibility: true },
      },
      // Row 2: Sun Times (small) + TAF (wide) + NOTAMs (tall, spans rows 2-5)
      {
        moduleId: 'sun-times',
        position: { x: 0, y: 2 },
        size: 'small' as ModuleSize,
        config: { showTwilight: true },
      },
      {
        moduleId: 'taf',
        position: { x: 3, y: 2 },
        size: 'wide' as ModuleSize,
        config: { hoursAhead: 24 },
      },
      {
        moduleId: 'notams',
        position: { x: 9, y: 2 },
        size: 'tall' as ModuleSize,
        config: { maxItems: 5 },
      },
    ],
  },

  // ============================================================
  // WEATHER TEMPLATES
  // ============================================================
  {
    id: 'weather-dashboard',
    name: 'Weather Dashboard',
    description: 'Complete weather overview with forecast and radar',
    icon: 'partly-sunny',
    category: 'weather',
    modules: [
      // Row 0: Clock (medium) + Current Weather (medium) + Sun Times (small)
      {
        moduleId: 'digital-clock',
        position: { x: 0, y: 0 },
        size: 'medium' as ModuleSize,
        config: { format24h: false, showDate: true, showSeconds: true },
      },
      {
        moduleId: 'current-weather',
        position: { x: 4, y: 0 },
        size: 'medium' as ModuleSize,
        config: { units: 'imperial' },
      },
      {
        moduleId: 'sun-times',
        position: { x: 8, y: 0 },
        size: 'small' as ModuleSize,
        config: { showTwilight: true },
      },
      // Row 3: Weather Forecast (wide) + Radar (medium)
      {
        moduleId: 'weather-forecast',
        position: { x: 0, y: 3 },
        size: 'wide' as ModuleSize,
        config: { days: 5 },
      },
      {
        moduleId: 'radar-map',
        position: { x: 6, y: 3 },
        size: 'medium' as ModuleSize,
        config: { animated: true },
      },
    ],
  },

  // ============================================================
  // MINIMAL TEMPLATES
  // ============================================================
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean display with just time and weather',
    icon: 'remove',
    category: 'minimal',
    modules: [
      // Row 0: Large clock centered
      {
        moduleId: 'digital-clock',
        position: { x: 3, y: 0 },
        size: 'wide' as ModuleSize,
        config: { format24h: false, showDate: true, showSeconds: false },
      },
      // Row 2: Weather small
      {
        moduleId: 'current-weather',
        position: { x: 0, y: 2 },
        size: 'small' as ModuleSize,
        config: { units: 'imperial' },
      },
    ],
  },

  // ============================================================
  // LIFESTYLE TEMPLATES
  // ============================================================
  {
    id: 'morning-routine',
    name: 'Morning Routine',
    description: 'Daily overview with calendar and news',
    icon: 'sunny',
    category: 'lifestyle',
    modules: [
      // Row 0: Clock (medium) + Weather (small) + Sun Times (small)
      {
        moduleId: 'digital-clock',
        position: { x: 0, y: 0 },
        size: 'medium' as ModuleSize,
        config: { format24h: false, showDate: true, showSeconds: false },
      },
      {
        moduleId: 'current-weather',
        position: { x: 4, y: 0 },
        size: 'small' as ModuleSize,
        config: { units: 'imperial' },
      },
      {
        moduleId: 'sun-times',
        position: { x: 7, y: 0 },
        size: 'small' as ModuleSize,
        config: { showTwilight: false },
      },
      // Row 3: Calendar (tall) + News Headlines (tall)
      {
        moduleId: 'calendar',
        position: { x: 0, y: 3 },
        size: 'tall' as ModuleSize,
        config: { maxEvents: 8, daysAhead: 7 },
      },
      {
        moduleId: 'news-headlines',
        position: { x: 3, y: 3 },
        size: 'tall' as ModuleSize,
        config: { source: 'top', maxItems: 5 },
      },
    ],
  },
  {
    id: 'information-dense',
    name: 'Information Dense',
    description: 'Maximum information at a glance',
    icon: 'grid',
    category: 'lifestyle',
    modules: [
      // Row 0: Small widgets across the top
      {
        moduleId: 'digital-clock',
        position: { x: 0, y: 0 },
        size: 'small' as ModuleSize,
        config: { format24h: false, showDate: true, showSeconds: false },
      },
      {
        moduleId: 'current-weather',
        position: { x: 3, y: 0 },
        size: 'small' as ModuleSize,
        config: { units: 'imperial' },
      },
      {
        moduleId: 'flight-rules',
        position: { x: 6, y: 0 },
        size: 'small' as ModuleSize,
        config: { showCeiling: true, showVisibility: true },
      },
      {
        moduleId: 'sun-times',
        position: { x: 9, y: 0 },
        size: 'small' as ModuleSize,
        config: { showTwilight: false },
      },
      // Row 2: Medium METAR + Small countdown + Wide quotes
      {
        moduleId: 'metar',
        position: { x: 0, y: 2 },
        size: 'medium' as ModuleSize,
        config: { showDecoded: true },
      },
      {
        moduleId: 'countdown',
        position: { x: 4, y: 2 },
        size: 'small' as ModuleSize,
        config: { targetDate: '', label: 'Next Flight' },
      },
      {
        moduleId: 'stocks',
        position: { x: 7, y: 2 },
        size: 'small' as ModuleSize,
        config: { symbols: 'AAPL,GOOGL,MSFT' },
      },
      // Row 5: Quotes wide
      {
        moduleId: 'quotes',
        position: { x: 0, y: 5 },
        size: 'wide' as ModuleSize,
        config: { category: 'aviation' },
      },
    ],
  },
];

export function getTemplateById(id: string): LayoutTemplate | undefined {
  return LAYOUT_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: TemplateCategory): LayoutTemplate[] {
  return LAYOUT_TEMPLATES.filter((t) => t.category === category);
}
