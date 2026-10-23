/**
 * Forecast — daily highs, lows and conditions.
 *
 * wide: up to 5 day columns
 * large: one row of up to 4, or two rows when more days are configured
 * full: up to 7 columns
 */

import { ModuleProps, resolveLocation } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { fetchErrorHint } from './aviationFormat';
import { WeatherIcon } from './WeatherIcon';
import './WeatherForecastModule.css';

interface ForecastDay {
  date: string; // YYYY-MM-DD in the location's zone
  high: number;
  low: number;
  weatherCode: number;
  description: string;
  precipitationProbability: number | null;
}

interface ForecastResponse {
  days: ForecastDay[];
  units: 'imperial' | 'metric';
  fetchedAt: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday from a calendar date without a UTC round-trip shifting the day. */
function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()] ?? date;
}

function todayIn(timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date());
  }
}

export function WeatherForecastModule({
  config,
  size,
  latitude,
  longitude,
  timezone,
}: ModuleProps) {
  const location = resolveLocation(config, { latitude, longitude, timezone });
  const units = config.units === 'metric' ? 'metric' : 'imperial';
  const days = Math.min(7, Math.max(3, Number(config.days) || 5));
  const url = location
    ? `/api/weather/forecast?lat=${location.latitude.toFixed(3)}&lon=${location.longitude.toFixed(3)}&units=${units}&days=${days}`
    : null;
  const { data, loading, error, isStale, lastUpdated } = useModuleData<ForecastResponse>(url, {
    refreshMs: 10 * 60_000,
  });

  const fit = size === 'full' ? 7 : size === 'large' ? 8 : 5;
  const shown = (data?.days ?? []).slice(0, Math.min(days, fit));
  const twoRows = size === 'large' && shown.length > 4;
  const columns = twoRows ? Math.ceil(shown.length / 2) : Math.max(shown.length, 1);
  const today = todayIn(location?.timezone);

  return (
    <ModuleFrame
      title="Forecast"
      accent={location?.city}
      meta={data ? <Age at={lastUpdated} stale={isStale} /> : undefined}
      className={`fc fc-${size}${twoRows ? ' fc-two-rows' : ''}`}
    >
      {!location ? (
        <ModuleEmpty title="No location set" hint="Set a location in the app" />
      ) : loading ? (
        <ModuleLoading />
      ) : !data ? (
        <ModuleError
          title="Forecast unavailable"
          hint={fetchErrorHint(error, 'No data for this location')}
        />
      ) : shown.length === 0 ? (
        <ModuleEmpty title="No forecast" />
      ) : (
        <div
          className="fc-grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {shown.map((d) => (
            <div key={d.date} className={`fc-day${d.date === today ? ' today' : ''}`}>
              <span className="fc-name">{d.date === today ? 'Today' : weekday(d.date)}</span>
              <WeatherIcon code={d.weatherCode} className="fc-icon" title={d.description} />
              <span className="fc-temps mono">
                <span className="fc-high">{Math.round(d.high)}°</span>
                <span className="fc-low">{Math.round(d.low)}°</span>
              </span>
              <span className="fc-precip mono">
                {d.precipitationProbability ? `${Math.round(d.precipitationProbability)}%` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </ModuleFrame>
  );
}
