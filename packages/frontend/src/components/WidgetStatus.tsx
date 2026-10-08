import { formatTimeAgo } from '../hooks/useFetch';

interface WidgetStatusProps {
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  isStale?: boolean;
  lastUpdated?: number | null;
  retryCount?: number;
  maxRetries?: number;
  onRetry?: () => void;
  loadingText?: string;
  children?: React.ReactNode;
}

/**
 * Consistent loading, error, and status display for widgets
 */
export function WidgetStatus({
  loading,
  refreshing,
  error,
  isStale,
  lastUpdated,
  retryCount = 0,
  maxRetries = 3,
  onRetry,
  loadingText = 'Loading...',
  children,
}: WidgetStatusProps) {
  // Loading state (initial load)
  if (loading) {
    return (
      <div className="widget-status loading">
        <div className="loading-spinner" />
        <span>{loadingText}</span>
        <style>{styles}</style>
      </div>
    );
  }

  // Error state (no data available)
  if (error && !isStale) {
    return (
      <div className="widget-status error">
        <div className="error-icon">!</div>
        <span className="error-message">{error}</span>
        {retryCount > 0 && retryCount < maxRetries && (
          <span className="retry-info">
            Retrying... ({retryCount}/{maxRetries})
          </span>
        )}
        {retryCount >= maxRetries && onRetry && (
          <button className="retry-button" onClick={onRetry}>
            Retry
          </button>
        )}
        <style>{styles}</style>
      </div>
    );
  }

  // Content with optional stale/refreshing indicators
  return (
    <div className="widget-status-container">
      {/* Stale data warning */}
      {isStale && (
        <div className="stale-banner">
          <span>Offline - showing cached data</span>
          {onRetry && (
            <button className="retry-button small" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      {children}

      {/* Refreshing indicator */}
      {refreshing && (
        <div className="refreshing-indicator">
          <div className="loading-spinner small" />
        </div>
      )}

      {/* Last updated timestamp (optional, shown on hover) */}
      {lastUpdated && (
        <div className="last-updated" title={new Date(lastUpdated).toLocaleString()}>
          Updated {formatTimeAgo(lastUpdated)}
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .widget-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 2rem 1rem;
    color: var(--color-text-dim);
  }

  .widget-status.loading {
    opacity: 0.7;
  }

  .widget-status.error {
    color: var(--color-ifr, #ff4444);
  }

  .loading-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--color-accent, #00aaff);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-spinner.small {
    width: 14px;
    height: 14px;
    border-width: 1.5px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-ifr, #ff4444);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.25rem;
  }

  .error-message {
    font-size: 0.875rem;
    text-align: center;
    max-width: 200px;
  }

  .retry-info {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .retry-button {
    padding: 0.5rem 1rem;
    border: 1px solid currentColor;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .retry-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .retry-button.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.7rem;
  }

  .widget-status-container {
    position: relative;
  }

  .stale-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    margin-bottom: 0.75rem;
    background: rgba(255, 170, 0, 0.15);
    border: 1px solid rgba(255, 170, 0, 0.3);
    border-radius: 4px;
    font-size: 0.7rem;
    color: #ffaa00;
  }

  .refreshing-indicator {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    opacity: 0.7;
  }

  .last-updated {
    position: absolute;
    bottom: 0;
    right: 0;
    font-size: 0.65rem;
    color: var(--color-text-dim);
    opacity: 0;
    transition: opacity 0.2s;
  }

  .widget-status-container:hover .last-updated {
    opacity: 0.5;
  }
`;

/**
 * Simple loading placeholder with shimmer effect
 */
export function LoadingPlaceholder({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`loading-placeholder ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="placeholder-line"
          style={{ width: `${70 + Math.random() * 30}%` }}
        />
      ))}
      <style>{`
        .loading-placeholder {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .placeholder-line {
          height: 0.875rem;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.05) 25%,
            rgba(255, 255, 255, 0.1) 50%,
            rgba(255, 255, 255, 0.05) 75%
          );
          background-size: 200% 100%;
          border-radius: 4px;
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
