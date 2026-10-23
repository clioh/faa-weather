/**
 * TAF — the forecast as a flight-rules timeline.
 *
 * A bar of prevailing periods (BASE/FM) coloured by flight rules, a thinner
 * lane beneath for TEMPO / PROB / BECMG, Zulu hour ticks, then the periods.
 *
 * medium / wide: bar + the period in effect now
 * large / full: bar + period list (two columns on full), raw TAF when showRaw
 */

import { ModuleProps, resolveAirport } from './index';
import {
  Age,
  ModuleEmpty,
  ModuleError,
  ModuleFrame,
  ModuleLoading,
  flightRulesClass,
} from './ModuleFrame';
import { useModuleData } from './useModuleData';
import {
  Wind,
  fetchErrorHint,
  formatTafRange,
  formatVisibility,
  formatWind,
  parseDayTime,
  useNow,
} from './aviationFormat';
import './TafModule.css';

interface TafPeriod {
  type: 'BASE' | 'FM' | 'TEMPO' | 'BECMG' | 'PROB';
  probability?: number;
  startTime: string; // DDHH or DDHHmm, UTC
  endTime: string;
  wind: Wind | null;
  visibility: number | null;
  weather: string[];
  ceiling?: number | null;
  flightRules?: string | null;
}

interface TafResponse {
  icao: string;
  raw: string;
  parsed?: { issueTime?: string; periods?: TafPeriod[] };
  fetchedAt?: string;
}

interface Segment {
  period: TafPeriod;
  start: number;
  end: number;
  overlay: boolean;
}

const HOUR = 3_600_000;

/** Resolve periods to absolute times; prevailing ones end where the next begins. */
function buildSegments(periods: TafPeriod[], reference: Date): Segment[] {
  const resolved = periods
    .map((period) => {
      const start = parseDayTime(period.startTime, reference)?.getTime();
      const end = parseDayTime(period.endTime, reference)?.getTime();
      if (start === undefined || end === undefined) return null;
      // A validity crossing month end ("3018/0118") resolves end before start.
      const fixedEnd = end <= start ? end + 30 * 24 * HOUR : end;
      return {
        period,
        start,
        end: fixedEnd,
        overlay: period.type !== 'BASE' && period.type !== 'FM',
      };
    })
    .filter((s): s is Segment => s !== null);

  const prevailing = resolved.filter((s) => !s.overlay).sort((a, b) => a.start - b.start);
  prevailing.forEach((s, i) => {
    const next = prevailing[i + 1];
    if (next && next.start < s.end) s.end = next.start;
  });
  const overlays = resolved.filter((s) => s.overlay).sort((a, b) => a.start - b.start);
  return [...prevailing, ...overlays];
}

function periodLabel(p: TafPeriod): string {
  if (p.type === 'PROB') return `PROB${p.probability ?? ''}`;
  return p.type === 'BASE' ? '' : p.type;
}

