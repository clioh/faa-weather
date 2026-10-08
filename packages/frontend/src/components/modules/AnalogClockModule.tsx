/**
 * Analog Clock Module
 * Classic analog clock face
 */

import { useState, useEffect } from 'react';
import { ModuleProps } from './index';

interface AnalogClockConfig {
  timezone?: string;
  style?: 'modern' | 'classic' | 'minimal';
}

export function AnalogClockModule({ config }: ModuleProps) {
  const [time, setTime] = useState(new Date());
  const clockConfig = config as AnalogClockConfig;
  const style = clockConfig.style || 'modern';

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();

  const hourDeg = (hours * 30) + (minutes * 0.5);
  const minuteDeg = minutes * 6;
  const secondDeg = seconds * 6;

  return (
    <div className={`analog-clock-module style-${style}`}>
      <svg viewBox="0 0 100 100" className="clock-face">
        {/* Clock face */}
        <circle cx="50" cy="50" r="48" className="clock-circle" />

        {/* Hour markers */}
        {[...Array(12)].map((_, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180);
          const x1 = 50 + 40 * Math.cos(angle);
          const y1 = 50 + 40 * Math.sin(angle);
          const x2 = 50 + 45 * Math.cos(angle);
          const y2 = 50 + 45 * Math.sin(angle);
          return (
            <line
              key={i}
              x1={x1} y1={y1}
              x2={x2} y2={y2}
              className="hour-marker"
            />
          );
        })}

        {/* Hour hand */}
        <line
          x1="50" y1="50"
          x2="50" y2="25"
          className="hand hour-hand"
          transform={`rotate(${hourDeg}, 50, 50)`}
        />

        {/* Minute hand */}
        <line
          x1="50" y1="50"
          x2="50" y2="15"
          className="hand minute-hand"
          transform={`rotate(${minuteDeg}, 50, 50)`}
        />

        {/* Second hand */}
        <line
          x1="50" y1="55"
          x2="50" y2="12"
          className="hand second-hand"
          transform={`rotate(${secondDeg}, 50, 50)`}
        />

        {/* Center dot */}
        <circle cx="50" cy="50" r="2" className="center-dot" />
      </svg>

      <style>{`
        .analog-clock-module {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
        }

        .clock-face {
          width: 100%;
          height: 100%;
          max-width: 200px;
          max-height: 200px;
        }

        .clock-circle {
          fill: transparent;
          stroke: rgba(255, 255, 255, 0.2);
          stroke-width: 1;
        }

        .hour-marker {
          stroke: rgba(255, 255, 255, 0.5);
          stroke-width: 2;
          stroke-linecap: round;
        }

        .hand {
          stroke-linecap: round;
        }

        .hour-hand {
          stroke: var(--color-text);
          stroke-width: 3;
        }

        .minute-hand {
          stroke: var(--color-text);
          stroke-width: 2;
        }

        .second-hand {
          stroke: var(--color-accent);
          stroke-width: 1;
        }

        .center-dot {
          fill: var(--color-accent);
        }

        /* Style variations */
        .style-minimal .clock-circle {
          stroke: transparent;
        }

        .style-minimal .hour-marker {
          stroke: rgba(255, 255, 255, 0.3);
          stroke-width: 1;
        }

        .style-classic .clock-circle {
          stroke: var(--color-text-dim);
          stroke-width: 2;
        }
      `}</style>
    </div>
  );
}
