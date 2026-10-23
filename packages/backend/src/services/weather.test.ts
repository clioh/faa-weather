import { describe, it, expect } from 'vitest';
import {
  describeWeatherCode,
  mapCurrent,
  mapForecast,
  weatherKey,
  WEATHER_CODES,
} from './weather.js';

describe('weatherCode mapping', () => {
  it('maps WMO codes to descriptions', () => {
    expect(describeWeatherCode(0)).toBe('Clear sky');
    expect(describeWeatherCode(3)).toBe('Overcast');
    expect(describeWeatherCode(45)).toBe('Fog');
    expect(describeWeatherCode(65)).toBe('Heavy rain');
    expect(describeWeatherCode(75)).toBe('Heavy snow');
    expect(describeWeatherCode(95)).toBe('Thunderstorm');
    expect(describeWeatherCode(99)).toBe('Thunderstorm with heavy hail');
  });

  it('returns Unknown for unmapped or missing codes', () => {
    expect(describeWeatherCode(42)).toBe('Unknown');
    expect(describeWeatherCode(null)).toBe('Unknown');
    expect(describeWeatherCode(Number.NaN)).toBe('Unknown');
  });

  it('covers every documented WMO code', () => {
    const documented = [
      0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85,
      86, 95, 96, 99,
    ];
    expect(
      Object.keys(WEATHER_CODES)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual(documented);
  });
});

describe('Open-Meteo mapping', () => {
  it('maps current conditions', () => {
    const out = mapCurrent(
      {
        current: {
          temperature_2m: 57.34,
          apparent_temperature: 55.01,
          relative_humidity_2m: 81,
          wind_speed_10m: 9.6,
          wind_direction_10m: 214,
          wind_gusts_10m: null,
          weather_code: 2,
          is_day: 0,
        },
      },
      'imperial',
      '2026-10-15T09:00:00.000Z'
    );
    expect(out).toEqual({
      temperature: 57.3,
      apparentTemperature: 55,
      humidity: 81,
      windSpeed: 10,
      windDirection: 214,
      windGust: null,
      weatherCode: 2,
      description: 'Partly cloudy',
      isDay: false,
      units: 'imperial',
      fetchedAt: '2026-10-15T09:00:00.000Z',
    });
  });

  it('throws when current data is missing', () => {
    expect(() => mapCurrent({}, 'metric', 'x')).toThrow();
  });

  it('maps daily forecast and limits days', () => {
    const out = mapForecast(
      {
        daily: {
          time: ['2026-10-15', '2026-10-16', '2026-10-17'],
          weather_code: [61, 3, 0],
          temperature_2m_max: [18.4, 16.6, 20],
          temperature_2m_min: [10.1, 9.5, 11],
          precipitation_probability_max: [80, null, 5],
        },
      },
      'metric',
      2,
      'now'
    );
    expect(out.days).toEqual([
      {
        date: '2026-10-15',
        high: 18,
        low: 10,
        weatherCode: 61,
        description: 'Slight rain',
        precipitationProbability: 80,
      },
      {
        date: '2026-10-16',
        high: 17,
        low: 10,
        weatherCode: 3,
        description: 'Overcast',
        precipitationProbability: null,
      },
    ]);
  });

  it('keys the cache on 2dp coordinates and units', () => {
    expect(weatherKey(40.64131, -73.77812, 'imperial')).toBe('40.64,-73.78|imperial');
    expect(weatherKey(40.641, -73.778, 'metric')).not.toBe(weatherKey(40.641, -73.778, 'imperial'));
  });
});
