/**
 * Flight Rules — one big VFR / MVFR / IFR / LIFR word in its colour.
 *
 * small: ICAO label, hero rules, ceiling and visibility (showDetails)
 * medium: adds wind
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
  MetarResponse,
  fetchErrorHint,
  formatCeiling,
  formatVisibility,
  formatWind,
} from './aviationFormat';
import './FlightRulesModule.css';

export function FlightRulesModule({ config, airport, size }: ModuleProps) {
  const icao = resolveAirport(config, airport);
  const showDetails = config.showDetails !== false;
  const { data, loading, error, isStale, lastUpdated } = useModuleData<MetarResponse>(
    icao ? `/api/aviation/metar/${encodeURIComponent(icao)}` : null,
    { refreshMs: 5 * 60_000 }
  );

  const p = data?.parsed;
  const rules = data?.flightRules ?? null;

  return (
    <ModuleFrame
      title={icao ?? 'Flight rules'}
      meta={data ? <Age at={lastUpdated} stale={isStale} /> : undefined}
      className={`fr fr-${size}`}
    >
      {!icao ? (
        <ModuleEmpty title="No airport set" hint="Choose an airport in the app" />
      ) : loading ? (
        <ModuleLoading />
      ) : !data ? (
        <ModuleError title="No report" hint={fetchErrorHint(error, `No METAR for ${icao}`)} />
      ) : (
        <div className="fr-body">
          <span className={`fr-hero ${flightRulesClass(rules)}`}>{rules ?? '—'}</span>
          {showDetails && (
            <div className="fr-details mono">
              <span>
                <span className="fr-label">CIG</span> {formatCeiling(p?.clouds, p?.ceiling)}
              </span>
              <span>
                <span className="fr-label">VIS</span> {formatVisibility(p?.visibility) ?? '—'}
              </span>
              {size !== 'small' && (
                <span>
                  <span className="fr-label">WND</span> {formatWind(p?.wind)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </ModuleFrame>
  );
}
