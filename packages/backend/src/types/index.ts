// Aviation types
export type FlightRules = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export interface Metar {
  raw: string;
  icao: string;
  observationTime: Date;
  temperature: number | null;
  dewpoint: number | null;
  windDirection: number | null;
  windSpeed: number | null;
  windGust: number | null;
  visibility: number | null;
  altimeter: number | null;
  ceiling: number | null;
  clouds: CloudLayer[];
  flightRules: FlightRules;
  weatherPhenomena: string[];
}

export interface CloudLayer {
  coverage: 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'CLR' | 'SKC';
  altitude: number | null;
}

export interface TafPeriod {
  type: 'FM' | 'TEMPO' | 'BECMG' | 'PROB';
  probability?: number;
  startTime: Date;
  endTime: Date;
  windDirection: number | null;
  windSpeed: number | null;
  windGust: number | null;
  visibility: number | null;
  clouds: CloudLayer[];
  weatherPhenomena: string[];
  flightRules: FlightRules;
}

export interface Taf {
  raw: string;
  icao: string;
  issueTime: Date;
  validFrom: Date;
  validTo: Date;
  periods: TafPeriod[];
}

export interface Tfr {
  id: string;
  type: string;
  description: string;
  effectiveStart: Date;
  effectiveEnd: Date;
  latitude: number;
  longitude: number;
  radius: number;
  altitudeLow: number;
  altitudeHigh: number;
}

export interface Notam {
  id: string;
  icao: string;
  type: string;
  category: string;
  description: string;
  effectiveStart: Date;
  effectiveEnd: Date | null;
}

// Astronomical types
export interface AstroData {
  date: string;
  sunrise: Date;
  sunset: Date;
  civilTwilightBegin: Date;
  civilTwilightEnd: Date;
  nauticalTwilightBegin: Date;
  nauticalTwilightEnd: Date;
  solarNoon: Date;
  moonPhase: number;
  moonIllumination: number;
}

// Schedule types
export interface ScheduleEvent {
  id: string;
  source: 'google' | 'xlsx';
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  location?: string;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
}

// Presence types
export interface PresenceState {
  present: boolean;
  confidence: number;
  lastDetection: Date | null;
}

// WebSocket message types
export interface WSMessage {
  type: string;
  data: unknown;
  timestamp: number;
}
