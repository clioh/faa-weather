import { useState, useEffect } from 'react';

interface SetupStatus {
  configExists: boolean;
  faceEnrolled: boolean;
  airportConfigured: boolean;
  locationConfigured: boolean;
  setupComplete: boolean;
}

interface RegistrationStatus {
  active: boolean;
  samplesCollected: number;
  samplesNeeded: number;
}

interface SetupProgressScreenProps {
  onSetupComplete?: () => void;
}

export function SetupProgressScreen({ onSetupComplete }: SetupProgressScreenProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [registration, setRegistration] = useState<RegistrationStatus | null>(null);
  const [dots, setDots] = useState('');

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Poll setup status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const [setupRes, regRes] = await Promise.all([
          fetch('/api/setup/status'),
          fetch('/api/registration'),
        ]);

        const setupData = await setupRes.json();
        const regData = await regRes.json();

        setStatus(setupData);
        setRegistration(regData);

        if (setupData.setupComplete) {
          onSetupComplete?.();
        }
      } catch {
        // Ignore errors
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, [onSetupComplete]);

  // Determine current step
  const getCurrentStep = () => {
    if (!status) return { step: 1, label: 'Loading', description: '' };

    if (registration?.active) {
      return {
        step: 4,
        label: 'Face Registration',
        description: 'Look at the camera',
        isFaceRegistration: true,
      };
    }

    if (!status.airportConfigured) {
      return {
        step: 2,
        label: 'Airport Setup',
        description: 'Configure on your phone',
      };
    }

    if (!status.locationConfigured) {
      return {
        step: 3,
        label: 'Location Setup',
        description: 'Configure on your phone',
      };
    }

    if (!status.faceEnrolled) {
      return {
        step: 4,
        label: 'Face Registration',
        description: 'Ready when you are',
      };
    }

    return {
      step: 5,
      label: 'Setup Complete',
      description: 'Starting mirror...',
    };
  };

  const currentStep = getCurrentStep();
  const progress = ((currentStep.step - 1) / 4) * 100;

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Logo */}
        <svg width="80" height="80" viewBox="0 0 100 100" fill="none" style={{ marginBottom: 24 }}>
          <rect x="10" y="10" width="80" height="80" rx="8" stroke="#4ecca3" strokeWidth="3" fill="none"/>
          <circle cx="50" cy="45" r="15" stroke="#4ecca3" strokeWidth="2" fill="none"/>
          <path d="M35 70 Q50 55 65 70" stroke="#4ecca3" strokeWidth="2" fill="none"/>
        </svg>

        <h1 style={styles.title}>Setting Up Your Mirror</h1>

        {/* Progress bar */}
        <div style={styles.progressContainer}>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressBar, width: `${progress}%` }} />
          </div>
          <div style={styles.progressSteps}>
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                style={{
                  ...styles.progressDot,
                  ...(step <= currentStep.step ? styles.progressDotActive : {}),
                  ...(step < currentStep.step ? styles.progressDotComplete : {}),
                }}
              >
                {step < currentStep.step ? '✓' : step}
              </div>
            ))}
          </div>
        </div>

        {/* Current step card */}
        <div style={styles.card}>
          {currentStep.isFaceRegistration ? (
            <>
              {/* Face registration mode - special display */}
              <div style={styles.faceIcon}>
                <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
                  <circle cx="50" cy="40" r="25" stroke="#4ecca3" strokeWidth="3" fill="none"/>
                  <path d="M25 85 Q50 60 75 85" stroke="#4ecca3" strokeWidth="3" fill="none"/>
                  {/* Scanning animation circles */}
                  <circle cx="50" cy="50" r="40" stroke="#4ecca3" strokeWidth="1" opacity="0.3">
                    <animate attributeName="r" values="35;45;35" dur="2s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite"/>
                  </circle>
                </svg>
              </div>

              <h2 style={styles.cardTitle}>Look at the Mirror</h2>
              <p style={styles.cardDescription}>
                Position your face in the center of the screen
              </p>

              {/* Progress */}
              <div style={styles.captureProgress}>
                <div style={styles.captureCount}>
                  {registration?.samplesCollected || 0} / {registration?.samplesNeeded || 5} photos
                </div>
                <div style={styles.captureBar}>
                  <div
                    style={{
                      ...styles.captureBarFill,
                      width: `${((registration?.samplesCollected || 0) / (registration?.samplesNeeded || 5)) * 100}%`,
                    }}
                  />
                </div>
              </div>

              <p style={styles.hint}>
                Turn your head slightly for different angles
              </p>
            </>
          ) : (
            <>
              {/* Normal setup step */}
              <div style={styles.phoneIcon}>
                <svg width="60" height="80" viewBox="0 0 60 80" fill="none">
                  <rect x="5" y="5" width="50" height="70" rx="8" stroke="#4ecca3" strokeWidth="2" fill="none"/>
                  <circle cx="30" cy="65" r="5" stroke="#4ecca3" strokeWidth="2" fill="none"/>
                  <rect x="20" y="10" width="20" height="3" rx="1.5" fill="#4ecca3" opacity="0.5"/>
                </svg>
              </div>

              <h2 style={styles.cardTitle}>{currentStep.label}</h2>
              <p style={styles.cardDescription}>{currentStep.description}{dots}</p>

              <div style={styles.urlHint}>
                <p>Continue setup on your phone at:</p>
                <span style={styles.url}>http://skyglass.local/setup</span>
              </div>
            </>
          )}
        </div>

        {/* Step labels */}
        <div style={styles.stepLabels}>
          <span style={currentStep.step >= 2 ? styles.stepLabelActive : styles.stepLabel}>Airport</span>
          <span style={currentStep.step >= 3 ? styles.stepLabelActive : styles.stepLabel}>Location</span>
          <span style={currentStep.step >= 4 ? styles.stepLabelActive : styles.stepLabel}>Face</span>
          <span style={currentStep.step >= 5 ? styles.stepLabelActive : styles.stepLabel}>Done</span>
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
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center',
  },
  title: {
    fontSize: '1.8rem',
    fontWeight: 300,
    marginBottom: '2rem',
    color: '#fff',
  },
  progressContainer: {
    marginBottom: '2rem',
  },
  progressTrack: {
    height: '4px',
    background: '#222',
    borderRadius: '2px',
    marginBottom: '1rem',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #4ecca3, #00d9ff)',
    borderRadius: '2px',
    transition: 'width 0.5s ease',
  },
  progressSteps: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0 10px',
  },
  progressDot: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#222',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem',
    fontWeight: 600,
    transition: 'all 0.3s ease',
  },
  progressDotActive: {
    background: '#4ecca3',
    color: '#000',
  },
  progressDotComplete: {
    background: '#4ecca3',
    color: '#000',
  },
  card: {
    background: '#111',
    borderRadius: '24px',
    padding: '2.5rem',
    marginBottom: '1.5rem',
  },
  phoneIcon: {
    marginBottom: '1.5rem',
  },
  faceIcon: {
    marginBottom: '1rem',
  },
  cardTitle: {
    fontSize: '1.5rem',
    fontWeight: 500,
    marginBottom: '0.5rem',
    color: '#fff',
  },
  cardDescription: {
    color: '#888',
    fontSize: '1.1rem',
    marginBottom: '1.5rem',
  },
  urlHint: {
    background: '#1a1a1a',
    borderRadius: '12px',
    padding: '1rem',
  },
  url: {
    color: '#4ecca3',
    fontFamily: 'monospace',
    fontSize: '1rem',
  },
  captureProgress: {
    marginBottom: '1rem',
  },
  captureCount: {
    color: '#4ecca3',
    fontSize: '1.2rem',
    fontWeight: 600,
    marginBottom: '0.5rem',
  },
  captureBar: {
    height: '8px',
    background: '#222',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  captureBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #4ecca3, #00d9ff)',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  hint: {
    color: '#666',
    fontSize: '0.9rem',
  },
  stepLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0 10px',
  },
  stepLabel: {
    color: '#444',
    fontSize: '0.8rem',
  },
  stepLabelActive: {
    color: '#4ecca3',
    fontSize: '0.8rem',
    fontWeight: 500,
  },
};
