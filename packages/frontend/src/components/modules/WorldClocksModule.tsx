/**
 * World Clocks Module
 * Multiple timezone clocks
 */

import { useState, useEffect } from 'react';
import { ModuleProps } from './index';

interface WorldClocksConfig {
  timezones?: string;
}

interface ClockZone {
  timezone: string;
  label: string;
  time: string;
}

const TIMEZONE_LABELS: Record<string, string> = {
  'America/New_York': 'New York',
  'America/Chicago': 'Chicago',
  'America/Denver': 'Denver',
  'America/Los_Angeles': 'Los Angeles',
  'Europe/London': 'London',
  'Europe/Paris': 'Paris',
  'Europe/Berlin': 'Berlin',
  'Asia/Tokyo': 'Tokyo',
  'Asia/Shanghai': 'Shanghai',
  'Asia/Dubai': 'Dubai',
  'Australia/Sydney': 'Sydney',
  'UTC': 'UTC',
};

export function WorldClocksModule({ config, size }: ModuleProps) {
  const [clocks, setClocks] = useState<ClockZone[]>([]);
  const clocksConfig = config as WorldClocksConfig;

  const timezones = (clocksConfig.timezones || 'America/New_York,Europe/London,Asia/Tokyo')
    .split(',')
    .map(tz => tz.trim());

  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      const newClocks = timezones.map(tz => ({
        timezone: tz,
        label: TIMEZONE_LABELS[tz] || tz.split('/').pop() || tz,
        time: now.toLocaleTimeString('en-US', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
      }));
      setClocks(newClocks);
    };

    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, [timezones.join(',')]);

  const isHorizontal = size === 'wide' || size === 'full';

  return (
    <div className={`world-clocks-module ${isHorizontal ? 'horizontal' : 'vertical'}`}>
      {clocks.map(clock => (
        <div key={clock.timezone} className="world-clock">
          <span className="clock-label">{clock.label}</span>
          <span className="clock-time">{clock.time}</span>
        </div>
      ))}

      <style>{`
        .world-clocks-module {
          display: flex;
          height: 100%;
          gap: 1rem;
        }

        .world-clocks-module.horizontal {
          flex-direction: row;
          justify-content: space-around;
          align-items: center;
        }

        .world-clocks-module.vertical {
          flex-direction: column;
          justify-content: space-around;
        }

        .world-clock {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.5rem 1rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
        }

        .clock-label {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.25rem;
        }

        .clock-time {
          font-size: 1.25rem;
          font-family: var(--font-mono);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
