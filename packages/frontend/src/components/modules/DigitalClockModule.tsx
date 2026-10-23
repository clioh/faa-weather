/**
 * Clock — the time, big and thin, with the date and Zulu time beneath.
 * No header: the time is its own label.
 */

import { useMemo } from 'react';
import { ModuleProps } from './index';
import { ModuleFrame } from './ModuleFrame';
import { cityFromZone, pickTimeZone, useNow, validTimeZone, zonedParts } from './time';
import './DigitalClockModule.css';

const pad = (n: number) => String(n).padStart(2, '0');

export function DigitalClockModule({ config, timezone, size }: ModuleProps) {
  const format24h = config.format24h === true;
  const showSeconds = config.showSeconds === true;
  const showDate = config.showDate !== false;
  const showZulu = config.showZulu !== false;

  const ownZone = validTimeZone(config.timezone);
  const tz = pickTimeZone(config.timezone, timezone);
  // Only label the city when the clock deliberately shows another zone.
  const city = ownZone && ownZone !== validTimeZone(timezone) ? cityFromZone(ownZone) : null;

  // Without seconds there is nothing to repaint between minute boundaries.
  const now = useNow(showSeconds ? 1000 : 60_000);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: size === 'small' ? 'short' : 'long',
        month: size === 'small' ? 'short' : 'long',
        day: 'numeric',
      }),
    [tz, size]
  );

  const p = zonedParts(now, tz);
  const hour = format24h ? pad(p.hour) : String(p.hour % 12 || 12);
  const period = p.hour < 12 ? 'AM' : 'PM';
  const zulu = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}Z`;
  const dateLine = [city, showDate ? dateFormatter.format(now) : null].filter(Boolean).join(' · ');

  const classes = [
    'dclock',
    `dclock-${size}`,
    format24h ? '' : 'h12',
    showSeconds ? 'with-seconds' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ModuleFrame className={classes}>
      <div
        className="dclock-time"
        aria-label={`${hour}:${pad(p.minute)}${format24h ? '' : ` ${period}`}`}
      >
        <span>
          {hour}
          <span className="dclock-colon">:</span>
          {pad(p.minute)}
        </span>
        {showSeconds && <span className="dclock-seconds">:{pad(p.second)}</span>}
        {!format24h && <span className="dclock-period">{period}</span>}
      </div>
      {(dateLine || showZulu) && (
        <div className="dclock-meta">
          {dateLine && <div className="dclock-date">{dateLine}</div>}
          {showZulu && <div className="dclock-zulu">{zulu}</div>}
        </div>
      )}
    </ModuleFrame>
  );
}
