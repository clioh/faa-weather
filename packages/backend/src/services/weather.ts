/**
 * General Weather Service (Open-Meteo, no API key)
 * Current conditions and a daily forecast for any coordinates.
 */

import { TtlCache, UpstreamError, fetchJson } from './upstream.js';

export const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
export const MAX_FORECAST_DAYS = 16;
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

export type Units = 'imperial' | 'metric';

/** WMO weather interpretation codes used by Open-Meteo. */
export const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export function describeWeatherCode(code: number | null | undefined): string {
  if (code === null || code === undefined || !Number.isFinite(code)) return 'Unknown';
  return WEATHER_CODES[code] ?? 'Unknown';
}

export interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  windGust: number | null;
  weatherCode: number;
  description: string;
  isDay: boolean;
  units: Units;
  fetchedAt: string;
}

export interface ForecastDay {
  date: string;
  high: number;
  low: number;
  weatherCode: number;
  description: string;
  precipitationProbability: number | null;
}

export interface WeatherForecast {
  days: ForecastDay[];
  units: Units;
  fetchedAt: string;
}

function unitParams(units: Units): string {
  return units === 'imperial'
    ? 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'
    : 'temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm';
}

/** Cache key: coordinates rounded to 2 dp (~1 km) plus units. */
export function weatherKey(lat: number, lon: number, units: Units): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}|${units}`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

interface OpenMeteoCurrent {
  current?: Record<string, unknown>;
}

interface OpenMeteoDaily {
  daily?: {
    time?: string[];
    weather_code?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

export function mapCurrent(
  body: OpenMeteoCurrent,
  units: Units,
  fetchedAt: string
): CurrentWeather {
  const c = body.current;
  const temperature = num(c?.temperature_2m);
  const code = num(c?.weather_code);
  if (!c || temperature === null || code === null)
    throw new UpstreamError('Weather data incomplete');
  return {
    temperature: round1(temperature),
    apparentTemperature: round1(num(c.apparent_temperature) ?? temperature),
    humidity: Math.round(num(c.relative_humidity_2m) ?? 0),
    windSpeed: Math.round(num(c.wind_speed_10m) ?? 0),
    windDirection: Math.round(num(c.wind_direction_10m) ?? 0),
    windGust: num(c.wind_gusts_10m) !== null ? Math.round(num(c.wind_gusts_10m)!) : null,
    weatherCode: code,
    description: describeWeatherCode(code),
    isDay: num(c.is_day) === 1,
    units,
    fetchedAt,
  };
}

export function mapForecast(
  body: OpenMeteoDaily,
  units: Units,
  days: number,
  fetchedAt: string
): WeatherForecast {
  const d = body.daily;
  if (!d?.time) throw new UpstreamError('Forecast data incomplete');
  const out: ForecastDay[] = [];
  for (let i = 0; i < d.time.length && out.length < days; i++) {
    const high = num(d.temperature_2m_max?.[i]);
    const low = num(d.temperature_2m_min?.[i]);
    const code = num(d.weather_code?.[i]);
    if (high === null || low === null || code === null) continue;
    out.push({
      date: d.time[i],
      high: Math.round(high),
      low: Math.round(low),
      weatherCode: code,
      description: describeWeatherCode(code),
      precipitationProbability: num(d.precipitation_probability_max?.[i]),
    });
  }
  return { days: out, units, fetchedAt };
}

const currentCache = new TtlCache<CurrentWeather>(WEATHER_CACHE_TTL_MS);
const forecastCache = new TtlCache<WeatherForecast>(WEATHER_CACHE_TTL_MS);

export async function getCurrentWeather(
  lat: number,
  lon: number,
  units: Units
): Promise<CurrentWeather> {
  const key = weatherKey(lat, lon, units);
  const result = await currentCache.get(key, async () => {
    const url =
      `${OPEN_METEO}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day' +
      `&${unitParams(units)}&timezone=auto`;
    const body = await fetchJson<OpenMeteoCurrent>(url, { timeoutMs: 8000, maxBytes: 256 * 1024 });
    return mapCurrent(body, units, new Date().toISOString());
  });
  return result.value;
}

export async function getWeatherForecast(
  lat: number,
  lon: number,
  units: Units,
  days: number
): Promise<WeatherForecast> {
  const n = Math.min(Math.max(Math.trunc(days) || 5, 1), MAX_FORECAST_DAYS);
  // Always fetch the full window so one cache entry serves every `days` value.
  const result = await forecastCache.get(weatherKey(lat, lon, units), async () => {
    const url =
      `${OPEN_METEO}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      `&forecast_days=${MAX_FORECAST_DAYS}&${unitParams(units)}&timezone=auto`;
    const body = await fetchJson<OpenMeteoDaily>(url, { timeoutMs: 8000, maxBytes: 512 * 1024 });
    return mapForecast(body, units, MAX_FORECAST_DAYS, new Date().toISOString());
  });
  return { ...result.value, days: result.value.days.slice(0, n) };
}
