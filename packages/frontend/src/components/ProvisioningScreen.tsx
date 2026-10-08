import { useState, useEffect } from 'react';

// QR Code component - uses simple text display
// Install qrcode.react for actual QR code rendering
function QRCodeSVG({ value, size }: { value: string; size: number; level?: string; bgColor?: string; fgColor?: string }) {
  return (
    <div style={{
      width: size,
      height: size,
      background: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#333',
      fontSize: '0.65rem',
      textAlign: 'center',
      padding: '0.5rem',
      boxSizing: 'border-box',
      borderRadius: '8px',
      fontFamily: 'monospace',
    }}>
      <span style={{ wordBreak: 'break-all' }}>
        {value.startsWith('WIFI:') ? (
          <>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📶</div>
            <div>Connect to WiFi</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔗</div>
            <div>{value.replace('http://', '')}</div>
          </>
        )}
      </span>
    </div>
  );
}

interface ProvisioningScreenProps {
  ssid?: string;
  setupUrl?: string;
  onConnected?: () => void;
}

export function ProvisioningScreen({
  ssid = 'SkyGlass-Setup',
  setupUrl = 'http://10.42.0.1',
  onConnected,
}: ProvisioningScreenProps) {
  const [dots, setDots] = useState('');

  // WiFi QR code format (open network, no password)
  const wifiQrValue = `WIFI:T:nopass;S:${ssid};;`;

  // Animate waiting dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Poll to check if WiFi provisioning is complete
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/provisioning/status', {
          signal: AbortSignal.timeout(3000)
        });
        const data = await res.json();
        if (data.wifiConfigured) {
          onConnected?.();
        }
      } catch {
        // Expected to fail while in provisioning mode
      }
    };

    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [onConnected]);

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Header */}
        <div style={styles.header}>
          <svg width="60" height="60" viewBox="0 0 100 100" fill="none" style={{ marginBottom: 16 }}>
            <rect x="10" y="10" width="80" height="80" rx="8" stroke="#4ecca3" strokeWidth="3" fill="none"/>
            <circle cx="50" cy="45" r="15" stroke="#4ecca3" strokeWidth="2" fill="none"/>
            <path d="M35 70 Q50 55 65 70" stroke="#4ecca3" strokeWidth="2" fill="none"/>
          </svg>
          <h1 style={styles.title}>SkyGlass Setup</h1>
        </div>

        {/* Main instruction card */}
        <div style={styles.card}>
          {/* Two-column layout for QR codes */}
          <div style={styles.columns}>
            {/* Left: WiFi QR */}
            <div style={styles.column}>
              <div style={styles.stepBadge}>1</div>
              <p style={styles.stepLabel}>Connect to WiFi</p>
              <div style={styles.qrWrapper}>
                <QRCodeSVG
                  value={wifiQrValue}
                  size={140}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <div style={styles.networkName}>
                <span style={styles.wifiIcon}>📶</span>
                {ssid}
              </div>
              <p style={styles.hint}>Scan with phone camera</p>
            </div>

            {/* Divider */}
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>then</span>
              <div style={styles.dividerLine} />
            </div>

            {/* Right: URL QR */}
            <div style={styles.column}>
              <div style={styles.stepBadge}>2</div>
              <p style={styles.stepLabel}>Open Setup Page</p>
              <div style={styles.qrWrapper}>
                <QRCodeSVG
                  value={setupUrl}
                  size={140}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <div style={styles.urlDisplay}>
                {setupUrl.replace('http://', '')}
              </div>
              <p style={styles.hint}>Scan or type in browser</p>
            </div>
          </div>

          {/* After setup info */}
          <div style={styles.afterSetup}>
            <p>After setup, access your mirror at:</p>
            <span style={styles.localUrl}>http://skyglass.local</span>
          </div>
        </div>

        {/* Waiting indicator */}
        <div style={styles.waiting}>
          <span style={styles.waitingPulse} />
          <span>Waiting for setup{dots}</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#000',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  content: {
    maxWidth: '700px',
    width: '100%',
    textAlign: 'center',
  },
  header: {
    marginBottom: '2rem',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 300,
    margin: 0,
    letterSpacing: '0.02em',
  },
  card: {
    background: '#111',
    borderRadius: '24px',
    padding: '2.5rem',
    marginBottom: '2rem',
  },
  columns: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: '1rem',
    marginBottom: '2rem',
  },
  column: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    maxWidth: '200px',
  },
  stepBadge: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#4ecca3',
    color: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '1rem',
    marginBottom: '0.5rem',
  },
  stepLabel: {
    fontSize: '0.95rem',
    fontWeight: 500,
    marginBottom: '1rem',
    color: '#fff',
  },
  qrWrapper: {
    background: '#fff',
    padding: '12px',
    borderRadius: '16px',
    marginBottom: '1rem',
  },
  networkName: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#1a1a1a',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '0.9rem',
    color: '#4ecca3',
    marginBottom: '0.5rem',
  },
  wifiIcon: {
    fontSize: '1rem',
  },
  urlDisplay: {
    background: '#1a1a1a',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '0.9rem',
    color: '#4ecca3',
    marginBottom: '0.5rem',
  },
  hint: {
    fontSize: '0.8rem',
    color: '#666',
    margin: 0,
  },
  divider: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '3rem 0.5rem',
  },
  dividerLine: {
    width: '2px',
    height: '30px',
    background: '#333',
  },
  dividerText: {
    fontSize: '0.8rem',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  afterSetup: {
    borderTop: '1px solid #222',
    paddingTop: '1.5rem',
    color: '#888',
    fontSize: '0.9rem',
  },
  localUrl: {
    display: 'inline-block',
    marginTop: '0.5rem',
    color: '#4ecca3',
    fontFamily: 'monospace',
    fontSize: '1.1rem',
  },
  waiting: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    color: '#666',
    fontSize: '0.9rem',
  },
  waitingPulse: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: '#4ecca3',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
};

// Add keyframes for pulse animation
if (typeof document !== 'undefined') {
  const existingStyle = document.getElementById('provisioning-keyframes');
  if (!existingStyle) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'provisioning-keyframes';
    styleSheet.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
      }
    `;
    document.head.appendChild(styleSheet);
  }
}