export function TafModule({ config, airport, size }: ModuleProps) {
  const icao = resolveAirport(config, airport);
  const hoursAhead = Math.min(30, Math.max(6, Number(config.hoursAhead) || 24));
  const showRaw = config.showRaw === true;
  const now = useNow(60_000);
  const { data, loading, error, isStale, lastUpdated } = useModuleData<TafResponse>(
    icao ? `/api/aviation/taf/${encodeURIComponent(icao)}` : null,
    { refreshMs: 15 * 60_000 }
  );

  let body;
  if (!icao) {
    body = <ModuleEmpty title="No airport set" hint="Choose an airport in the app" />;
  } else if (loading) {
    body = <ModuleLoading />;
  } else if (!data) {
    body = (
      <ModuleError title="TAF unavailable" hint={fetchErrorHint(error, `${icao} has no TAF`)} />
    );
  } else {
    const issued = data.parsed?.issueTime
      ? parseDayTime(data.parsed.issueTime, new Date(now))
      : null;
    const segments = buildSegments(data.parsed?.periods ?? [], issued ?? new Date(now));
    const windowStart = Math.floor(now / HOUR) * HOUR;
    const windowEnd = windowStart + hoursAhead * HOUR;
    const visible = segments.filter((s) => s.end > windowStart && s.start < windowEnd);

    if (visible.length === 0) {
      body = (
        <ModuleEmpty
          title="No forecast periods"
          hint={`${icao} TAF does not cover the next ${hoursAhead}h`}
        />
      );
    } else {
      const compact = size === 'medium' || size === 'wide';
      const current =
        visible.find((s) => !s.overlay && s.start <= now && s.end > now) ?? visible[0];
      const listCap = size === 'full' ? 8 : 5;
      const list = compact
        ? [current]
        : [...visible]
            .sort((a, b) => a.start - b.start || Number(a.overlay) - Number(b.overlay))
            .slice(0, listCap);

      body = (
        <div className="taf-body">
          <Timeline segments={visible} start={windowStart} end={windowEnd} hours={hoursAhead} />
          <div className={`taf-list${size === 'full' ? ' taf-list-cols' : ''}`}>
            {list.map((s, i) => (
              <PeriodRow key={i} segment={s} now={now} />
            ))}
          </div>
          {showRaw && !compact && data.raw && <p className="taf-raw mono">{data.raw}</p>}
        </div>
      );
    }
  }

  return (
    <ModuleFrame
      title="TAF"
      accent={icao ?? undefined}
      meta={data ? <Age at={lastUpdated} stale={isStale} /> : undefined}
      className={`taf taf-${size}`}
    >
      {body}
    </ModuleFrame>
  );
}

function Timeline({
  segments,
  start,
  end,
  hours,
}: {
  segments: Segment[];
  start: number;
  end: number;
  hours: number;
}) {
  const span = end - start;
  const pct = (t: number) => ((Math.min(end, Math.max(start, t)) - start) / span) * 100;
  const step = hours <= 12 ? 3 : 6;
  const ticks: number[] = [];
  for (let t = start; t <= end; t += HOUR) {
    if (new Date(t).getUTCHours() % step === 0) ticks.push(t);
  }
  const hasOverlay = segments.some((s) => s.overlay);

  const lane = (overlay: boolean) =>
    segments
      .filter((s) => s.overlay === overlay)
      .map((s, i) => (
        <span
          key={i}
          className={`taf-seg ${(s.period.flightRules || 'unk').toLowerCase()}`}
          style={{ left: `${pct(s.start)}%`, width: `${pct(s.end) - pct(s.start)}%` }}
        />
      ));

  return (
    <div className="taf-timeline" aria-hidden="true">
      <div className="taf-lane taf-lane-main">{lane(false)}</div>
      {hasOverlay && <div className="taf-lane taf-lane-overlay">{lane(true)}</div>}
      <div className="taf-ticks mono">
        {ticks.map((t) => {
          const left = pct(t);
          const edge = left < 4 ? ' start' : left > 96 ? ' end' : '';
          return (
            <span key={t} className={`taf-tick${edge}`} style={{ left: `${left}%` }}>
              {String(new Date(t).getUTCHours()).padStart(2, '0')}Z
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PeriodRow({ segment, now }: { segment: Segment; now: number }) {
  const p = segment.period;
  const active = segment.start <= now && segment.end > now;
  const vis = formatVisibility(p.visibility, 6);
  return (
    <div className={`taf-row${segment.overlay ? ' overlay' : ''}${active ? ' active' : ''}`}>
      <span className="taf-row-time mono">
        {formatTafRange(new Date(segment.start), new Date(segment.end))}
      </span>
      <span className="taf-row-type">{periodLabel(p)}</span>
      <span className={`taf-row-rules ${flightRulesClass(p.flightRules)}`}>
        {p.flightRules ?? '—'}
      </span>
      <span className="taf-row-data mono">
        {formatWind(p.wind)}
        {vis && ` · ${vis}`}
        {p.weather?.length > 0 && ` · ${p.weather.join(' ')}`}
      </span>
    </div>
  );
}
