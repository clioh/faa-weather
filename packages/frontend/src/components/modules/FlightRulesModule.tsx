/**
 * Flight Rules Module
 * Large VFR/MVFR/IFR/LIFR indicator
 */

import { useEffect, useState } from 'react';
import { ModuleProps } from './index';

interface FlightRulesConfig {
  icao?: string;
  showCeiling?: boolean;
  showVisibility?: boolean;
}

interface MetarData {
  flightRules: string;
  parsed?: {
    visibility?: string;
    clouds?: string;
    ceiling?: number;
  };
}

export function FlightRulesModule({ config, airport }: ModuleProps) {
  const [metar, setMetar] = useState<MetarData | null>(null);
  const [loading, setLoading] = useState(true);

  const frConfig = config as FlightRulesConfig;
  const icao = frConfig.icao || airport || 'KJFK';

  useEffect(() => {
    const fetchMetar = async () => {
      try {
        const response = await fetch(`/api/aviation/metar/${icao}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        setMetar(data);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    };

    fetchMetar();
    const interval = setInterval(fetchMetar, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [icao]);

  if (loading) {
    return <div className="module-loading">...</div>;
  }

  const flightRules = metar?.flightRules || 'UNK';

  return (
    <div className="flight-rules-module">
      <div className="fr-icao">{icao}</div>
      <div className={`fr-badge ${flightRules.toLowerCase()}`}>
        {flightRules}
      </div>
      {frConfig.showCeiling && metar?.parsed?.ceiling && (
        <div className="fr-detail">
          <span className="label">Ceiling</span>
          <span className="value">{metar.parsed.ceiling} ft</span>
        </div>
      )}
      {frConfig.showVisibility && metar?.parsed?.visibility && (
        <div className="fr-detail">
          <span className="label">Visibility</span>
          <span className="value">{metar.parsed.visibility}</span>
        </div>
      )}

      <style>{`
        .flight-rules-module {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
        }

        .fr-icao {
          font-size: 0.875rem;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
          margin-bottom: 0.5rem;
        }

        .fr-badge {
          font-size: 2.5rem;
          font-weight: 700;
          padding: 0.5rem 1.5rem;
          border-radius: 8px;
          letter-spacing: 0.1em;
        }

        .fr-badge.vfr {
          background: var(--color-vfr);
          color: #000;
          box-shadow: 0 0 30px rgba(0, 255, 0, 0.3);
        }

        .fr-badge.mvfr {
          background: var(--color-mvfr);
          color: #fff;
          box-shadow: 0 0 30px rgba(0, 136, 255, 0.3);
        }

        .fr-badge.ifr {
          background: var(--color-ifr);
          color: #fff;
          box-shadow: 0 0 30px rgba(255, 0, 0, 0.3);
        }

        .fr-badge.lifr {
          background: var(--color-lifr);
          color: #fff;
          box-shadow: 0 0 30px rgba(255, 0, 255, 0.3);
        }

        .fr-badge.unk {
          background: var(--color-text-dim);
          color: #000;
        }

        .fr-detail {
          display: flex;
          flex-direction: column;
          margin-top: 0.75rem;
        }

        .fr-detail .label {
          font-size: 0.7rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .fr-detail .value {
          font-size: 1rem;
          font-family: var(--font-mono);
        }
      `}</style>
    </div>
  );
}
