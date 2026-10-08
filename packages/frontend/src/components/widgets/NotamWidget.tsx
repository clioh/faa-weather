import { useFetch } from '../../hooks/useFetch';
import { WidgetStatus } from '../WidgetStatus';

interface NotamData {
  id: string;
  type: string;
  classification: string;
  description: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  location: string;
  schedule: string | null;
  altitude: {
    min: string | null;
    max: string | null;
  } | null;
}

interface NotamResponse {
  notams: NotamData[];
}

interface NotamWidgetProps {
  position: string;
  airport: string;
  categories?: string[];
  maxItems?: number;
}

export function NotamWidget({
  position,
  airport,
  categories = [],
  maxItems = 5,
}: NotamWidgetProps) {
  const categoriesParam = categories.length > 0 ? `?categories=${categories.join(',')}` : '';
  const url = `/api/aviation/notams/${airport}${categoriesParam}`;

  const {
    data,
    loading,
    refreshing,
    error,
    isStale,
    lastUpdated,
    retryCount,
    retry,
  } = useFetch<NotamResponse>(url, {
    refreshInterval: 30 * 60 * 1000, // 30 minutes
    maxRetries: 3,
    keepStaleData: true,
  });

  const notams = data?.notams || [];

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'PERM';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const getClassificationClass = (classification: string) => {
    const c = classification.toUpperCase();
    if (c.includes('FDC')) return 'notam-fdc';
    if (c.includes('GPS') || c.includes('GNSS')) return 'notam-gps';
    if (c.includes('SAA')) return 'notam-saa';
    return 'notam-general';
  };

  const truncateDescription = (desc: string, maxLen = 120) => {
    if (desc.length <= maxLen) return desc;
    return desc.substring(0, maxLen).trim() + '...';
  };

  return (
    <div className="widget notam-widget" data-position={position}>
      <div className="widget-content">
        <div className="notam-header">
          <h2>NOTAMs - {airport}</h2>
          {!loading && <span className="notam-count">{notams.length}</span>}
        </div>

        <WidgetStatus
          loading={loading}
          refreshing={refreshing}
          error={error}
          isStale={isStale}
          lastUpdated={lastUpdated}
          retryCount={retryCount}
          onRetry={retry}
          loadingText="Loading NOTAMs..."
        >
          {notams.length === 0 ? (
            <p className="no-notams">No active NOTAMs</p>
          ) : (
            <div className="notam-list">
              {notams.slice(0, maxItems).map((notam) => (
                <div
                  key={notam.id}
                  className={`notam-item ${getClassificationClass(notam.classification)}`}
                >
                  <div className="notam-item-header">
                    <span className="notam-id">{notam.id}</span>
                    <span className="notam-classification">{notam.classification}</span>
                  </div>
                  <div className="notam-description">
                    {truncateDescription(notam.description)}
                  </div>
                  <div className="notam-meta">
                    <span className="notam-dates">
                      {formatDate(notam.effectiveStart)} - {formatDate(notam.effectiveEnd)}
                    </span>
                    {notam.altitude && (
                      <span className="notam-altitude">
                        {notam.altitude.min || 'SFC'} - {notam.altitude.max || 'UNL'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {notams.length > maxItems && (
                <p className="notam-more">+{notams.length - maxItems} more NOTAMs</p>
              )}
            </div>
          )}
        </WidgetStatus>
      </div>

      <style>{`
        .notam-widget .notam-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }

        .notam-widget h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 300;
        }

        .notam-widget .notam-count {
          font-size: 0.875rem;
          color: var(--color-text-dim);
          background: rgba(255, 255, 255, 0.1);
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
        }

        .notam-widget .no-notams {
          color: var(--color-vfr);
          font-size: 1rem;
        }

        .notam-widget .notam-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .notam-widget .notam-item {
          padding: 0.5rem 0.75rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          border-left: 3px solid var(--color-text-dim);
        }

        .notam-widget .notam-item.notam-fdc {
          border-left-color: var(--color-ifr);
        }

        .notam-widget .notam-item.notam-gps {
          border-left-color: var(--color-mvfr);
        }

        .notam-widget .notam-item.notam-saa {
          border-left-color: var(--color-lifr);
        }

        .notam-widget .notam-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }

        .notam-widget .notam-id {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--color-text);
        }

        .notam-widget .notam-classification {
          font-size: 0.625rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
          padding: 0.125rem 0.375rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }

        .notam-widget .notam-description {
          font-size: 0.75rem;
          color: var(--color-text);
          line-height: 1.4;
          margin-bottom: 0.25rem;
          font-family: var(--font-mono);
        }

        .notam-widget .notam-meta {
          display: flex;
          justify-content: space-between;
          font-size: 0.625rem;
          color: var(--color-text-dim);
        }

        .notam-widget .notam-dates {
          font-family: var(--font-mono);
        }

        .notam-widget .notam-altitude {
          font-family: var(--font-mono);
        }

        .notam-widget .notam-more {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          text-align: center;
          margin: 0.5rem 0 0 0;
        }
      `}</style>
    </div>
  );
}
