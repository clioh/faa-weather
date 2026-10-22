/**
 * METAR Parser
 * Parses raw METAR strings into structured data
 *
 * Example METAR:
 * KJFK 151951Z 31008KT 10SM FEW045 SCT250 17/01 A3012 RMK AO2 SLP203 T01670006
 */

export interface CloudLayer {
  coverage: 'SKC' | 'CLR' | 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';
  altitude: number | null; // in feet AGL
  type?: 'CB' | 'TCU'; // cumulonimbus or towering cumulus
}

export interface ParsedMetar {
  icao: string;
  observationTime: string; // DDHHMMz format
  isAuto: boolean;
  wind: {
    direction: number | null; // degrees, null if variable
    speed: number; // knots
    gust: number | null; // knots
    variable?: { from: number; to: number };
  } | null;
  visibility: number | null; // statute miles
  weather: string[]; // weather phenomena codes
  clouds: CloudLayer[];
  ceiling: number | null; // lowest BKN/OVC/VV layer in feet
  temperature: number | null; // celsius
  dewpoint: number | null; // celsius
  altimeter: number | null; // inches Hg
  remarks: string;
}

/**
 * Parse wind information from METAR
 * Formats: 31008KT, 31008G15KT, VRB05KT, 00000KT, 310V350
 */
function parseWind(parts: string[]): {
  wind: ParsedMetar['wind'];
  consumed: number;
} {
  let consumed = 0;
  let wind: ParsedMetar['wind'] = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Main wind group: DDDSSKT or DDDSSGSKT or VRBSSKT
    const windMatch = part.match(/^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT$/);
    if (windMatch) {
      const direction = windMatch[1] === 'VRB' ? null : parseInt(windMatch[1], 10);
      const speed = parseInt(windMatch[2], 10);
      const gust = windMatch[4] ? parseInt(windMatch[4], 10) : null;

      wind = { direction, speed, gust };
      consumed = i + 1;

      // Check for variable wind direction (e.g., 310V350)
      if (i + 1 < parts.length) {
        const varMatch = parts[i + 1].match(/^(\d{3})V(\d{3})$/);
        if (varMatch) {
          wind.variable = {
            from: parseInt(varMatch[1], 10),
            to: parseInt(varMatch[2], 10),
          };
          consumed = i + 2;
        }
      }
      break;
    }
  }

  return { wind, consumed };
}

/**
 * Parse visibility from METAR
 * Formats: 10SM, 1/2SM, 1 1/2SM, P6SM, M1/4SM
 */
function parseVisibility(parts: string[]): {
  visibility: number | null;
  consumed: number;
} {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Check for visibility with SM suffix
    // P6SM = greater than 6, M1/4SM = less than 1/4
    const visMatch = part.match(/^([PM])?(\d+)?(\/)?(\d+)?SM$/);
    if (visMatch) {
      let visibility: number;
      const prefix = visMatch[1];
      const whole = visMatch[2] ? parseInt(visMatch[2], 10) : 0;
      const hasFraction = visMatch[3] === '/';
      const denominator = visMatch[4] ? parseInt(visMatch[4], 10) : 1;

      if (hasFraction && visMatch[2] && visMatch[4]) {
        // Fraction like 1/2SM or 3/4SM
        visibility = whole / denominator;
      } else if (hasFraction) {
        // Just a fraction
        visibility = whole / denominator;
      } else {
        visibility = whole;
      }

      // Check if previous part is a whole number (e.g., "1 1/2SM")
      if (i > 0 && /^\d+$/.test(parts[i - 1]) && hasFraction) {
        visibility = parseInt(parts[i - 1], 10) + visibility;
      }

      if (prefix === 'P') visibility = 10; // P6SM means > 6, use 10
      if (prefix === 'M') visibility = visibility * 0.5; // M means less than

      return { visibility, consumed: i + 1 };
    }
  }

  return { visibility: null, consumed: 0 };
}

/**
 * Parse weather phenomena
 * Format: +RA, -SN, TSRA, BR, FG, etc.
 */
function parseWeather(parts: string[]): {
  weather: string[];
  consumed: number;
} {
  const weatherCodes = [
    // Intensity
    '\\+',
    '-',
    'VC',
    // Descriptor
    'MI',
    'PR',
    'BC',
    'DR',
    'BL',
    'SH',
    'TS',
    'FZ',
    // Precipitation
    'DZ',
    'RA',
    'SN',
    'SG',
    'IC',
    'PL',
    'GR',
    'GS',
    'UP',
    // Obscuration
    'BR',
    'FG',
    'FU',
    'VA',
    'DU',
    'SA',
    'HZ',
    'PY',
    // Other
    'PO',
    'SQ',
    'FC',
    'SS',
    'DS',
  ];

  const weatherPattern = new RegExp(`^([+-]|VC)?(${weatherCodes.slice(3).join('|')})+$`);

  const weather: string[] = [];
  let lastIdx = 0;

  for (let i = 0; i < parts.length; i++) {
    if (weatherPattern.test(parts[i])) {
      weather.push(parts[i]);
      lastIdx = i + 1;
    } else if (weather.length > 0) {
      break;
    }
  }

  return { weather, consumed: lastIdx };
}

