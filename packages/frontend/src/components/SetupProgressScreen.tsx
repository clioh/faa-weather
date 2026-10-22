import { useState, useEffect } from 'react';
import { PairingQr } from './PairingQr';
import type { LicenseStatus } from '../license';

interface SetupStatus {
  configExists: boolean;
  /** Always true when licensing is disabled. */
  licenseActivated: boolean;
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
  /** Current license status, to explain a key that failed to activate. */
  license?: LicenseStatus | null;
  onSetupComplete?: () => void;
}

/**
 * The steps the mirror shows, in setup order. WiFi comes first in the phone
 * app but isn't listed here: the mirror is online if it shows this screen.
 */
const STEPS = [
  { id: 'license', label: 'License' },
  { id: 'location', label: 'Location' },
  { id: 'airport', label: 'Airport' },
  { id: 'face', label: 'Face' },
] as const;

/** Extra line for the license step when a key exists but isn't usable here. */
function licenseProblem(license: LicenseStatus | null | undefined): string | null {
  // Kits: the pre-installed key activates on its own once the mirror is online.
  if (license?.state === 'unlicensed' && license.keyFilePending) {
    return license.message ?? 'Activating the pre-installed license…';
  }
  switch (license?.state) {
    case 'bound_elsewhere':
      return 'This key is active on another mirror. Release it at skyglass.dev/license, or enter a different key.';
    case 'released':
      return 'This license was released from this mirror. Enter the key again to bring it back.';
    case 'revoked':
      return 'This license was revoked. Enter a different key.';
    case 'expired':
      return 'The mirror needs internet access to verify its license.';
    default:
      return null;
  }
}

export function SetupProgressScreen({ license, onSetupComplete }: SetupProgressScreenProps) {
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

  // Licensing switched off (SKYGLASS_LICENSE=off, local development): the
  // License step is always satisfied, so don't list it, matching the phone.
  const steps = license?.state === 'disabled' ? STEPS.filter((s) => s.id !== 'license') : STEPS;
  /** 1-based position of a step in the visible list. */
  const stepNumber = (id: (typeof STEPS)[number]['id']) =>
    steps.findIndex((s) => s.id === id) + 1;

  // Determine current step (1-based index into steps; steps.length + 1 = done)
  const getCurrentStep = (): {
    step: number;
    label: string;
    description: string;
    detail?: string | null;
    isFaceRegistration?: boolean;
  } => {
    if (!status) return { step: 1, label: 'Loading', description: '' };

    if (registration?.active) {
      return {
        step: stepNumber('face'),
        label: 'Face Registration',
        description: 'Look at the camera',
        isFaceRegistration: true,
      };
    }

    if (!status.licenseActivated) {
      return {
        step: stepNumber('license'),
        label: 'Activate Your License',
        description: license?.keyFilePending
          ? 'Your pre-installed license activates automatically'
          : 'Enter your license key in the SkyGlass app',
        detail: licenseProblem(license),
      };
    }

    if (!status.locationConfigured) {
      return {
        step: stepNumber('location'),
        label: 'Location Setup',
        description: 'Configure on your phone',
      };
    }

    if (!status.airportConfigured) {
      return {
        step: stepNumber('airport'),
        label: 'Airport Setup',
        description: 'Configure on your phone',
      };
    }

    if (!status.faceEnrolled) {
      return {
        step: stepNumber('face'),
        label: 'Face Registration',
        description: 'Ready when you are',
      };
    }

    return {
      step: steps.length + 1,
      label: 'Setup Complete',
      description: 'Starting mirror...',
    };
  };

  const currentStep = getCurrentStep();
  const progress = ((currentStep.step - 1) / steps.length) * 100;

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
            {steps.map((_, index) => index + 1).map((step) => (
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
              {currentStep.detail && (
                <p style={styles.cardDetail}>{currentStep.detail}</p>
              )}

              {/* Connect QR with a one-time pairing secret (GET /api/pairing/qr);
                  in `npm run dev:e2e` it opens the Expo dev build instead. */}
              <div style={styles.pairQr}>
                <PairingQr
                  size={168}
                  fallback={
                    <div style={styles.urlHint}>
                      <p>Continue setup in the SkyGlass app on your phone.</p>
                    </div>
                  }
                />
              </div>
            </>
          )}
        </div>

        {/* Step labels, one under each dot */}
        <div style={styles.stepLabels}>
          {steps.map((step, index) => (
            <span
              key={step.id}
              style={currentStep.step >= index + 1 ? styles.stepLabelActive : styles.stepLabel}
            >
              {step.label}
            </span>
          ))}
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
  cardDetail: {
    color: '#ffb74d',
    fontSize: '1rem',
    lineHeight: 1.5,
    margin: '-0.5rem 0 1.5rem',
  },
  pairQr: {
    marginTop: '1.5rem',
    display: 'flex',
    justifyContent: 'center',
  },
  urlHint: {
    background: '#1a1a1a',
    borderRadius: '12px',
    padding: '1rem',
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
    // Same width as a progress dot so each label centres under its dot
    width: '32px',
    display: 'flex',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
  },
  stepLabelActive: {
    color: '#4ecca3',
    fontSize: '0.8rem',
    // Same width as a progress dot so each label centres under its dot
    width: '32px',
    display: 'flex',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
};
