import { useState, useEffect } from 'react';

interface SetupScreenProps {
  adminUrl: string;
  onSetupComplete?: () => void;
}

export function SetupScreen({ adminUrl, onSetupComplete }: SetupScreenProps) {
  const [dots, setDots] = useState('');
  const [showQR, setShowQR] = useState(false);

  // Animate waiting dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Poll for setup completion
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch('/api/setup/status');
        const data = await res.json();
        if (data.configured) {
          onSetupComplete?.();
        }
      } catch {
        // Ignore errors during setup
      }
    };

    const interval = setInterval(checkSetup, 5000);
    return () => clearInterval(interval);
  }, [onSetupComplete]);

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Logo */}
        <div style={styles.logo}>🪞</div>

        {/* Title */}
        <h1 style={styles.title}>Welcome to SkyGlass</h1>
        <p style={styles.subtitle}>Let's get your smart mirror set up</p>

        {/* Instructions */}
        <div style={styles.instructionBox}>
          <div style={styles.step}>
            <span style={styles.stepNumber}>1</span>
            <div>
              <strong>Connect to the same WiFi network</strong>
              <p style={styles.stepDesc}>Make sure your phone or computer is on the same network as this mirror</p>
            </div>
          </div>

          <div style={styles.step}>
            <span style={styles.stepNumber}>2</span>
            <div>
              <strong>Open the setup page</strong>
              <p style={styles.stepDesc}>
                Visit this address in your browser:
              </p>
              <div style={styles.urlBox}>
                {adminUrl}
              </div>
            </div>
          </div>

          <div style={styles.step}>
            <span style={styles.stepNumber}>3</span>
            <div>
              <strong>Complete the setup wizard</strong>
              <p style={styles.stepDesc}>Enter your airport, location, and register your face</p>
            </div>
          </div>
        </div>

        {/* QR Code toggle */}
        <button
          style={styles.qrButton}
          onClick={() => setShowQR(!showQR)}
        >
          {showQR ? 'Hide QR Code' : 'Show QR Code'}
        </button>

        {showQR && (
          <div style={styles.qrContainer}>
            <img
              src={`${adminUrl.replace('/admin', '')}/qr`}
              alt="QR Code"
              style={styles.qrCode}
            />
            <p style={styles.qrHint}>Scan with your phone camera</p>
          </div>
        )}

        {/* Waiting indicator */}
        <div style={styles.waiting}>
          <span style={styles.waitingDot} />
          Waiting for setup{dots}
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <p>Need help? Check the documentation at github.com/your-repo/SkyGlass</p>
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
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  content: {
    maxWidth: '600px',
    textAlign: 'center',
  },
  logo: {
    fontSize: '5rem',
    marginBottom: '1rem',
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: 300,
    margin: '0 0 0.5rem 0',
  },
  subtitle: {
    fontSize: '1.2rem',
    color: '#888',
    marginBottom: '3rem',
  },
  instructionBox: {
    background: '#111',
    borderRadius: '16px',
    padding: '2rem',
    textAlign: 'left',
    marginBottom: '2rem',
  },
  step: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  stepNumber: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#4ecca3',
    color: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  stepDesc: {
    color: '#888',
    fontSize: '0.9rem',
    marginTop: '0.25rem',
  },
  urlBox: {
    background: '#222',
    padding: '0.75rem 1rem',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '1.1rem',
    color: '#4ecca3',
    marginTop: '0.5rem',
    wordBreak: 'break-all',
  },
  qrButton: {
    background: 'transparent',
    border: '1px solid #333',
    color: '#888',
    padding: '0.75rem 1.5rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    marginBottom: '1.5rem',
  },
  qrContainer: {
    marginBottom: '2rem',
  },
  qrCode: {
    width: '200px',
    height: '200px',
    borderRadius: '12px',
    background: '#fff',
    padding: '8px',
  },
  qrHint: {
    color: '#666',
    fontSize: '0.85rem',
    marginTop: '0.5rem',
  },
  waiting: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    color: '#666',
    fontSize: '0.9rem',
  },
  waitingDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#4ecca3',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  footer: {
    position: 'absolute',
    bottom: '2rem',
    color: '#444',
    fontSize: '0.8rem',
  },
};

// Add keyframes for pulse animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }
`;
document.head.appendChild(styleSheet);
