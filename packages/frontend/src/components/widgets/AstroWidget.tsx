import { useState, useEffect } from 'react';

interface AstroData {
  date: string;
  sun: {
    sunrise: { local: string; zulu: string };
    sunset: { local: string; zulu: string };
    civilDawn: { local: string; zulu: string };
    civilDusk: { local: string; zulu: string };
  };
  moon: {
    phase: number;
    phaseName: string;
    illumination: number;
  };
  upcoming: {
    event: string;
    local: string;
    minutesUntil: number;
  } | null;
}

interface AstroWidgetProps {
  position: string;
  showZulu?: boolean;
}

export function AstroWidget({ position, showZulu = false }: AstroWidgetProps) {
  const [astro, setAstro] = useState<AstroData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/astro');
        if (response.ok) {
          const data = await response.json();
          setAstro(data);
        }
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch astro data:', err);
        setLoading(false);
      }
    }

    fetchData();

    // Refresh every hour
    const interval = setInterval(fetchData, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Update upcoming event countdown every minute
  useEffect(() => {
    const interval = setInterval(() => {
      if (astro?.upcoming) {
        setAstro((prev) => {
          if (!prev?.upcoming) return prev;
          return {
            ...prev,
            upcoming: {
              ...prev.upcoming,
              minutesUntil: prev.upcoming.minutesUntil - 1,
            },
          };
        });
      }
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [astro]);

  const formatMinutes = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getMoonEmoji = (phase: number): string => {
    if (phase < 0.03 || phase > 0.97) return '🌑';
    if (phase < 0.22) return '🌒';
    if (phase < 0.28) return '🌓';
    if (phase < 0.47) return '🌔';
    if (phase < 0.53) return '🌕';
    if (phase < 0.72) return '🌖';
    if (phase < 0.78) return '🌗';
    return '🌘';
  };

  if (loading || !astro) {
    return (
      <div className="widget astro-widget" data-position={position}>
        <div className="widget-content">
          <h3>Sun/Moon</h3>
          <p className="placeholder">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="widget astro-widget" data-position={position}>
      <div className="widget-content">
        <h3>Sun/Moon</h3>

        <div className="astro-grid">
          <div className="astro-item">
            <span className="icon">☀️</span>
            <div className="times">
              <div className="time-row">
                <span className="label">Rise</span>
                <span className="time">{astro.sun.sunrise.local}</span>
                {showZulu && <span className="zulu">{astro.sun.sunrise.zulu}</span>}
              </div>
              <div className="time-row">
                <span className="label">Set</span>
                <span className="time">{astro.sun.sunset.local}</span>
                {showZulu && <span className="zulu">{astro.sun.sunset.zulu}</span>}
              </div>
            </div>
          </div>

          <div className="astro-item twilight">
            <span className="icon">🌅</span>
            <div className="times">
              <div className="time-row">
                <span className="label">Civil Dawn</span>
                <span className="time">{astro.sun.civilDawn.local}</span>
              </div>
              <div className="time-row">
                <span className="label">Civil Dusk</span>
                <span className="time">{astro.sun.civilDusk.local}</span>
              </div>
            </div>
          </div>

          <div className="astro-item moon">
            <span className="icon">{getMoonEmoji(astro.moon.phase)}</span>
            <div className="moon-info">
              <span className="phase-name">{astro.moon.phaseName}</span>
              <span className="illumination">{astro.moon.illumination}%</span>
            </div>
          </div>
        </div>

        {astro.upcoming && astro.upcoming.minutesUntil > 0 && (
          <div className="upcoming">
            <span className="label">{astro.upcoming.event} in</span>
            <span className="countdown">{formatMinutes(astro.upcoming.minutesUntil)}</span>
          </div>
        )}
      </div>

      <style>{`
        .astro-widget h3 {
          font-size: 1rem;
          font-weight: 400;
          color: var(--color-text-dim);
          margin-bottom: 0.75rem;
        }

        .astro-widget .astro-grid {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .astro-widget .astro-item {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .astro-widget .icon {
          font-size: 1.25rem;
          line-height: 1;
        }

        .astro-widget .times {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .astro-widget .time-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .astro-widget .time-row .label {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          min-width: 4rem;
        }

        .astro-widget .time-row .time {
          font-size: 0.875rem;
        }

        .astro-widget .time-row .zulu {
          font-size: 0.75rem;
          color: var(--color-accent);
          font-family: var(--font-mono);
        }

        .astro-widget .twilight {
          opacity: 0.8;
        }

        .astro-widget .twilight .time-row .label {
          min-width: 5.5rem;
        }

        .astro-widget .moon-info {
          display: flex;
          flex-direction: column;
        }

        .astro-widget .phase-name {
          font-size: 0.875rem;
        }

        .astro-widget .illumination {
          font-size: 0.75rem;
          color: var(--color-text-dim);
        }

        .astro-widget .upcoming {
          margin-top: 1rem;
          padding-top: 0.75rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .astro-widget .upcoming .label {
          font-size: 0.75rem;
          color: var(--color-text-dim);
        }

        .astro-widget .upcoming .countdown {
          font-size: 1rem;
          color: var(--color-accent);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
