import { useState, useEffect, useCallback, useRef } from 'react';

interface DownloadProgress {
  phase: 'idle' | 'downloading' | 'extracting' | 'installing' | 'complete' | 'error';
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  speed: number;
  eta: number;
  error?: string;
}

interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseName: string;
  publishedAt: string;
  downloadSize: number;
  lastChecked: number;
  downloadReady: boolean;
  downloadProgress: DownloadProgress;
}

interface UpdateNotificationProps {
  wsConnected?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s';
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatDate(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// After POST /api/update/apply the backend hands off to scripts/update.sh,
// which stops all services, installs the release and restarts them (rolling
// back if /api/health does not come up). Poll until the backend is back.
const RESTART_POLL_MS = 3000;
const RESTART_TIMEOUT_MS = 3 * 60 * 1000;

type RestartState =
  | { phase: 'restarting'; message: string }
  | { phase: 'rolledBack'; version: string }
  | { phase: 'timeout' };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Current backend version, or null while the backend is unreachable. */
async function fetchRunningVersion(): Promise<string | null> {
  try {
    const response = await fetch('/api/update/status', { cache: 'no-store' });
    if (!response.ok) return null;
    const status = (await response.json()) as Partial<UpdateStatus>;
    return status.currentVersion || null;
  } catch {
    return null; // connection refused/reset while services restart
  }
}

// Circular progress component
function CircularProgress({ percent, size = 60, strokeWidth = 4 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#00ff88"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: '600',
      }}>
        {percent}%
      </div>
    </div>
  );
}

// Animated download icon
function DownloadIcon({ animating }: { animating: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <g style={{
        animation: animating ? 'downloadBounce 0.6s ease-in-out infinite' : 'none',
      }}>
        <polyline points="7,10 12,15 17,10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </g>
      <style>{`
        @keyframes downloadBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(3px); }
        }
      `}</style>
    </svg>
  );
}

