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
function CircularProgress({
  percent,
  size = 60,
  strokeWidth = 4,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
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
          stroke="var(--color-hairline)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          fontWeight: 500,
        }}
      >
        {percent}%
      </div>
    </div>
  );
}

// Animated download icon
function DownloadIcon({ animating }: { animating: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <g
        style={{
          animation: animating ? 'downloadBounce 0.6s ease-in-out infinite' : 'none',
        }}
      >
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
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{ animation: 'spin 1s linear infinite' }}
      >
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
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{ animation: 'pulse 1s ease-in-out infinite' }}
      >
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
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (phase === 'error') {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-negative)"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  return null;
}

export function UpdateNotification() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [restart, setRestart] = useState<RestartState | null>(null);
  // Shown in the panel: the mirror is a kiosk, so a blocking alert() could
  // never be dismissed.
  const [actionError, setActionError] = useState<string | null>(null);
  const unmounted = useRef(false);
  useEffect(
    () => () => {
      unmounted.current = true;
    },
    []
  );
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
    setActionError(null);
    // Poll for progress while the download runs
    const pollInterval = setInterval(checkForUpdates, 500);
    try {
      const response = await fetch('/api/update/download', { method: 'POST' });
      const result = await response.json();
      if (!result.success) {
        setActionError(`Download failed: ${result.message}`);
      }
    } catch {
      setActionError('Download failed. Check the network connection and try again.');
    } finally {
      clearInterval(pollInterval);
      checkForUpdates();
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
    setActionError(null);
    try {
      const response = await fetch('/api/update/apply', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        setRestart({ phase: 'restarting', message: result.message || 'Update started' });
        void waitForRestart(previousVersion);
      } else {
        setActionError(`Update failed: ${result.message}`);
        checkForUpdates();
      }
    } catch {
      setActionError('Couldn\u2019t start the update. Try again, or check logs/update.log.');
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
  const errorMessage =
    actionError ??
    (downloadProgress.phase === 'error' ? downloadProgress.error || 'Something went wrong' : null);
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
      <div
        style={{
          ...styles.notification,
          maxWidth: showDetails ? '400px' : '350px',
        }}
      >
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.icon}>
            <PhaseIcon phase={isActive ? downloadProgress.phase : 'idle'} />
          </span>
          <span style={styles.title}>
            {isActive ? phaseLabels[downloadProgress.phase] : 'Update available'}
          </span>
          {!isActive && (
            <button style={styles.closeButton} onClick={() => setDismissed(true)} title="Dismiss">
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
                      {formatBytes(downloadProgress.bytesDownloaded)} /{' '}
                      {formatBytes(downloadProgress.totalBytes)}
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
                  <div style={styles.progressText}>{phaseLabels[downloadProgress.phase]}</div>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div style={styles.progressBarContainer}>
              <div
                style={{
                  ...styles.progressBar,
                  width: `${downloadProgress.percent}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Error display */}
        {errorMessage && !isActive && (
          <div style={styles.errorBox} role="alert">
            <PhaseIcon phase="error" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Version info when not downloading */}
        {!isActive && (
          <>
            <div style={styles.info}>
              <span style={styles.version}>
                v{updateStatus.currentVersion} → v{updateStatus.latestVersion}
              </span>
              <span style={styles.releaseInfo}>{formatBytes(updateStatus.downloadSize)}</span>
            </div>

            {updateStatus.releaseName && (
              <div style={styles.releaseName}>{updateStatus.releaseName}</div>
            )}

            {/* Downloaded badge */}
            {updateStatus.downloadReady && (
              <div style={styles.readyBadge}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Downloaded, ready to install
              </div>
            )}
          </>
        )}

        {/* Release notes (expandable) */}
        {showDetails && !isActive && releaseLines.length > 0 && (
          <div style={styles.changes}>
            <div style={styles.changesTitle}>
              Release notes
              {updateStatus.publishedAt && (
                <span style={styles.releaseDate}>{formatDate(updateStatus.publishedAt)}</span>
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
            <button style={styles.detailsButton} onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? 'Hide' : 'Details'}
            </button>

            {updateStatus.downloadReady ? (
              <button style={styles.updateButton} onClick={applyUpdate}>
                Install now
              </button>
            ) : (
              <button style={styles.downloadButton} onClick={downloadUpdate}>
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

// Glass Cockpit: black panel with a hairline edge (it floats over widgets, so
// it is opaque), sky blue for progress and the primary action, mono for data.
const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: '24px',
    right: '24px',
    zIndex: 9999,
    fontFamily: 'var(--font-primary)',
  },
  notification: {
    background: 'var(--color-background)',
    border: '1px solid var(--color-hairline)',
    borderRadius: '16px',
    padding: '20px',
    minWidth: '320px',
    color: 'var(--color-text)',
    transition: 'max-width 0.3s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '14px',
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-accent)',
  },
  title: {
    fontSize: '17px',
    fontWeight: 500,
    flex: 1,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-dim)',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    minWidth: '44px',
    minHeight: '44px',
    margin: '-12px -12px -12px 0',
  },
  progressSection: {
    marginBottom: '14px',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '14px',
  },
  progressInfo: {
    flex: 1,
  },
  progressText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    marginBottom: '4px',
  },
  progressMeta: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--color-text-dim)',
  },
  progressBarContainer: {
    height: '3px',
    background: 'var(--color-hairline)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'var(--color-accent)',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    border: '1px solid rgba(255, 82, 82, 0.4)',
    borderRadius: '12px',
    fontSize: '14px',
    color: 'var(--color-negative)',
    marginBottom: '14px',
  },
  info: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  version: {
    fontFamily: 'var(--font-mono)',
    fontSize: '15px',
  },
  releaseInfo: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--color-text-dim)',
  },
  releaseName: {
    fontSize: '15px',
    lineHeight: 1.5,
    marginBottom: '14px',
    color: 'rgba(255, 255, 255, 0.68)',
  },
  readyBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    color: 'var(--color-accent)',
    marginBottom: '14px',
  },
  changes: {
    borderTop: '1px solid var(--color-hairline)',
    paddingTop: '14px',
    marginBottom: '14px',
  },
  changesTitle: {
    fontSize: '11px',
    fontWeight: 500,
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    color: 'var(--color-text-dim)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  releaseDate: {
    fontFamily: 'var(--font-mono)',
    textTransform: 'none',
    letterSpacing: 0,
    fontSize: '12px',
  },
  changesList: {
    margin: 0,
    paddingLeft: '18px',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  changeItem: {
    marginBottom: '4px',
    color: 'rgba(255, 255, 255, 0.68)',
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  detailsButton: {
    flex: 1,
    height: '44px',
    padding: '0 18px',
    border: '1px solid rgba(255, 255, 255, 0.24)',
    borderRadius: '22px',
    background: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  downloadButton: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    height: '44px',
    padding: '0 18px',
    border: 'none',
    borderRadius: '22px',
    background: 'var(--color-accent)',
    color: '#00141f',
    fontFamily: 'inherit',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  updateButton: {
    flex: 1,
    height: '44px',
    padding: '0 18px',
    border: 'none',
    borderRadius: '22px',
    background: 'var(--color-accent)',
    color: '#00141f',
    fontFamily: 'inherit',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
