/**
 * METAR — current observation at an airport.
 *
 * small: flight-rules pill, wind and visibility on one line
 * medium: pill (+ altimeter), then wind / vis / ceiling / temp in a 2x2 grid
 * wide: pill beside a single row of metrics
 * large: all metrics, present weather, raw report at the bottom (showRaw)
 */

import { ModuleProps, resolveAirport } from './index';
import {
  Age,
  FlightRulesPill,
  Metric,
  ModuleEmpty,
  ModuleError,
  ModuleFrame,
  ModuleLoading,
} from './ModuleFrame';
import { useModuleData } from './useModuleData';
import {
  MetarResponse,
  fetchErrorHint,
  formatAltimeter,
  formatCeiling,
  formatSigned,
  formatVisibility,
  formatVisibilityValue,
  formatWind,
  parseDayTime,
  windParts,
} from './aviationFormat';
import './MetarModule.css';

// METARs are hourly; older than this one has probably been missed.
const STALE_OBS_MS = 90 * 60_000;

export function MetarModule({ config, airport, size }: ModuleProps) {
  const icao = resolveAirport(config, airport);
  const showRaw = config.showRaw !== false;
  const { data, loading, error, isStale, lastUpdated } = useModuleData<MetarResponse>(
    icao ? `/api/aviation/metar/${encodeURIComponent(icao)}` : null,
    { refreshMs: 5 * 60_000 }
  );

  const observed = data?.parsed?.observationTime
    ? parseDayTime(data.parsed.observationTime)?.getTime() ?? null
    : null;
  const ageAt = observed ?? lastUpdated;
  const stale = isStale || (observed !== null && Date.now() - observed > STALE_OBS_MS);

  return (
    <ModuleFrame
      title="METAR"
      accent={icao ?? undefined}
      meta={data ? <Age at={ageAt} stale={stale} /> : undefined}
      className={`metar metar-${size}`}
    >
      {!icao ? (
        <ModuleEmpty title="No airport set" hint="Choose an airport in the app" />
      ) : loading ? (
        <ModuleLoading />
      ) : !data ? (
        <ModuleError title="METAR unavailable" hint={fetchErrorHint(error, `No report for ${icao}`)} />
      ) : (
        <MetarBody data={data} size={size} showRaw={showRaw} />
      )}
    </ModuleFrame>
  );
}

function MetarBody({
  data,
  size,
  showRaw,
}: {
  data: MetarResponse;
  size: ModuleProps['size'];
  showRaw: boolean;
}) {
  const p = data.parsed;
  const wind = windParts(p?.wind);
  const vis = formatVisibilityValue(p?.visibility);
  const ceiling = formatCeiling(p?.clouds, p?.ceiling);
  const temp =
    p && p.temperature !== null
      ? `${formatSigned(p.temperature)}°/${formatSigned(p.dewpoint)}°`
      : '—';
  const altimeter = formatAltimeter(p?.altimeter);
  const weather = p?.weather?.join(' ') ?? '';

  if (size === 'small') {
    return (
      <div className="metar-line">
        <FlightRulesPill rules={data.flightRules} />
        <span className="metar-line-text mono">
          {formatWind(p?.wind)}
          {vis && <span className="text-dim"> · {formatVisibility(p?.visibility)}</span>}
        </span>
      </div>
    );
  }

  const metrics = [
    <Metric key="wind" label="Wind" value={wind.value} unit={wind.unit || undefined} />,
    <Metric key="vis" label="Vis" value={vis ?? '—'} unit={vis ? 'SM' : undefined} />,
    <Metric key="sky" label={p?.ceiling != null ? 'Ceiling' : 'Sky'} value={ceiling} />,
    <Metric key="temp" label="Temp / Dew" value={temp} unit={p?.temperature != null ? 'C' : undefined} />,
  ];
  const altMetric = (
    <Metric key="alt" label="Altimeter" value={altimeter ?? '—'} unit={altimeter ? 'inHg' : undefined} />
  );

  if (size === 'medium') {
    return (
      <div className="metar-stack">
        <div className="metar-top">
          <FlightRulesPill rules={data.flightRules} />
          {weather && <span className="metar-wx mono">{weather}</span>}
          {altimeter && (
            <span className="metar-alt mono">
              A{altimeter}
            </span>
          )}
        </div>
        <div className="metar-grid">{metrics}</div>
      </div>
    );
  }

  if (size === 'wide') {
    return (
      <div className="metar-wide">
        <div className="metar-wide-rules">
          <FlightRulesPill rules={data.flightRules} />
          {weather && <span className="metar-wx mono">{weather}</span>}
        </div>
        <div className="metar-row">
          {metrics}
          {altMetric}
        </div>
      </div>
    );
  }

  return (
    <div className="metar-stack">
      <div className="metar-top">
        <FlightRulesPill rules={data.flightRules} />
        {weather && <span className="metar-wx mono">{weather}</span>}
      </div>
      <div className="metar-grid metar-grid-large">
        {metrics}
        {altMetric}
      </div>
      {showRaw && data.raw && <p className="metar-raw mono">{data.raw}</p>}
    </div>
  );
}
