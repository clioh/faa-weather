/**
 * Digital Clock Module
 * Displays time with optional date and Zulu time
 */

import { useState, useEffect } from 'react';
import { ModuleProps } from './index';

interface ClockConfig {
  timezone?: string;
  format24h?: boolean;
  showSeconds?: boolean;
  showDate?: boolean;
}

export function DigitalClockModule({ config, size }: ModuleProps) {
  const [time, setTime] = useState(new Date());
  const clockConfig = config as ClockConfig;

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timezone = clockConfig.timezone === 'local' ? undefined : clockConfig.timezone;

  const formatTime = (date: Date, tz?: string, format24h = false) => {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: clockConfig.showSeconds ? '2-digit' : undefined,
      hour12: !format24h,
      timeZone: tz,
    };
    return date.toLocaleTimeString('en-US', options);
  };

  const formatDate = (date: Date, tz?: string) => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: tz,
    };
    return date.toLocaleDateString('en-US', options);
  };

  const formatZulu = (date: Date) => {
    return date.toISOString().slice(11, 19) + 'Z';
  };

  const isCompact = size === 'small';

  return (
    <div className="digital-clock-module">
      <div className={`clock-time ${isCompact ? 'compact' : ''}`}>
        {formatTime(time, timezone, clockConfig.format24h)}
      </div>

      {clockConfig.showDate !== false && (
        <div className="clock-date">{formatDate(time, timezone)}</div>
      )}

      <div className="clock-zulu">{formatZulu(time)}</div>

      <style>{`
        .digital-clock-module {
          display: flex;
          flex-direction: column;
          justify-content: center;
          height: 100%;
        }

        .clock-time {
          font-size: 3.5rem;
          font-weight: 200;
          letter-spacing: -0.02em;
          line-height: 1;
        }

        .clock-time.compact {
          font-size: 2.5rem;
        }

        .clock-date {
          font-size: 1rem;
          color: var(--color-text-dim);
          margin-top: 0.5rem;
        }

        .clock-zulu {
          font-size: 1.25rem;
          color: var(--color-accent);
          font-family: var(--font-mono);
          margin-top: 0.5rem;
        }
      `}</style>
    </div>
  );
}
