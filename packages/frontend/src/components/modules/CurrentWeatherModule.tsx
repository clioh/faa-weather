/**
 * Current Weather Module
 * Displays current weather conditions with temperature
 */

import { useEffect, useState } from 'react';
import { ModuleProps } from './index';

interface WeatherData {
  temp: number;
  feelsLike: number;
  humidity: number;
  condition: string;
  icon: string;
  windSpeed: number;
  windDir: string;
}

interface WeatherConfig {
  units?: 'imperial' | 'metric';
}

export function CurrentWeatherModule({ config, latitude, longitude, size }: ModuleProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weatherConfig = config as WeatherConfig;
  const units = weatherConfig.units || 'imperial';

  useEffect(() => {
    const fetchWeather = async () => {
      if (!latitude || !longitude) {
        setError('Location not configured');
        setLoading(false);
        return;
      }

      try {
        // Using Open-Meteo free API (no key required)
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=${units === 'imperial' ? 'fahrenheit' : 'celsius'}&wind_speed_unit=${units === 'imperial' ? 'mph' : 'kmh'}`
        );
        if (!response.ok) throw new Error('Failed to fetch weather');
        const data = await response.json();

        const current = data.current;
        setWeather({
          temp: Math.round(current.temperature_2m),
          feelsLike: Math.round(current.apparent_temperature),
          humidity: current.relative_humidity_2m,
          condition: getWeatherCondition(current.weather_code),
          icon: getWeatherIcon(current.weather_code),
          windSpeed: Math.round(current.wind_speed_10m),
          windDir: getWindDirection(current.wind_direction_10m),
        });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 15 * 60 * 1000); // Refresh every 15 minutes
    return () => clearInterval(interval);
  }, [latitude, longitude, units]);

  if (loading) {
    return <div className="module-loading">Loading weather...</div>;
  }

  if (error) {
    return <div className="module-error">{error}</div>;
  }

  if (!weather) {
    return <div className="module-error">No weather data</div>;
  }

  const tempUnit = units === 'imperial' ? '°F' : '°C';
  const windUnit = units === 'imperial' ? 'mph' : 'km/h';
  const isCompact = size === 'small';

  return (
    <div className="current-weather-module">
      <div className="weather-main">
        <span className="weather-icon">{weather.icon}</span>
        <div className="weather-temp">
          <span className="temp-value">{weather.temp}</span>
          <span className="temp-unit">{tempUnit}</span>
        </div>
      </div>

      <div className="weather-condition">{weather.condition}</div>

      {!isCompact && (
        <div className="weather-details">
          <div className="detail">
            <span className="label">Feels like</span>
            <span className="value">{weather.feelsLike}{tempUnit}</span>
          </div>
          <div className="detail">
            <span className="label">Humidity</span>
            <span className="value">{weather.humidity}%</span>
          </div>
          <div className="detail">
            <span className="label">Wind</span>
            <span className="value">{weather.windDir} {weather.windSpeed} {windUnit}</span>
          </div>
        </div>
      )}

      <style>{`
        .current-weather-module {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .weather-main {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .weather-icon {
          font-size: 3rem;
        }

        .weather-temp {
          display: flex;
          align-items: flex-start;
        }

        .temp-value {
          font-size: 3.5rem;
          font-weight: 200;
          line-height: 1;
        }

        .temp-unit {
          font-size: 1.5rem;
          color: var(--color-text-dim);
          margin-top: 0.25rem;
        }

        .weather-condition {
          font-size: 1.25rem;
          color: var(--color-text-dim);
          margin-top: 0.5rem;
          text-transform: capitalize;
        }

        .weather-details {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.75rem;
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .detail {
          display: flex;
          flex-direction: column;
        }

        .detail .label {
          font-size: 0.7rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .detail .value {
          font-size: 0.9rem;
        }
      `}</style>
    </div>
  );
}

// Helper functions for weather codes (WMO codes)
function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
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
    96: 'Thunderstorm with hail',
    99: 'Thunderstorm with heavy hail',
  };
  return conditions[code] || 'Unknown';
}

function getWeatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 55) return '🌧️';
  if (code <= 65) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}
