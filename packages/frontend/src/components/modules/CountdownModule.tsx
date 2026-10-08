/**
 * Countdown Module
 * Countdown to a specific date
 */

import { useState, useEffect } from 'react';
import { ModuleProps } from './index';

interface CountdownConfig {
  targetDate?: string;
  label?: string;
}

export function CountdownModule({ config }: ModuleProps) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const countdownConfig = config as CountdownConfig;
  const targetDate = countdownConfig.targetDate ? new Date(countdownConfig.targetDate) : new Date();
  const label = countdownConfig.label || 'Days until event';

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const diff = targetDate.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
      });
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [targetDate.getTime()]);

  return (
    <div className="countdown-module">
      <div className="countdown-label">{label}</div>
      <div className="countdown-display">
        <div className="countdown-unit">
          <span className="countdown-value">{timeLeft.days}</span>
          <span className="countdown-unit-label">days</span>
        </div>
        <div className="countdown-unit">
          <span className="countdown-value">{timeLeft.hours.toString().padStart(2, '0')}</span>
          <span className="countdown-unit-label">hrs</span>
        </div>
        <div className="countdown-unit">
          <span className="countdown-value">{timeLeft.minutes.toString().padStart(2, '0')}</span>
          <span className="countdown-unit-label">min</span>
        </div>
      </div>

      <style>{`
        .countdown-module {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
        }

        .countdown-label {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.75rem;
        }

        .countdown-display {
          display: flex;
          gap: 1rem;
        }

        .countdown-unit {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: rgba(255, 255, 255, 0.05);
          padding: 0.5rem 0.75rem;
          border-radius: 8px;
        }

        .countdown-value {
          font-size: 2rem;
          font-weight: 600;
          font-family: var(--font-mono);
        }

        .countdown-unit-label {
          font-size: 0.7rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}
