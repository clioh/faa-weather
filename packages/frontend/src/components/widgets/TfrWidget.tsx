import { useEffect } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { WidgetStatus } from '../WidgetStatus';

interface TfrData {
  id: string;
  type: string;
  facility: string;
  state: string;
  description: string;
  effectiveStart: string;
  effectiveEnd: string;
}

interface TfrResponse {
  tfrs: TfrData[];
}

interface TfrWidgetProps {
  position: string;
  radiusNm?: number;
}

export function TfrWidget({ position, radiusNm: _radiusNm = 100 }: TfrWidgetProps) {
  const {
    data,
    loading,
    refreshing,
    error,
    isStale,
    lastUpdated,
    retryCount,
    retry,
    refresh,
  } = useFetch<TfrResponse>('/api/aviation/tfrs', {
    refreshInterval: 15 * 60 * 1000, // 15 minutes
    maxRetries: 3,
    keepStaleData: true,
  });

  const tfrs = data?.tfrs || [];

  // Listen for WebSocket updates
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001`);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'tfrs') {
          refresh();
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    return () => ws.close();
  }, [refresh]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTfrTypeClass = (type: string) => {
    const t = type.toUpperCase();
    if (t.includes('SECURITY') || t.includes('VIP')) return 'tfr-security';
    if (t.includes('HAZARD') || t.includes('SPACE')) return 'tfr-hazard';
    if (t.includes('SPECIAL')) return 'tfr-special';
    return 'tfr-general';
  };

  return (
    <div className="widget tfr-widget" data-position={position}>
      <div className="widget-content">
        <div className="tfr-header">
          <h2>TFRs</h2>
          {!loading && <span className="tfr-count">{tfrs.length} Active</span>}
        </div>

        <WidgetStatus
          loading={loading}
          refreshing={refreshing}
          error={error}
          isStale={isStale}
          lastUpdated={lastUpdated}
          retryCount={retryCount}
          onRetry={retry}
          loadingText="Loading TFRs..."
        >
          {tfrs.length === 0 ? (
            <p className="no-tfrs">No active TFRs</p>
          ) : (
            <div className="tfr-list">
              {tfrs.slice(0, 5).map((tfr) => (
                <div key={tfr.id} className={`tfr-item ${getTfrTypeClass(tfr.type)}`}>
                  <div className="tfr-item-header">
                    <span className="tfr-id">{tfr.id}</span>
                    <span className="tfr-type">{tfr.type}</span>
                  </div>
                  <div className="tfr-description">{tfr.description}</div>
                  <div className="tfr-dates">
                    {formatDate(tfr.effectiveStart)} - {formatDate(tfr.effectiveEnd)}
                  </div>
                </div>
              ))}
              {tfrs.length > 5 && (
                <p className="tfr-more">+{tfrs.length - 5} more TFRs</p>
              )}
            </div>
          )}
        </WidgetStatus>
      </div>

      <style>{`
        .tfr-widget .tfr-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }

        .tfr-widget h2 {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 300;
        }

        .tfr-widget .tfr-count {
          font-size: 0.875rem;
          color: var(--color-text-dim);
          background: rgba(255, 255, 255, 0.1);
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
        }

        .tfr-widget .no-tfrs {
          color: var(--color-vfr);
          font-size: 1rem;
        }

        .tfr-widget .tfr-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .tfr-widget .tfr-item {
          padding: 0.75rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          border-left: 3px solid var(--color-mvfr);
        }

        .tfr-widget .tfr-item.tfr-security {
          border-left-color: var(--color-lifr);
        }

        .tfr-widget .tfr-item.tfr-hazard {
          border-left-color: var(--color-ifr);
        }

        .tfr-widget .tfr-item.tfr-special {
          border-left-color: var(--color-mvfr);
        }

        .tfr-widget .tfr-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .tfr-widget .tfr-id {
          font-family: var(--font-mono);
          font-size: 0.875rem;
          font-weight: 500;
        }

        .tfr-widget .tfr-type {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
        }

        .tfr-widget .tfr-description {
          font-size: 0.875rem;
          color: var(--color-text);
          line-height: 1.4;
          margin-bottom: 0.5rem;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .tfr-widget .tfr-dates {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          font-family: var(--font-mono);
        }

        .tfr-widget .tfr-more {
          font-size: 0.875rem;
          color: var(--color-text-dim);
          text-align: center;
          margin: 0.5rem 0 0 0;
        }
      `}</style>
    </div>
  );
}