/**
 * Parse cloud layers
 * Format: FEW045, SCT100, BKN020CB, OVC005, VV002, SKC, CLR
 */
function parseClouds(parts: string[]): {
  clouds: CloudLayer[];
  ceiling: number | null;
} {
  const clouds: CloudLayer[] = [];
  let ceiling: number | null = null;

  const cloudPattern = /^(SKC|CLR|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?$/;

  for (const part of parts) {
    const match = part.match(cloudPattern);
    if (match) {
      const coverage = match[1] as CloudLayer['coverage'];
      const altitude = match[2] ? parseInt(match[2], 10) * 100 : null;
      const type = match[3] as CloudLayer['type'] | undefined;

      clouds.push({ coverage, altitude, type });

      // Ceiling is the lowest BKN, OVC, or VV layer
      if (
        (coverage === 'BKN' || coverage === 'OVC' || coverage === 'VV') &&
        altitude !== null &&
        (ceiling === null || altitude < ceiling)
      ) {
        ceiling = altitude;
      }
    }
  }

  return { clouds, ceiling };
}

/**
 * Parse temperature and dewpoint
 * Format: 17/01, M02/M05, 17/M01
 */
function parseTemperature(parts: string[]): {
  temperature: number | null;
  dewpoint: number | null;
} {
  for (const part of parts) {
    const match = part.match(/^(M)?(\d{2})\/(M)?(\d{2})$/);
    if (match) {
      let temperature = parseInt(match[2], 10);
      let dewpoint = parseInt(match[4], 10);

      if (match[1] === 'M') temperature = -temperature;
      if (match[3] === 'M') dewpoint = -dewpoint;

      return { temperature, dewpoint };
    }
  }

  return { temperature: null, dewpoint: null };
}

/**
 * Parse altimeter setting
 * Format: A3012 (inches Hg * 100)
 */
function parseAltimeter(parts: string[]): number | null {
  for (const part of parts) {
    const match = part.match(/^A(\d{4})$/);
    if (match) {
      return parseInt(match[1], 10) / 100;
    }
  }
  return null;
}

/**
 * Main METAR parser
 */
export function parseMetar(raw: string): ParsedMetar {
  // Normalize and split. aviationweather.gov's raw format prefixes the report
  // type ("METAR KSFO ..." / "SPECI KSFO ..."); drop it so the station ID is
  // the first token.
  const normalized = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(?:METAR|SPECI)\s+(?:COR\s+)?/, '');
  const parts = normalized.split(' ');

  // Extract ICAO (first 4-letter group)
  const icao = parts[0] || '';

  // Extract observation time (DDHHMMz)
  const timeMatch = parts[1]?.match(/^(\d{6})Z$/);
  const observationTime = timeMatch ? timeMatch[1] : '';

  // Check for AUTO
  const isAuto = parts.includes('AUTO');

  // Find RMK section
  const rmkIndex = parts.indexOf('RMK');
  const mainParts = rmkIndex > -1 ? parts.slice(0, rmkIndex) : parts;
  const remarks = rmkIndex > -1 ? parts.slice(rmkIndex + 1).join(' ') : '';

  // Parse components from main section
  const { wind } = parseWind(mainParts);
  const { visibility } = parseVisibility(mainParts);
  const { weather } = parseWeather(mainParts);
  const { clouds, ceiling } = parseClouds(mainParts);
  const { temperature, dewpoint } = parseTemperature(mainParts);
  const altimeter = parseAltimeter(mainParts);

  return {
    icao,
    observationTime,
    isAuto,
    wind,
    visibility,
    weather,
    clouds,
    ceiling,
    temperature,
    dewpoint,
    altimeter,
    remarks,
  };
}

/**
 * Format wind for display
 */
export function formatWind(wind: ParsedMetar['wind']): string {
  if (!wind) return 'Calm';
  if (wind.speed === 0) return 'Calm';

  const dir = wind.direction === null ? 'VRB' : `${wind.direction.toString().padStart(3, '0')}°`;
  let str = `${dir} at ${wind.speed}kt`;

  if (wind.gust) {
    str += ` gusting ${wind.gust}kt`;
  }

  if (wind.variable) {
    str += ` (variable ${wind.variable.from}°-${wind.variable.to}°)`;
  }

  return str;
}

/**
 * Format visibility for display
 */
export function formatVisibility(visibility: number | null): string {
  if (visibility === null) return 'Unknown';
  if (visibility >= 10) return '10+ SM';
  if (visibility < 1) return `${visibility} SM`;
  return `${visibility} SM`;
}

/**
 * Format clouds for display
 */
export function formatClouds(clouds: CloudLayer[]): string {
  if (clouds.length === 0) return 'No clouds reported';

  return clouds
    .map((c) => {
      if (c.coverage === 'SKC' || c.coverage === 'CLR') return c.coverage;
      const alt = c.altitude ? `${c.altitude.toLocaleString()}ft` : '';
      const type = c.type ? ` ${c.type}` : '';
      return `${c.coverage} ${alt}${type}`.trim();
    })
    .join(', ');
}
