/**
 * Weather Forecast Module
 * Multi-day weather forecast
 */

import { useEffect, useState } from 'react';
import { ModuleProps } from './index';

interface ForecastDay {
  date: string;
  dayName: string;
  high: number;
  low: number;
  icon: string;
  condition: string;
}

interface ForecastConfig {
  days?: number;
  units?: 'imperial' | 'metric';
}

export function WeatherForecastModule({ config, latitude, longitude, size }: ModuleProps) {
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const forecastConfig = config as ForecastConfig;
  const days = forecastConfig.days || 5;
  const units = forecastConfig.units || 'imperial';

  useEffect(() => {
    const fetchForecast = async () => {
      if (!latitude || !longitude) {
        setError('Location not configured');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=${units === 'imperial' ? 'fahrenheit' : 'celsius'}&forecast_days=${days}`
        );
        if (!response.ok) throw new Error('Failed to fetch forecast');
        const data = await response.json();

        const forecastData: ForecastDay[] = data.daily.time.map((date: string, i: number) => ({
          date,
          dayName: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
          high: Math.round(data.daily.temperature_2m_max[i]),
          low: Math.round(data.daily.temperature_2m_min[i]),
          icon: getWeatherIcon(data.daily.weather_code[i]),
          condition: getWeatherCondition(data.daily.weather_code[i]),
        }));

        setForecast(forecastData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchForecast();
    const interval = setInterval(fetchForecast, 60 * 60 * 1000); // Refresh hourly
    return () => clearInterval(interval);
  }, [latitude, longitude, days, units]);

  if (loading) {
    return <div className="module-loading">Loading forecast...</div>;
  }

  if (error) {
    return <div className="module-error">{error}</div>;
  }

  const isWide = size === 'wide' || size === 'full';
  const tempUnit = units === 'imperial' ? '°' : '°';

  return (
    <div className={`weather-forecast-module ${isWide ? 'horizontal' : 'vertical'}`}>
      {forecast.map((day, i) => (
        <div key={day.date} className={`forecast-day ${i === 0 ? 'today' : ''}`}>
          <span className="day-name">{i === 0 ? 'Today' : day.dayName}</span>
          <span className="day-icon">{day.icon}</span>
          <div className="day-temps">
            <span className="temp-high">{day.high}{tempUnit}</span>
            <span className="temp-low">{day.low}{tempUnit}</span>
          </div>
        </div>
      ))}

      <style>{`
        .weather-forecast-module {
          display: flex;
          height: 100%;
          gap: 0.5rem;
        }

        .weather-forecast-module.horizontal {
          flex-direction: row;
          justify-content: space-around;
          align-items: center;
        }

        .weather-forecast-module.vertical {
          flex-direction: column;
          justify-content: space-around;
        }

        .forecast-day {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.03);
        }

        .forecast-day.today {
          background: rgba(255, 255, 255, 0.08);
        }

        .horizontal .forecast-day {
          flex-direction: column;
          gap: 0.25rem;
          padding: 0.75rem;
          min-width: 60px;
        }

        .day-name {
          font-size: 0.8rem;
          color: var(--color-text-dim);
          font-weight: 500;
        }

        .day-icon {
          font-size: 1.5rem;
        }

        .day-temps {
          display: flex;
          gap: 0.5rem;
          font-size: 0.9rem;
        }

        .horizontal .day-temps {
          flex-direction: column;
          gap: 0;
          text-align: center;
        }

        .temp-high {
          font-weight: 600;
        }

        .temp-low {
          color: var(--color-text-dim);
        }
      `}</style>
    </div>
  );
}

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy',
    45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
    61: 'Rain', 63: 'Rain', 65: 'Heavy Rain', 71: 'Snow', 73: 'Snow',
    75: 'Heavy Snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy Showers',
    95: 'Thunderstorm', 96: 'T-Storm', 99: 'Severe T-Storm',
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
  return '⛈️';
}
