/**
 * TAF Module
 * Terminal Aerodrome Forecast display
 */

import { useEffect, useState } from 'react';
import { ModuleProps } from './index';

interface TafPeriod {
  type: string;
  from: string;
  to: string;
  flightRules?: string;
  wind?: string;
  visibility?: string;
  weather?: string;
  clouds?: string;
}

interface TafData {
  raw: string;
  parsed?: {
    periods?: TafPeriod[];
  };
}

interface TafConfig {
  icao?: string;
  hoursAhead?: number;
}

export function TafModule({ config, airport, size }: ModuleProps) {
  const [taf, setTaf] = useState<TafData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tafConfig = config as TafConfig;
  const icao = tafConfig.icao || airport || 'KJFK';

  useEffect(() => {
    const fetchTaf = async () => {
      try {
        const response = await fetch(`/api/aviation/taf/${icao}`);
        if (!response.ok) throw new Error('Failed to fetch TAF');
        const data = await response.json();
        setTaf(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchTaf();
    const interval = setInterval(fetchTaf, 30 * 60 * 1000); // Refresh every 30 minutes
    return () => clearInterval(interval);
  }, [icao]);

  if (loading) {
    return <div className="module-loading">Loading TAF...</div>;
  }

  if (error) {
    return <div className="module-error">{error}</div>;
  }

  const isCompact = size === 'small' || size === 'wide';

  return (
    <div className="taf-module">
      <div className="taf-header">
        <span className="taf-icao">{icao} TAF</span>
      </div>

      {taf?.parsed?.periods && taf.parsed.periods.length > 0 ? (
        <div className={`taf-periods ${isCompact ? 'compact' : ''}`}>
          {taf.parsed.periods.slice(0, isCompact ? 3 : 6).map((period, index) => (
            <div key={index} className="taf-period">
              <div className="period-time">
                <span className="period-type">{period.type}</span>
                <span className="period-range">{period.from} - {period.to}Z</span>
              </div>
              {period.flightRules && (
                <span className={`period-fr ${period.flightRules.toLowerCase()}`}>
                  {period.flightRules}
                </span>
              )}
              <div className="period-details">
                {period.wind && <span>{period.wind}</span>}
                {period.visibility && <span>{period.visibility}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="taf-raw">{taf?.raw || 'No TAF data'}</div>
      )}

      <style>{`
        .taf-module {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .taf-header {
          margin-bottom: 0.75rem;
          flex-shrink: 0;
        }

        .taf-icao {
          font-size: 1.25rem;
          font-weight: 600;
          font-family: var(--font-mono);
        }

        .taf-periods {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          overflow-y: auto;
          flex: 1;
        }

        .taf-periods.compact {
          flex-direction: row;
          overflow-x: auto;
          gap: 1rem;
        }

        .taf-period {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          flex-shrink: 0;
        }

        .taf-periods.compact .taf-period {
          min-width: 120px;
        }

        .period-time {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
        }

        .period-type {
          font-size: 0.7rem;
          color: var(--color-accent);
          text-transform: uppercase;
          font-weight: 600;
        }

        .period-range {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
        }

        .period-fr {
          display: inline-block;
          padding: 0.125rem 0.5rem;
          border-radius: 3px;
          font-size: 0.7rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
        }

        .period-fr.vfr { background: var(--color-vfr); color: #000; }
        .period-fr.mvfr { background: var(--color-mvfr); color: #fff; }
        .period-fr.ifr { background: var(--color-ifr); color: #fff; }
        .period-fr.lifr { background: var(--color-lifr); color: #fff; }

        .period-details {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .taf-raw {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: var(--color-text-dim);
          word-break: break-all;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
