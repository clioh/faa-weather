/**
 * Sun & Moon — daylight arc, rise/set times, civil twilight, moon phase.
 *
 * small: arc, sunrise / sunset, countdown (moon glyph inline when enabled)
 * medium: arc and times, then a 2x2 grid (civil dawn, civil dusk, moon, next)
 * wide: arc and times on the left, the same grid on the right
 */

import { ModuleProps } from './index';
import { Metric, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { formatDuration, formatLocalTime, formatZulu, useNow } from './aviationFormat';
import './SunTimesModule.css';

interface SunEvent {
  time: string;
  local: string;
  zulu: string;
}

interface AstroResponse {
  date: string;
  sun: { sunrise: SunEvent; sunset: SunEvent; civilDawn: SunEvent; civilDusk: SunEvent };
  moon: { phase: number; phaseName: string; illumination: number };
  upcoming: { event: string; time: string; local: string; minutesUntil: number } | null;
}

export function SunTimesModule({ config, size, timezone }: ModuleProps) {
  const showTwilight = config.showTwilight !== false;
  const showMoon = config.showMoon !== false;
  const showZulu = config.showZulu === true;
  const now = useNow(60_000);
  const { data, loading } = useModuleData<AstroResponse>('/api/aviation/astro', {
    refreshMs: 30 * 60_000,
  });

  if (loading || !data) {
    return (
      <ModuleFrame title="Sun & Moon" className={`sun sun-${size}`}>
        {loading ? (
          <ModuleLoading />
        ) : (
          <ModuleError title="Sun times unavailable" hint="Retrying automatically" />
        )}
      </ModuleFrame>
    );
  }

  const { sun, moon } = data;
  const t = (e: SunEvent) => Date.parse(e.time);
  const local = (e: SunEvent) => formatLocalTime(e.time, timezone) || e.local;
  const zulu = (e: SunEvent) => formatZulu(e.time) || e.zulu;

  const upcomingMin = data.upcoming ? (Date.parse(data.upcoming.time) - now) / 60_000 : -1;
  const countdown =
    data.upcoming && upcomingMin > 0 ? (
      <p className="sun-countdown">
        {data.upcoming.event} in <span className="mono">{formatDuration(upcomingMin)}</span>
      </p>
    ) : null;

  const pair = (label: string, a: SunEvent, b: SunEvent, labelB: string, dim = false) => (
    <div className={`sun-pair${dim ? ' dim' : ''}`}>
      <TimeCell label={label} local={local(a)} zulu={showZulu ? zulu(a) : null} />
      <TimeCell label={labelB} local={local(b)} zulu={showZulu ? zulu(b) : null} align="end" />
    </div>
  );

  const arc = (
    <SunArc
      now={now}
      dawn={t(sun.civilDawn)}
      sunrise={t(sun.sunrise)}
      sunset={t(sun.sunset)}
      dusk={t(sun.civilDusk)}
    />
  );
  const times = pair('Sunrise', sun.sunrise, sun.sunset, 'Sunset');
  const nextText =
    data.upcoming && upcomingMin > 0
      ? `${data.upcoming.event} in ${formatDuration(upcomingMin)}`
      : null;
  const zuluSuffix = (e: SunEvent) => (showZulu ? ` ${zulu(e)}` : '');

  if (size === 'small') {
    return (
      <ModuleFrame className="sun sun-small">
        <div className="sun-body">
          {arc}
          {times}
          <div className="sun-small-foot">
            {countdown}
            {showMoon && (
              <span className="sun-moon-inline">
                <MoonGlyph phase={moon.phase} />
                <span className="mono">{Math.round(moon.illumination)}%</span>
              </span>
            )}
          </div>
        </div>
      </ModuleFrame>
    );
  }

  // medium and wide share the metrics grid; wide puts it beside the arc.
  const metrics = (
    <div className="mf-metrics sun-metrics">
      {showTwilight && (
        <>
          <Metric
            label="Civil dawn"
            value={`${local(sun.civilDawn)}${zuluSuffix(sun.civilDawn)}`}
          />
          <Metric
            label="Civil dusk"
            value={`${local(sun.civilDusk)}${zuluSuffix(sun.civilDusk)}`}
          />
        </>
      )}
      {showMoon && (
        <Metric
          label="Moon"
          value={
            <span className="sun-moon-value">
              <MoonGlyph phase={moon.phase} />
              <span className="sun-moon-name">{moon.phaseName}</span>
              <span className="mono text-dim">{Math.round(moon.illumination)}%</span>
            </span>
          }
        />
      )}
      {nextText && <Metric label="Next" value={nextText} />}
    </div>
  );

  return (
    <ModuleFrame title="Sun & Moon" className={`sun sun-${size}`}>
      <div className={size === 'wide' ? 'sun-wide-body' : 'sun-body'}>
        <div className="sun-main">
          {arc}
          {times}
        </div>
        {metrics}
      </div>
    </ModuleFrame>
  );
}

function TimeCell({
  label,
  local,
  zulu,
  align,
}: {
  label: string;
  local: string;
  zulu: string | null;
  align?: 'end';
}) {
  return (
    <div className={`sun-cell${align === 'end' ? ' end' : ''}`}>
      <span className="sun-cell-label">{label}</span>
      <span className="sun-cell-time mono">
        {local}
        {zulu && <span className="sun-cell-zulu"> {zulu}</span>}
      </span>
    </div>
  );
}

const W = 200;
const HORIZON = 56;
const PEAK = 8;
const PAD = 8;

/**
 * Daylight arc on a linear time axis spanning civil twilight either side.
 * Elapsed daylight is drawn brighter; the sun dot sits on the arc by day and
 * just under the horizon during twilight.
 */
function SunArc({
  now,
  dawn,
  sunrise,
  sunset,
  dusk,
}: {
  now: number;
  dawn: number;
  sunrise: number;
  sunset: number;
  dusk: number;
}) {
  if (![dawn, sunrise, sunset, dusk].every(Number.isFinite) || sunset <= sunrise) return null;
  const t0 = dawn - (sunrise - dawn);
  const t1 = dusk + (dusk - sunset);
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2);
  const y = (t: number) =>
    HORIZON - (HORIZON - PEAK) * Math.sin((Math.PI * (t - sunrise)) / (sunset - sunrise));

  const path = (from: number, to: number) => {
    const steps = 32;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      d += `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(t).toFixed(1)}`;
    }
    return d;
  };

  const isDay = now >= sunrise && now <= sunset;
  const inTwilight = !isDay && now >= dawn && now <= dusk;

  return (
    <svg
      className="sun-arc"
      viewBox={`0 0 ${W} 64`}
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      <line x1="0" y1={HORIZON} x2={W} y2={HORIZON} className="sun-horizon" />
      <path d={path(sunrise, sunset)} className="sun-track" />
      {isDay && <path d={path(sunrise, now)} className="sun-elapsed" />}
      {[dawn, dusk].map((tm) => (
        <line
          key={tm}
          x1={x(tm)}
          y1={HORIZON - 3}
          x2={x(tm)}
          y2={HORIZON + 4}
          className="sun-tick"
        />
      ))}
      {[sunrise, sunset].map((tm) => (
        <circle key={tm} cx={x(tm)} cy={HORIZON} r="1.6" className="sun-node" />
      ))}
      {isDay && <circle cx={x(now)} cy={y(now)} r="4.2" className="sun-dot" />}
      {inTwilight && <circle cx={x(now)} cy={HORIZON + 4} r="3" className="sun-dot twilight" />}
    </svg>
  );
}

/**
 * Moon drawn as the lit area: a semicircle on the lit limb closed by the
 * terminator, an ellipse whose half-width follows cos(phase). Waxing is lit
 * on the right (northern hemisphere view); waning is mirrored.
 */
function MoonGlyph({ phase }: { phase: number }) {
  const r = 10;
  const p = ((phase % 1) + 1) % 1;
  const rx = Math.abs(Math.cos(2 * Math.PI * p)) * r;
  const gibbous = p > 0.25 && p < 0.75;
  const waning = p > 0.5;
  const lit =
    p < 0.02 || p > 0.98
      ? null
      : `M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx.toFixed(2)} ${r} 0 0 ${gibbous ? 1 : 0} 0 ${-r}Z`;
  return (
    <svg className="sun-moon-glyph" viewBox="-12 -12 24 24" aria-hidden="true">
      <circle r={r} className="sun-moon-disc" />
      {lit && (
        <path d={lit} className="sun-moon-lit" transform={waning ? 'scale(-1 1)' : undefined} />
      )}
    </svg>
  );
}
