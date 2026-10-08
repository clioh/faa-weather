import { useEffect } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { WidgetStatus } from '../WidgetStatus';

interface MetarData {
  raw: string;
  flightRules: 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
  parsed: {
    wind: {
      direction: number | null;
      speed: number;
      gust: number | null;
    } | null;
    visibility: number | null;
    ceiling: number | null;
    temperature: number | null;
    dewpoint: number | null;
    altimeter: number | null;
  };
  formatted: {
    wind: string;
    visibility: string;
    clouds: string;
    temperature: string;
    dewpoint: string;
    altimeter: string;
  };
}

interface TafPeriod {
  type: string;
  flightRules: 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
  raw: string;
}

interface TafData {
  raw: string;
  currentPeriod: TafPeriod | null;
}

interface AviationWidgetProps {
  position: string;
  airport: string;
}

export function AviationWidget({ position, airport }: AviationWidgetProps) {
  // Fetch METAR with retry and auto-refresh
  const {
    data: metar,
    loading: metarLoading,
    refreshing: metarRefreshing,
    error: metarError,
    isStale: metarStale,
    lastUpdated: metarUpdated,
    retryCount: metarRetryCount,
    retry: retryMetar,
  } = useFetch<MetarData>(`/api/aviation/metar/${airport}`, {
    refreshInterval: 5 * 60 * 1000, // 5 minutes
    maxRetries: 3,
    keepStaleData: true,
  });

  // Fetch TAF with retry and auto-refresh
  const {
    data: taf,
    loading: tafLoading,
    error: tafError,
    retry: retryTaf,
  } = useFetch<TafData>(`/api/aviation/taf/${airport}`, {
    refreshInterval: 30 * 60 * 1000, // 30 minutes
    maxRetries: 3,
    keepStaleData: true,
  });

  // Combined loading state
  const loading = metarLoading && tafLoading;
  const error = metarError && tafError ? 'Failed to fetch aviation data' : null;
  const isStale = metarStale || (tafError !== null && taf !== null);

  // Listen for WebSocket updates
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001`);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        // WebSocket updates are handled by the useFetch refresh
        // This is just for real-time push updates from the server
        if (message.type === 'metar' && message.data.icao === airport) {
          // Force refresh to get latest data
          retryMetar();
        }
        if (message.type === 'taf' && message.data.icao === airport) {
          retryTaf();
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    return () => ws.close();
  }, [airport, retryMetar, retryTaf]);

  const getFlightRulesClass = (rules: string) => {
    return rules.toLowerCase();
  };

  const handleRetry = () => {
    retryMetar();
    retryTaf();
  };

  return (
    <div className="widget aviation-widget" data-position={position}>
      <div className="widget-content">
        <WidgetStatus
          loading={loading}
          refreshing={metarRefreshing}
          error={error}
          isStale={isStale}
          lastUpdated={metarUpdated}
          retryCount={metarRetryCount}
          onRetry={handleRetry}
          loadingText="Loading aviation data..."
        >
          <div className="aviation-header">
            <h2>{airport}</h2>
            {metar && (
              <span className={`flight-rules ${getFlightRulesClass(metar.flightRules)}`}>
                {metar.flightRules}
              </span>
            )}
          </div>

          {metar && (
            <div className="metar-section">
              <div className="metar-details">
                <div className="metar-item">
                  <span className="label">Wind</span>
                  <span className="value">{metar.formatted.wind}</span>
                </div>
                <div className="metar-item">
                  <span className="label">Visibility</span>
                  <span className="value">{metar.formatted.visibility}</span>
                </div>
                <div className="metar-item">
                  <span className="label">Ceiling</span>
                  <span className="value">
                    {metar.parsed.ceiling ? `${metar.parsed.ceiling.toLocaleString()}ft` : 'CLR'}
                  </span>
                </div>
                <div className="metar-item">
                  <span className="label">Altimeter</span>
                  <span className="value">{metar.formatted.altimeter}</span>
                </div>
              </div>
              <div className="metar-raw">{metar.raw}</div>
            </div>
          )}

          {!metar && !loading && (
            <div className="no-data">No METAR data available</div>
          )}

          {taf && taf.currentPeriod && (
            <div className="taf-section">
              <div className="taf-header">
                <span className="label">TAF</span>
                <span className={`flight-rules small ${getFlightRulesClass(taf.currentPeriod.flightRules)}`}>
                  {taf.currentPeriod.flightRules}
                </span>
              </div>
              <div className="taf-period">{taf.currentPeriod.raw}</div>
            </div>
          )}
        </WidgetStatus>
      </div>

      <style>{`
        .aviation-widget .aviation-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .aviation-widget h2 {
          margin: 0;
          font-size: 2rem;
          font-weight: 300;
        }

        .aviation-widget .metar-details {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .aviation-widget .metar-item {
          display: flex;
          flex-direction: column;
        }

        .aviation-widget .metar-item .label {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .aviation-widget .metar-item .value {
          font-size: 1.1rem;
          font-weight: 400;
        }

        .aviation-widget .metar-raw {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: var(--color-text-dim);
          word-break: break-all;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          margin-top: 0.5rem;
        }

        .aviation-widget .taf-section {
          margin-top: 1.5rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .aviation-widget .taf-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .aviation-widget .taf-header .label {
          font-size: 0.875rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .aviation-widget .taf-period {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: var(--color-text-dim);
        }

        .aviation-widget .flight-rules.small {
          font-size: 0.75rem;
          padding: 0.125rem 0.5rem;
        }

        .aviation-widget .no-data {
          color: var(--color-text-dim);
          font-style: italic;
          padding: 1rem 0;
        }
      `}</style>
    </div>
  );
}
