/**
 * Widget Registry
 *
 * Maps widget type strings from config to React components.
 * This enables dynamic widget rendering based on configuration.
 */

import { ComponentType } from 'react';
import { ClockWidget } from './ClockWidget';
import { AviationWidget } from './AviationWidget';
import { ScheduleWidget } from './ScheduleWidget';
import { TfrWidget } from './TfrWidget';
import { NotamWidget } from './NotamWidget';
import { AstroWidget } from './AstroWidget';
import { RadarWidget } from './RadarWidget';

// Base props that all widgets receive
export interface BaseWidgetProps {
  position?: string;
}

// Widget configuration from config.yaml
export interface WidgetConfig {
  type: string;
  position: string;
  enabled?: boolean;
  [key: string]: unknown;
}

// Registry of all available widgets
export const widgetRegistry: Record<string, ComponentType<any>> = {
  clock: ClockWidget,
  aviation: AviationWidget,
  schedule: ScheduleWidget,
  tfr: TfrWidget,
  notam: NotamWidget,
  astro: AstroWidget,
  radar: RadarWidget,
};

// Get list of available widget types
export function getAvailableWidgets(): string[] {
  return Object.keys(widgetRegistry);
}

// Check if a widget type exists
export function isValidWidgetType(type: string): boolean {
  return type in widgetRegistry;
}

// Widget metadata for the layout editor
export interface WidgetMeta {
  type: string;
  name: string;
  description: string;
  icon: string;
  defaultConfig: Record<string, unknown>;
}

export const widgetMeta: Record<string, WidgetMeta> = {
  clock: {
    type: 'clock',
    name: 'Clock',
    description: 'Local and Zulu time display',
    icon: '🕐',
    defaultConfig: {
      showZulu: true,
      showDate: true,
    },
  },
  aviation: {
    type: 'aviation',
    name: 'Aviation Weather',
    description: 'METAR and TAF with flight rules',
    icon: '✈️',
    defaultConfig: {
      showMetar: true,
      showTaf: true,
      showFlightRules: true,
    },
  },
  schedule: {
    type: 'schedule',
    name: 'Schedule',
    description: 'Calendar and flight schedule',
    icon: '📅',
    defaultConfig: {
      daysAhead: 7,
      maxItems: 5,
    },
  },
  tfr: {
    type: 'tfr',
    name: 'TFRs',
    description: 'Temporary Flight Restrictions',
    icon: '⚠️',
    defaultConfig: {
      radiusNm: 100,
    },
  },
  notam: {
    type: 'notam',
    name: 'NOTAMs',
    description: 'Notices to Air Missions',
    icon: '📋',
    defaultConfig: {
      maxItems: 5,
      categories: ['runway', 'obstacle', 'airspace'],
    },
  },
  astro: {
    type: 'astro',
    name: 'Sun/Moon',
    description: 'Sunrise, sunset, and moon phase',
    icon: '🌅',
    defaultConfig: {
      showSunrise: true,
      showSunset: true,
      showCivilTwilight: true,
      showMoon: true,
    },
  },
  radar: {
    type: 'radar',
    name: 'Weather Radar',
    description: 'Animated precipitation radar',
    icon: '🌧️',
    defaultConfig: {
      zoom: 6,
      animationSpeed: 500,
      showTimestamp: true,
    },
  },
};

// Available grid positions
export const gridPositions = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center-center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export type GridPosition = (typeof gridPositions)[number];

// Re-export individual widgets
export { ClockWidget } from './ClockWidget';
export { AviationWidget } from './AviationWidget';
export { ScheduleWidget } from './ScheduleWidget';
export { TfrWidget } from './TfrWidget';
export { NotamWidget } from './NotamWidget';
export { AstroWidget } from './AstroWidget';
export { RadarWidget } from './RadarWidget';
