/**
 * Analog clock — an SVG face scaled to the tile's shorter side.
 * The face is memoised; each tick only re-renders the three hand groups.
 */

import { memo } from 'react';
import { ModuleProps } from './index';
import { ModuleFrame } from './ModuleFrame';
import { cityFromZone, pickTimeZone, useNow, validTimeZone, zonedParts } from './time';
import './AnalogClockModule.css';

type FaceStyle = 'minimal' | 'classic';

const R = 48; // face radius in the -50..50 viewBox

function polar(angleDeg: number, radius: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}

const Face = memo(function Face({ faceStyle }: { faceStyle: FaceStyle }) {
  const ticks = [];
  const count = faceStyle === 'classic' ? 60 : 12;
  for (let i = 0; i < count; i++) {
    const isHour = faceStyle === 'minimal' || i % 5 === 0;
    const outer = polar((i * 360) / count, R);
    const inner = polar((i * 360) / count, isHour ? R - 7 : R - 3);
    ticks.push(
      <line
        key={i}
        className={isHour ? 'aclock-tick hour' : 'aclock-tick'}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
      />
    );
  }

  const numerals =
    faceStyle === 'classic'
      ? [12, 3, 6, 9].map((n) => {
          const p = polar(n * 30, R - 15);
          return (
            <text key={n} className="aclock-numeral" x={p.x} y={p.y} dy="0.35em">
              {n}
            </text>
          );
        })
      : null;

  return (
    <g>
      {ticks}
      {numerals}
    </g>
  );
});

export function AnalogClockModule({ config, timezone }: ModuleProps) {
  const faceStyle: FaceStyle = config.style === 'classic' ? 'classic' : 'minimal';
  const showSeconds = config.showSeconds !== false;
  const ownZone = validTimeZone(config.timezone);
  const tz = pickTimeZone(config.timezone, timezone);
  const caption = ownZone && ownZone !== validTimeZone(timezone) ? cityFromZone(ownZone) : null;

  const now = useNow(showSeconds ? 1000 : 60_000);
  const p = zonedParts(now, tz);
  const secondAngle = p.second * 6;
  const minuteAngle = p.minute * 6 + (showSeconds ? p.second * 0.1 : 0);
  const hourAngle = (p.hour % 12) * 30 + p.minute * 0.5;

  return (
    <ModuleFrame className="aclock">
      <div className="aclock-face">
        <svg
          viewBox="-50 -50 100 100"
          role="img"
          aria-label={`${p.hour}:${String(p.minute).padStart(2, '0')}`}
        >
          <Face faceStyle={faceStyle} />
          <g transform={`rotate(${hourAngle})`}>
            <line className="aclock-hand hour" x1="0" y1="4" x2="0" y2={-R * 0.5} />
          </g>
          <g transform={`rotate(${minuteAngle})`}>
            <line className="aclock-hand minute" x1="0" y1="5" x2="0" y2={-R * 0.8} />
          </g>
          {showSeconds && (
            <g transform={`rotate(${secondAngle})`}>
              <line className="aclock-hand second" x1="0" y1="8" x2="0" y2={-R * 0.88} />
            </g>
          )}
          <circle className="aclock-hub" r="1.6" />
        </svg>
      </div>
      {caption && <div className="aclock-caption">{caption}</div>}
    </ModuleFrame>
  );
}