// Phase indicator icons
function PhaseIcon({ phase }: { phase: DownloadProgress['phase'] }) {
  if (phase === 'downloading') {
    return <DownloadIcon animating={true} />;
  }
  if (phase === 'extracting') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        style={{ animation: 'spin 1s linear infinite' }}>
        <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
        <style>{`
          @keyframes spin {
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </svg>
    );
  }
  if (phase === 'installing') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        style={{ animation: 'pulse 1s ease-in-out infinite' }}>
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </svg>
    );
  }
  if (phase === 'complete') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (phase === 'error') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  return null;
}

export function UpdateNotification({ wsConnected: _wsConnected }: UpdateNotificationProps) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [restart, setRestart] = useState<RestartState | null>(null);
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);
  // expanded state reserved for future use with detailed update info

  const checkForUpdates = useCallback(async () => {
    try {
      const response = await fetch('/api/update/status');
      if (response.ok) {
        const status = await response.json();
        setUpdateStatus(status);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 60 * 1000); // Check every minute for progress updates
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  const downloadUpdate = async () => {
    try {
      // Start polling for progress
      const pollInterval = setInterval(checkForUpdates, 500);

      const response = await fetch('/api/update/download', { method: 'POST' });
      const result = await response.json();

      clearInterval(pollInterval);
      checkForUpdates();

      if (!result.success) {
        alert(`Download failed: ${result.message}`);
      }
    } catch (error) {
      alert('Failed to download update. Check the logs for details.');
    }
  };

  const waitForRestart = async (previousVersion: string) => {
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    let wentDown = false;
    while (Date.now() < deadline && !unmounted.current) {
      await sleep(RESTART_POLL_MS);
      const version = await fetchRunningVersion();
      if (version === null) {
        wentDown = true;
        continue;
      }
      if (version !== previousVersion) {
        window.location.reload();
        return;
      }
      if (wentDown) {
        // Services came back on the old version: update.sh rolled back
        setRestart({ phase: 'rolledBack', version });
        return;
      }
    }
    if (!unmounted.current) setRestart({ phase: 'timeout' });
  };

  const applyUpdate = async () => {
    const previousVersion = updateStatus?.currentVersion ?? '';
    try {
      const response = await fetch('/api/update/apply', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        setRestart({ phase: 'restarting', message: result.message || 'Update started' });
        void waitForRestart(previousVersion);
      } else {
        alert(`Update failed: ${result.message}`);
        checkForUpdates();
      }
    } catch {
      alert('Failed to start update. Check the logs for details.');
    }
  };

  if (restart) {
    return (
      <div style={styles.container}>
        <div style={styles.notification}>
          <div style={styles.header}>
            <span style={styles.icon}>
              <PhaseIcon phase={restart.phase === 'restarting' ? 'installing' : 'error'} />
            </span>
            <span style={styles.title}>
              {restart.phase === 'restarting' && 'Update started, restarting\u2026'}
              {restart.phase === 'rolledBack' && 'Update failed'}
              {restart.phase === 'timeout' && 'SkyGlass did not come back'}
            </span>
          </div>
          <div style={styles.releaseName}>
            {restart.phase === 'restarting' &&
              `${restart.message}. This page will reload when SkyGlass is back.`}
            {restart.phase === 'rolledBack' &&
              `The update was rolled back; still running v${restart.version}. See logs/update.log.`}
            {restart.phase === 'timeout' &&
              'Restart manually (pm2 restart all, or power-cycle the mirror) and check logs/update.log.'}
          </div>
          {restart.phase !== 'restarting' && (
            <div style={styles.actions}>
              <button style={styles.detailsButton} onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Don't show if no update or dismissed
  if (!updateStatus?.updateAvailable || dismissed) {
    return null;
  }

  const { downloadProgress } = updateStatus;
  const isDownloading = downloadProgress.phase === 'downloading';
  const isProcessing = ['extracting', 'installing'].includes(downloadProgress.phase);
  const hasError = downloadProgress.phase === 'error';
  const isActive = isDownloading || isProcessing;

  // Phase labels
  const phaseLabels: Record<DownloadProgress['phase'], string> = {
    idle: 'Ready to download',
    downloading: 'Downloading...',
    extracting: 'Extracting...',
    installing: 'Installing...',
    complete: 'Complete',
    error: 'Error',
  };

  // Parse release notes
  const releaseLines = updateStatus.releaseNotes
    ? updateStatus.releaseNotes
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .slice(0, 5)
    : [];

  return (
    <div style={styles.container}>
      <div style={{
        ...styles.notification,
        maxWidth: showDetails ? '400px' : '350px',
      }}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.icon}>
            <PhaseIcon phase={isActive ? downloadProgress.phase : 'idle'} />
          </span>
          <span style={styles.title}>
            {isActive ? phaseLabels[downloadProgress.phase] : 'Update Available'}
          </span>
          {!isActive && (
            <button
              style={styles.closeButton}
              onClick={() => setDismissed(true)}
              title="Dismiss"
            >
              &times;
            </button>
          )}
        </div>

        {/* Progress indicator when downloading/processing */}
        {isActive && (
          <div style={styles.progressSection}>
            <div style={styles.progressRow}>
              <CircularProgress percent={downloadProgress.percent} />
              <div style={styles.progressInfo}>
                {isDownloading && (
                  <>
                    <div style={styles.progressText}>
                      {formatBytes(downloadProgress.bytesDownloaded)} / {formatBytes(downloadProgress.totalBytes)}
                    </div>
                    <div style={styles.progressMeta}>
                      {formatSpeed(downloadProgress.speed)}
                      {downloadProgress.eta > 0 && (
                        <span style={{ marginLeft: '8px' }}>
                          ETA: {formatEta(downloadProgress.eta)}
                        </span>
                      )}
                    </div>
                  </>
                )}
                {isProcessing && (
                  <div style={styles.progressText}>
                    {phaseLabels[downloadProgress.phase]}
                  </div>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div style={styles.progressBarContainer}>
              <div style={{
                ...styles.progressBar,
                width: `${downloadProgress.percent}%`,
              }} />
            </div>
          </div>
        )}

        {/* Error display */}
        {hasError && (
          <div style={styles.errorBox}>
            <PhaseIcon phase="error" />
            <span>{downloadProgress.error || 'An error occurred'}</span>
          </div>
        )}

        {/* Version info when not downloading */}
        {!isActive && (
          <>
            <div style={styles.info}>
              <span style={styles.version}>
                v{updateStatus.currentVersion} → v{updateStatus.latestVersion}
              </span>
              <span style={styles.releaseInfo}>
                {formatBytes(updateStatus.downloadSize)}
              </span>
            </div>

            {updateStatus.releaseName && (
              <div style={styles.releaseName}>{updateStatus.releaseName}</div>
            )}

            {/* Downloaded badge */}
            {updateStatus.downloadReady && (
              <div style={styles.readyBadge}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Downloaded - Ready to install
              </div>
            )}
          </>
        )}

        {/* Release notes (expandable) */}
        {showDetails && !isActive && releaseLines.length > 0 && (
          <div style={styles.changes}>
            <div style={styles.changesTitle}>
              Release Notes
              {updateStatus.publishedAt && (
                <span style={styles.releaseDate}>
                  {formatDate(updateStatus.publishedAt)}
                </span>
              )}
            </div>
            <ul style={styles.changesList}>
              {releaseLines.map((line, i) => (
                <li key={i} style={styles.changeItem}>
                  {line.replace(/^[-*]\s*/, '')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        {!isActive && (
          <div style={styles.actions}>
            <button
              style={styles.detailsButton}
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? 'Hide' : 'Details'}
            </button>

            {updateStatus.downloadReady ? (
              <button
                style={styles.updateButton}
                onClick={applyUpdate}
              >
                Install Now
              </button>
            ) : (
              <button
                style={styles.downloadButton}
                onClick={downloadUpdate}
              >
                <DownloadIcon animating={false} />
                <span>Download</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: 9999,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  notification: {
    background: 'rgba(15, 25, 45, 0.98)',
    borderRadius: '16px',
    padding: '16px',
    minWidth: '300px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(10px)',
    color: '#fff',
    transition: 'all 0.3s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px',
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: '14px',
    fontWeight: '600',
    flex: 1,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '22px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    transition: 'color 0.2s',
  },
  progressSection: {
    marginBottom: '12px',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '12px',
  },
  progressInfo: {
    flex: 1,
  },
  progressText: {
    fontSize: '13px',
    fontWeight: '500',
    marginBottom: '4px',
  },
  progressMeta: {
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  progressBarContainer: {
    height: '4px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #00ff88, #00cc6a)',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    background: 'rgba(255, 68, 68, 0.15)',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#ff6666',
    marginBottom: '12px',
  },
  info: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  version: {
    fontSize: '12px',
    fontFamily: 'monospace',
    background: 'rgba(0, 255, 136, 0.15)',
    color: '#00ff88',
    padding: '4px 10px',
    borderRadius: '6px',
  },
  releaseInfo: {
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  releaseName: {
    fontSize: '13px',
    fontWeight: '500',
    marginBottom: '12px',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  readyBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    background: 'rgba(0, 255, 136, 0.15)',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#00ff88',
    marginBottom: '12px',
  },
  changes: {
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '10px',
    padding: '12px',
    marginBottom: '12px',
  },
  changesTitle: {
    fontSize: '11px',
    fontWeight: '600',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'rgba(255, 255, 255, 0.5)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  releaseDate: {
    fontWeight: '400',
    textTransform: 'none',
    fontSize: '10px',
  },
  changesList: {
    margin: 0,
    paddingLeft: '16px',
    fontSize: '11px',
    lineHeight: 1.6,
  },
  changeItem: {
    marginBottom: '4px',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  detailsButton: {
    flex: 1,
    padding: '10px 14px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    background: 'transparent',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  downloadButton: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px 14px',
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #0066ff 0%, #0044cc 100%)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  updateButton: {
    flex: 1,
    padding: '10px 14px',
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
    color: '#000',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
