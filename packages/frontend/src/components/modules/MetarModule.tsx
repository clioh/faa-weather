/**
 * METAR Module
 * Displays current weather conditions at an airport
 */

import { useEffect, useState } from 'react';
import { ModuleProps } from './index';

interface MetarData {
  raw: string;
  flightRules: string;
  parsed?: {
    temp?: number;
    dewpoint?: number;
    wind?: string;
    visibility?: string;
    altimeter?: string;
    clouds?: string;
  };
}

interface MetarConfig {
  icao?: string;
  showRaw?: boolean;
  showDecoded?: boolean;
}

export function MetarModule({ config, airport }: ModuleProps) {
  const [metar, setMetar] = useState<MetarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const metarConfig = config as MetarConfig;
  const icao = metarConfig.icao || airport || 'KJFK';

  useEffect(() => {
    const fetchMetar = async () => {
      try {
        const response = await fetch(`/api/aviation/metar/${icao}`);
        if (!response.ok) throw new Error('Failed to fetch METAR');
        const data = await response.json();
        setMetar(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchMetar();
    const interval = setInterval(fetchMetar, 5 * 60 * 1000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, [icao]);

  if (loading) {
    return <div className="module-loading">Loading METAR...</div>;
  }

  if (error) {
    return <div className="module-error">{error}</div>;
  }

  if (!metar) {
    return <div className="module-error">No METAR data</div>;
  }

  return (
    <div className="metar-module">
      <div className="metar-header">
        <span className="metar-icao">{icao}</span>
        <span className={`flight-rules ${metar.flightRules?.toLowerCase()}`}>
          {metar.flightRules}
        </span>
      </div>

      {metarConfig.showDecoded !== false && metar.parsed && (
        <div className="metar-decoded">
          {metar.parsed.temp !== undefined && (
            <div className="metar-item">
              <span className="label">Temp</span>
              <span className="value">{metar.parsed.temp}°C</span>
            </div>
          )}
          {metar.parsed.wind && (
            <div className="metar-item">
              <span className="label">Wind</span>
              <span className="value">{metar.parsed.wind}</span>
            </div>
          )}
          {metar.parsed.visibility && (
            <div className="metar-item">
              <span className="label">Vis</span>
              <span className="value">{metar.parsed.visibility}</span>
            </div>
          )}
          {metar.parsed.altimeter && (
            <div className="metar-item">
              <span className="label">Alt</span>
              <span className="value">{metar.parsed.altimeter}</span>
            </div>
          )}
        </div>
      )}

      {(metarConfig.showRaw || !metarConfig.showDecoded) && (
        <div className="metar-raw">{metar.raw}</div>
      )}

      <style>{`
        .metar-module {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .metar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.75rem;
        }

        .metar-icao {
          font-size: 1.5rem;
          font-weight: 600;
          font-family: var(--font-mono);
        }

        .flight-rules {
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.875rem;
          text-transform: uppercase;
        }

        .flight-rules.vfr { background: var(--color-vfr); color: #000; }
        .flight-rules.mvfr { background: var(--color-mvfr); color: #fff; }
        .flight-rules.ifr { background: var(--color-ifr); color: #fff; }
        .flight-rules.lifr { background: var(--color-lifr); color: #fff; }

        .metar-decoded {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .metar-item {
          display: flex;
          flex-direction: column;
        }

        .metar-item .label {
          font-size: 0.7rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .metar-item .value {
          font-size: 1rem;
          font-family: var(--font-mono);
        }

        .metar-raw {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: var(--color-text-dim);
          word-break: break-all;
          line-height: 1.4;
          margin-top: auto;
        }
      `}</style>
    </div>
  );
}
