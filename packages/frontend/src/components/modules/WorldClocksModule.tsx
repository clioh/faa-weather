/**
 * World clocks — one column per zone with its offset from the mirror's own
 * time and a sun/moon hint for whether it is day there.
 */

import { CSSProperties } from 'react';
import { ModuleProps, resolveList } from './index';
import { ModuleEmpty, ModuleFrame } from './ModuleFrame';
import {
  cityFromZone,
  dayKey,
  pickTimeZone,
  useNow,
  validTimeZone,
  zonedParts,
  zoneOffsetMinutes,
} from './time';
import './WorldClocksModule.css';

const DEFAULT_ZONES = ['America/New_York', 'Europe/London', 'Asia/Tokyo'];

const MAX_ZONES: Record<string, number> = {
  small: 2,
  wide: 4,
  tall: 5,
  large: 6,
};

const pad = (n: number) => String(n).padStart(2, '0');

function formatOffset(minutes: number): string {
  if (minutes === 0) return 'local';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `${sign}${h}:${pad(m)}` : `${sign}${h}h`;
}

function SunGlyph() {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const r = (a * Math.PI) / 180;
    return (
      <line
        key={a}
        x1={8 + Math.cos(r) * 5}
        y1={8 + Math.sin(r) * 5}
        x2={8 + Math.cos(r) * 7}
        y2={8 + Math.sin(r) * 7}
      />
    );
  });
  return (
    <svg className="wclock-glyph" viewBox="0 0 16 16" aria-label="day">
      <circle cx="8" cy="8" r="3" />
      {rays}
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg className="wclock-glyph" viewBox="0 0 16 16" aria-label="night">
      <path d="M10.5 2.5a6 6 0 1 0 3 9.6A5 5 0 0 1 10.5 2.5z" />
    </svg>
  );
}

export function WorldClocksModule({ config, size, timezone }: ModuleProps) {
  const format24h = config.format24h !== false;
  const zones = resolveList(config.timezones, DEFAULT_ZONES)
    .map(validTimeZone)
    .filter((z): z is string => Boolean(z))
    .slice(0, MAX_ZONES[size] ?? 4);

  const now = useNow(60_000);

  if (zones.length === 0) {
    return (
      <ModuleFrame title="World clocks">
        <ModuleEmpty title="No time zones" hint="Add time zones such as Europe/Paris in the app" />
      </ModuleFrame>
    );
  }

  const localZone = pickTimeZone(timezone);
  const localOffset = zoneOffsetMinutes(now, localZone);
  const localDay = dayKey(now, localZone);
  const stacked = size === 'tall';
  const cols = size === 'large' ? Math.min(zones.length, 3) : zones.length;
  const rows = stacked ? zones.length : Math.ceil(zones.length / cols);
  const style = { '--wc-cols': cols, '--wc-rows': rows } as CSSProperties;

  return (
    <ModuleFrame className={`wclock ${stacked ? 'wclock-stack' : 'wclock-grid'}`}>
      <div className="wclock-zones" style={style}>
        {zones.map((zone) => {
          const p = zonedParts(now, zone);
          const isDay = p.hour >= 6 && p.hour < 18;
          const hour = format24h ? pad(p.hour) : String(p.hour % 12 || 12);
          const offset = formatOffset(zoneOffsetMinutes(now, zone) - localOffset);
          const zoneDay = dayKey(now, zone);
          const weekday =
            zoneDay !== localDay
              ? new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short' }).format(now)
              : null;

          return (
            <div key={zone} className="wclock-zone">
              <div className="wclock-city">{cityFromZone(zone)}</div>
              <div className="wclock-time">
                {hour}:{pad(p.minute)}
                {!format24h && <span className="wclock-period">{p.hour < 12 ? 'AM' : 'PM'}</span>}
              </div>
              <div className="wclock-meta">
                {isDay ? <SunGlyph /> : <MoonGlyph />}
                <span>{offset}</span>
                {weekday && <span>{weekday}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </ModuleFrame>
  );
}
