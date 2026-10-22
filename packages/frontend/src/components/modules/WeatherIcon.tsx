/**
 * WeatherIcon — stroked line icons keyed by Open-Meteo (WMO) weather code.
 * Drawn in currentColor so the parent decides the tone; size with font-size
 * or width/height on .wx-icon.
 */

import './WeatherIcon.css';

type Kind =
  | 'clear'
  | 'partly'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'freezing'
  | 'snow'
  | 'thunder';

function weatherKind(code: number): Kind {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'freezing';
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}

const CLOUD = 'M13 34H35A7 7 0 0 0 35 20A10 10 0 0 0 16 18A8 8 0 0 0 13 34Z';
const MOON = 'M28 10A14 14 0 1 0 38 30A11 11 0 0 1 28 10Z';

function Sun({ cx = 24, cy = 24, r = 7, ray = 5 }: { cx?: number; cy?: number; r?: number; ray?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 3);
    const y1 = cy + Math.sin(a) * (r + 3);
    const x2 = cx + Math.cos(a) * (r + 3 + ray);
    const y2 = cy + Math.sin(a) * (r + 3 + ray);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} />
      {rays}
    </g>
  );
}

/** Sun or moon peeking from behind a cloud's upper left. */
function Celestial({ isDay }: { isDay: boolean }) {
  return isDay ? (
    <Sun cx={17} cy={16} r={5} ray={3} />
  ) : (
    <path d={MOON} transform="translate(-6 -6) scale(0.62)" />
  );
}

/** Cloud raised to leave room for precipitation below it. */
const RaisedCloud = () => <path d={CLOUD} transform="translate(0 -5)" />;

function Glyph({ kind, isDay }: { kind: Kind; isDay: boolean }) {
  switch (kind) {
    case 'clear':
      return isDay ? <Sun /> : <path d={MOON} />;
    case 'partly':
      return (
        <>
          <Celestial isDay={isDay} />
          {/* Black under-fill hides the sun behind the cloud on the mirror. */}
          <path d={CLOUD} transform="translate(4 6) scale(0.86)" className="wx-mask" />
        </>
      );
    case 'cloud':
      return <path d={CLOUD} />;
    case 'fog':
      return (
        <>
          <path d={CLOUD} transform="translate(0 -6)" />
          <line x1="10" y1="35" x2="38" y2="35" />
          <line x1="14" y1="41" x2="34" y2="41" />
        </>
      );
    case 'drizzle':
      return (
        <>
          <RaisedCloud />
          {[16, 24, 32].map((x) => (
            <line key={x} x1={x} y1="35" x2={x - 1} y2="38" />
          ))}
          {[20, 28].map((x) => (
            <line key={x} x1={x} y1="41" x2={x - 1} y2="44" />
          ))}
        </>
      );
    case 'rain':
      return (
        <>
          <RaisedCloud />
          {[16, 24, 32].map((x) => (
            <line key={x} x1={x} y1="35" x2={x - 3} y2="43" />
          ))}
        </>
      );
    case 'freezing':
      return (
        <>
          <RaisedCloud />
          <line x1="17" y1="35" x2="14" y2="43" />
          <line x1="31" y1="35" x2="28" y2="43" />
          <circle cx="23" cy="40" r="1.4" className="wx-dot" />
        </>
      );
    case 'snow':
      return (
        <>
          <RaisedCloud />
          {[
            [16, 37],
            [24, 41],
            [32, 37],
          ].map(([x, y]) => (
            <g key={x}>
              <line x1={x - 2.5} y1={y} x2={x + 2.5} y2={y} />
              <line x1={x - 1.3} y1={y - 2.2} x2={x + 1.3} y2={y + 2.2} />
              <line x1={x + 1.3} y1={y - 2.2} x2={x - 1.3} y2={y + 2.2} />
            </g>
          ))}
        </>
      );
    case 'thunder':
      return (
        <>
          <RaisedCloud />
          <path d="M26 32L20 40H26L22 46" />
        </>
      );
  }
}

interface WeatherIconProps {
  code: number;
  isDay?: boolean;
  className?: string;
  title?: string;
}

export function WeatherIcon({ code, isDay = true, className, title }: WeatherIconProps) {
  const kind = weatherKind(code);
  return (
    <svg
      className={['wx-icon', `wx-${kind}`, className ?? ''].join(' ').trim()}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <Glyph kind={kind} isDay={isDay} />
    </svg>
  );
}
