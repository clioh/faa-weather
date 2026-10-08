/**
 * Module Registry
 *
 * Maps module IDs from the layout API to React components.
 * This enables dynamic module rendering based on the layout configuration.
 */

import { ComponentType } from 'react';

// Import existing widgets as modules
import { ClockWidget } from '../widgets/ClockWidget';
import { AviationWidget } from '../widgets/AviationWidget';
import { ScheduleWidget } from '../widgets/ScheduleWidget';
import { TfrWidget } from '../widgets/TfrWidget';
import { NotamWidget } from '../widgets/NotamWidget';
import { AstroWidget } from '../widgets/AstroWidget';
import { RadarWidget } from '../widgets/RadarWidget';

// Import new module components
import { MetarModule } from './MetarModule';
import { TafModule } from './TafModule';
import { FlightRulesModule } from './FlightRulesModule';
import { CurrentWeatherModule } from './CurrentWeatherModule';
import { WeatherForecastModule } from './WeatherForecastModule';
import { DigitalClockModule } from './DigitalClockModule';
import { AnalogClockModule } from './AnalogClockModule';
import { WorldClocksModule } from './WorldClocksModule';
import { CalendarModule } from './CalendarModule';
import { CountdownModule } from './CountdownModule';
import { NewsModule } from './NewsModule';
import { StocksModule } from './StocksModule';
import { CryptoModule } from './CryptoModule';
import { QuotesModule } from './QuotesModule';
import { TextLabelModule } from './TextLabelModule';

// Module size dimensions (matching mobile app)
export type ModuleSize = 'small' | 'medium' | 'large' | 'wide' | 'tall' | 'full';

export const SIZE_DIMENSIONS: Record<ModuleSize, { cols: number; rows: number }> = {
  small: { cols: 3, rows: 2 },
  medium: { cols: 4, rows: 3 },
  large: { cols: 6, rows: 4 },
  wide: { cols: 6, rows: 2 },
  tall: { cols: 3, rows: 4 },
  full: { cols: 12, rows: 4 },
};

// Module instance from layout API
export interface ModuleInstance {
  instanceId: string;
  moduleId: string;
  position: {
    x: number;
    y: number;
  };
  size: ModuleSize;
  config: Record<string, unknown>;
}

// Layout from API
export interface MirrorLayout {
  id: string;
  name: string;
  modules: ModuleInstance[];
  createdAt: string;
  updatedAt: string;
}

// Props passed to every module component
export interface ModuleProps {
  instanceId: string;
  moduleId: string;
  size: ModuleSize;
  config: Record<string, unknown>;
  // Global config passed to all modules
  airport?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

// Registry mapping module IDs to components
// Note: Legacy widgets use 'as unknown as' to bypass type checking since they have different prop types
export const moduleRegistry: Record<string, ComponentType<ModuleProps>> = {
  // Aviation modules
  'metar': MetarModule,
  'taf': TafModule,
  'flight-rules': FlightRulesModule,
  'notams': NotamWidget as unknown as ComponentType<ModuleProps>,
  'winds-aloft': MetarModule, // TODO: Create dedicated component
  'sectional-map': MetarModule, // TODO: Create dedicated component

  // Weather modules
  'current-weather': CurrentWeatherModule,
  'weather-forecast': WeatherForecastModule,
  'radar-map': RadarWidget as unknown as ComponentType<ModuleProps>,
  'sun-times': AstroWidget as unknown as ComponentType<ModuleProps>,

  // Time modules
  'digital-clock': DigitalClockModule,
  'analog-clock': AnalogClockModule,
  'world-clocks': WorldClocksModule,

  // Calendar modules
  'calendar': CalendarModule,
  'countdown': CountdownModule,

  // News modules
  'news-headlines': NewsModule,
  'rss-feed': NewsModule, // Reuse news component

  // Finance modules
  'stocks': StocksModule,
  'crypto': CryptoModule,

  // Productivity modules
  'todo-list': ScheduleWidget as unknown as ComponentType<ModuleProps>,
  'quotes': QuotesModule,

  // Media modules
  'photo-frame': TextLabelModule, // TODO: Create photo frame component
  'spotify': TextLabelModule, // TODO: Create spotify component

  // Smart home modules
  'hue-lights': TextLabelModule, // TODO: Create hue component
  'thermostat': TextLabelModule, // TODO: Create thermostat component

  // Health modules
  'fitness-ring': TextLabelModule, // TODO: Create fitness component

  // Social modules (placeholders)

  // Utilities
  'qr-code': TextLabelModule, // TODO: Create QR component
  'text-label': TextLabelModule,
  'spacer': TextLabelModule, // Empty spacer

  // Legacy widget mappings (for backward compatibility)
  'clock': ClockWidget as unknown as ComponentType<ModuleProps>,
  'aviation': AviationWidget as unknown as ComponentType<ModuleProps>,
  'schedule': ScheduleWidget as unknown as ComponentType<ModuleProps>,
  'tfr': TfrWidget as unknown as ComponentType<ModuleProps>,
  'notam': NotamWidget as unknown as ComponentType<ModuleProps>,
  'astro': AstroWidget as unknown as ComponentType<ModuleProps>,
  'radar': RadarWidget as unknown as ComponentType<ModuleProps>,
};

// Get component for a module ID
export function getModuleComponent(moduleId: string): ComponentType<ModuleProps> | null {
  return moduleRegistry[moduleId] || null;
}

// Check if a module ID is valid
export function isValidModule(moduleId: string): boolean {
  return moduleId in moduleRegistry;
}
