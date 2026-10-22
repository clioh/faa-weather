/**
 * Module registry
 *
 * Maps widget ids from a layout to React components. The list of ids is the
 * widget catalog in packages/mobile/lib/modules.ts; keep the two in step.
 */

import { ComponentType } from 'react';

// Aviation
import { MetarModule } from './MetarModule';
import { TafModule } from './TafModule';
import { FlightRulesModule } from './FlightRulesModule';
import { NotamsModule } from './NotamsModule';
import { TfrModule } from './TfrModule';
import { WindsAloftModule } from './WindsAloftModule';

// Weather
import { CurrentWeatherModule } from './CurrentWeatherModule';
import { WeatherForecastModule } from './WeatherForecastModule';
import { RadarModule } from './RadarModule';
import { SunTimesModule } from './SunTimesModule';

// Time
import { DigitalClockModule } from './DigitalClockModule';
import { AnalogClockModule } from './AnalogClockModule';
import { WorldClocksModule } from './WorldClocksModule';

// Calendar
import { CalendarModule } from './CalendarModule';
import { CountdownModule } from './CountdownModule';

// News
import { NewsModule } from './NewsModule';

// Finance
import { StocksModule } from './StocksModule';
import { CryptoModule } from './CryptoModule';

// Productivity
import { TodoModule } from './TodoModule';
import { QuotesModule } from './QuotesModule';

// Media
import { PhotoFrameModule } from './PhotoFrameModule';

// Utilities
import { QrCodeModule } from './QrCodeModule';
import { TextLabelModule } from './TextLabelModule';
import { SpacerModule } from './SpacerModule';

export type ModuleSize = 'small' | 'medium' | 'large' | 'wide' | 'tall' | 'full';

export const SIZE_DIMENSIONS: Record<ModuleSize, { cols: number; rows: number }> = {
  small: { cols: 3, rows: 2 },
  medium: { cols: 4, rows: 3 },
  large: { cols: 6, rows: 4 },
  wide: { cols: 6, rows: 2 },
  tall: { cols: 3, rows: 4 },
  full: { cols: 12, rows: 4 },
};

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

export interface MirrorLayout {
  id: string;
  name: string;
  modules: ModuleInstance[];
  createdAt: string;
  updatedAt: string;
}

/** A point the mirror or a widget setting can refer to. */
export interface LocationValue {
  latitude: number;
  longitude: number;
  city?: string;
  timezone?: string;
}

/** Props every widget receives. */
export interface ModuleProps {
  instanceId: string;
  moduleId: string;
  size: ModuleSize;
  /** The instance's settings as saved from the phone app. */
  config: Record<string, unknown>;
  /** Mirror-wide defaults from config.yaml, used when a setting is empty. */
  airport?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

const moduleRegistry: Record<string, ComponentType<ModuleProps>> = {
  // Aviation
  metar: MetarModule,
  taf: TafModule,
  'flight-rules': FlightRulesModule,
  notams: NotamsModule,
  tfr: TfrModule,
  'winds-aloft': WindsAloftModule,

  // Weather
  'current-weather': CurrentWeatherModule,
  'weather-forecast': WeatherForecastModule,
  'radar-map': RadarModule,
  'sun-times': SunTimesModule,

  // Time
  'digital-clock': DigitalClockModule,
  'analog-clock': AnalogClockModule,
  'world-clocks': WorldClocksModule,

  // Calendar
  calendar: CalendarModule,
  countdown: CountdownModule,

  // News
  news: NewsModule,

  // Finance
  stocks: StocksModule,
  crypto: CryptoModule,

  // Productivity
  'todo-list': TodoModule,
  quotes: QuotesModule,

  // Media
  'photo-frame': PhotoFrameModule,

  // Utilities
  'qr-code': QrCodeModule,
  'text-label': TextLabelModule,
  spacer: SpacerModule,
};

export function getModuleComponent(moduleId: string): ComponentType<ModuleProps> | null {
  return moduleRegistry[moduleId] || null;
}

/* ------------------------------------------------------------ Helpers */

/** Resolve a widget's location setting, falling back to the mirror's. */
export function resolveLocation(
  config: Record<string, unknown>,
  props: Pick<ModuleProps, 'latitude' | 'longitude' | 'timezone'>,
  key = 'location'
): LocationValue | null {
  const value = config[key] as Partial<LocationValue> | undefined;
  if (
    value &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude)
  ) {
    return {
      latitude: value.latitude,
      longitude: value.longitude,
      city: value.city,
      timezone: value.timezone ?? props.timezone,
    };
  }
  if (typeof props.latitude === 'number' && typeof props.longitude === 'number') {
    return { latitude: props.latitude, longitude: props.longitude, timezone: props.timezone };
  }
  return null;
}

/** Resolve a widget's ICAO setting, falling back to the mirror's airport. */
export function resolveAirport(config: Record<string, unknown>, airport?: string): string | null {
  const value = typeof config.icao === 'string' ? config.icao.trim().toUpperCase() : '';
  if (value) return value;
  return airport ? airport.toUpperCase() : null;
}

/** Normalise a list setting that may be an array or a comma-separated string. */
export function resolveList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return fallback;
}
