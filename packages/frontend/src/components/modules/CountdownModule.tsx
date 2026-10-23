/**
 * Countdown — days (then hours and minutes) until a date, e.g. a checkride.
 * The target is local midnight at the start of the chosen day.
 */

import { ModuleProps } from './index';
import { ModuleEmpty, ModuleFrame } from './ModuleFrame';
import { useNow } from './time';
import './CountdownModule.css';

const DAY_MS = 86_400_000;

function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  // Rejects 2026-02-31 and friends, which Date would silently roll over.
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function CountdownModule({ config, size }: ModuleProps) {
  const label = typeof config.label === 'string' ? config.label.trim() : '';
  const target = parseLocalDate(config.targetDate);
  const now = useNow(60_000);

  if (!target) {
    return (
      <ModuleFrame title={label || 'Countdown'}>
        <ModuleEmpty title="No date set" hint="Pick a date in the app" />
      </ModuleFrame>
    );
  }

  const diff = target.getTime() - now.getTime();
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  let hero;
  let sub: string | null = null;
  let passed = false;

  if (diff <= 0) {
    passed = true;
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ago = Math.round((midnight.getTime() - target.getTime()) / DAY_MS);
    hero = (
      <span className="cd-word">
        {ago === 0 ? 'Today' : `${ago} ${ago === 1 ? 'day' : 'days'} ago`}
      </span>
    );
  } else if (days >= 1) {
    hero = (
      <>
        <span className="cd-number">{days}</span>
        <span className="cd-unit">{days === 1 ? 'day' : 'days'}</span>
      </>
    );
    sub = `${hours}h ${String(minutes).padStart(2, '0')}m`;
  } else {
    hero = (
      <>
        {hours > 0 && (
          <>
            <span className="cd-number">{hours}</span>
            <span className="cd-unit">h</span>
          </>
        )}
        <span className="cd-number">{minutes}</span>
        <span className="cd-unit">m</span>
      </>
    );
  }

  return (
    <ModuleFrame className={`cd cd-${size}${passed ? ' passed' : ''}`}>
      {label && <div className="cd-label">{label}</div>}
      <div className="cd-main">
        <div className="cd-hero">{hero}</div>
        {sub && <div className="cd-sub">{sub}</div>}
      </div>
    </ModuleFrame>
  );
}
