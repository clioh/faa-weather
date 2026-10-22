/**
 * Current Weather — temperature, conditions, feels-like, humidity, wind.
 *
 * small: hero temperature + icon + condition
 * medium: adds a metrics row beneath
 * wide: hero block on the left, metrics stacked on the right
 */

import { ModuleProps, resolveLocation } from './index';
import { Age, Metric, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { compassPoint, fetchErrorHint } from './aviationFormat';
import { WeatherIcon } from './WeatherIcon';
import './CurrentWeatherModule.css';

interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  windGust: number | null;
  weatherCode: number;
  description: string;
  isDay: boolean;
  units: 'imperial' | 'metric';
  fetchedAt: string;
}

export function CurrentWeatherModule({ config, size, latitude, longitude, timezone }: ModuleProps) {
  const location = resolveLocation(config, { latitude, longitude, timezone });
  const units = config.units === 'metric' ? 'metric' : 'imperial';
  const url = location
    ? `/api/weather/current?lat=${location.latitude.toFixed(3)}&lon=${location.longitude.toFixed(3)}&units=${units}`
    : null;
  const { data, loading, error, isStale, lastUpdated } = useModuleData<CurrentWeather>(url, {
    refreshMs: 10 * 60_000,
  });

  const tempUnit = units === 'metric' ? 'C' : 'F';
  const windUnit = units === 'metric' ? 'km/h' : 'mph';
  const small = size === 'small';

  let body;
  if (!location) {
    body = <ModuleEmpty title="No location set" hint="Set a location in the app" />;
  } else if (loading) {
    body = <ModuleLoading />;
  } else if (!data) {
    body = <ModuleError title="Weather unavailable" hint={fetchErrorHint(error, 'No data for this location')} />;
  } else {
    const wind =
      Math.round(data.windSpeed) === 0
        ? 'Calm'
        : `${compassPoint(data.windDirection)} ${Math.round(data.windSpeed)}${
            data.windGust ? `G${Math.round(data.windGust)}` : ''
          }`;
    body = (
      <div className="cw-body">
        <div className="cw-hero">
          <div className="cw-now">
            <span className="cw-temp">
              {Math.round(data.temperature)}
              <sup className="cw-unit">°{tempUnit}</sup>
            </span>
            <WeatherIcon code={data.weatherCode} isDay={data.isDay} className="cw-icon" />
          </div>
          <span className="cw-condition">{data.description}</span>
        </div>
        {!small && (
          <div className="cw-metrics">
            <Metric label="Feels like" value={`${Math.round(data.apparentTemperature)}°`} />
            <Metric label="Humidity" value={Math.round(data.humidity)} unit="%" />
            <Metric label="Wind" value={wind} unit={wind === 'Calm' ? undefined : windUnit} />
          </div>
        )}
      </div>
    );
  }

  return (
    <ModuleFrame
      title={small ? undefined : location?.city || 'Weather'}
      meta={!small && data ? <Age at={lastUpdated} stale={isStale} /> : undefined}
      className={`cw cw-${size}`}
    >
      {body}
    </ModuleFrame>
  );
}
