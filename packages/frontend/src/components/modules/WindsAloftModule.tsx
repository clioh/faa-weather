/**
 * Winds Aloft — FB forecast winds and temperatures by altitude.
 *
 * small: the three lowest levels as rows
 * medium / tall: one row per level (altitude, barb, 270/25, temp)
 * wide: one column per level
 */

import type { ReactElement } from 'react';
import { ModuleProps, resolveLocation } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import {
  barbComponents,
  fetchErrorHint,
  formatAltitudeLabel,
  formatSigned,
  formatWindsAloft,
  formatZulu,
} from './aviationFormat';
import './WindsAloftModule.css';

interface WindsLevel {
  altitude: number;
  direction: number | null;
  speed: number;
  temperature: number | null;
}

interface WindsAloftResponse {
  station: string;
  stationName: string | null;
  validAt: string | null;
  forUse: string | null;
  levels: WindsLevel[];
  fetchedAt: string;
}

const LEVEL_CAP: Record<string, number> = { small: 3, medium: 6, tall: 9, wide: 9 };
const ALTITUDES = new Set(['9000', '12000', '18000', '30000']);

export function WindsAloftModule({ config, size, latitude, longitude, timezone }: ModuleProps) {
  const location = resolveLocation(config, { latitude, longitude, timezone });
  const maxAltitude = ALTITUDES.has(String(config.maxAltitude))
    ? String(config.maxAltitude)
    : '12000';
  const url = location
    ? `/api/aviation/winds-aloft?lat=${location.latitude.toFixed(3)}&lon=${location.longitude.toFixed(3)}&maxAltitude=${maxAltitude}`
    : null;
  const { data, loading, error, isStale, lastUpdated } = useModuleData<WindsAloftResponse>(url, {
    refreshMs: 30 * 60_000,
  });

  const levels = [...(data?.levels ?? [])]
    .filter((l) => l.altitude <= Number(maxAltitude))
    .sort((a, b) => a.altitude - b.altitude)
    .slice(0, LEVEL_CAP[size] ?? 6);

  const meta = data ? (
    data.validAt ? (
      <span className={`mf-meta${isStale ? ' stale' : ''}`}>VALID {formatZulu(data.validAt)}</span>
    ) : (
      <Age at={lastUpdated} stale={isStale} />
    )
  ) : undefined;

  return (
    <ModuleFrame
      title="Winds aloft"
      accent={data?.station || undefined}
      meta={meta}
      className={`winds winds-${size}`}
    >
      {!location ? (
        <ModuleEmpty title="No location set" hint="Set a location in the app" />
      ) : loading ? (
        <ModuleLoading />
      ) : !data ? (
        <ModuleError
          title="Winds unavailable"
          hint={fetchErrorHint(error, 'No FB station nearby')}
        />
      ) : levels.length === 0 ? (
        <ModuleEmpty title="No levels reported" hint={`Station ${data.station}`} />
      ) : (
        <div className={size === 'wide' ? 'winds-cols' : 'winds-rows'}>
          {levels.map((l) => (
            <div key={l.altitude} className="winds-level">
              <span className="winds-alt mono">{formatAltitudeLabel(l.altitude)}</span>
              <WindBarb direction={l.direction} speed={l.speed} />
              <span className="winds-value mono">{formatWindsAloft(l.direction, l.speed)}</span>
              <span className="winds-temp mono">
                {l.temperature === null ? '' : `${formatSigned(l.temperature)}°`}
              </span>
            </div>
          ))}
        </div>
      )}
    </ModuleFrame>
  );
}

/**
 * Standard wind barb. The staff points toward where the wind comes from;
 * feathers sit at the outer end on the clockwise side (northern hemisphere):
 * pennant 50 kt, full 10 kt, half 5 kt. Light and variable shows "LV".
 */
function WindBarb({ direction, speed }: { direction: number | null; speed: number }) {
  if (direction === null) {
    return <span className="winds-barb winds-lv mono">LV</span>;
  }
  const { pennants, fulls, halves } = barbComponents(speed);
  const marks: ReactElement[] = [];
  const top = -17;
  let y = top;

  if (pennants + fulls + halves === 0) {
    return (
      <svg className="winds-barb" viewBox="-18 -18 36 36" aria-hidden="true">
        <circle cx="0" cy="0" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }

  for (let i = 0; i < pennants; i++) {
    marks.push(<polygon key={`p${i}`} points={`0,${y} 8,${y} 0,${y + 4}`} fill="currentColor" />);
    y += 5;
  }
  for (let i = 0; i < fulls; i++) {
    marks.push(<line key={`f${i}`} x1="0" y1={y} x2="8" y2={y - 3} />);
    y += 3;
  }
  if (halves) {
    // A lone half barb sits one step in from the tip so it is not read as a full.
    if (y === top) y += 3;
    marks.push(<line key="h" x1="0" y1={y} x2="4" y2={y - 1.5} />);
  }

  return (
    <svg className="winds-barb" viewBox="-18 -18 36 36" aria-hidden="true">
      <g
        transform={`rotate(${direction})`}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="0" y1="0" x2="0" y2={top} />
        {marks}
      </g>
      <circle cx="0" cy="0" r="1.6" fill="currentColor" />
    </svg>
  );
}
