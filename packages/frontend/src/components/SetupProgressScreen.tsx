import { useState, useEffect } from 'react';
import { PairingQr } from './PairingQr';
import { RegistrationOverlay } from './RegistrationOverlay';
import { SetupFrame } from './setup/SetupFrame';
import { StepList, type StepListItem } from './setup/StepList';
import { useMirrorInfo } from './setup/useMirrorInfo';
import './SetupProgressScreen.css';
import type { LicenseStatus } from '../license';

interface SetupStatus {
  configExists: boolean;
  orientationConfigured: boolean;
  /** Always true when licensing is disabled. */
  licenseActivated: boolean;
  faceEnrolled: boolean;
  airportConfigured: boolean;
  locationConfigured: boolean;
  setupComplete: boolean;
}

interface RegistrationStatus {
  active: boolean;
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
  { id: 'orientation', label: 'Orientation' },
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
  const mirror = useMirrorInfo();

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
        label: 'Face registration',
        description: 'Look at the camera',
        isFaceRegistration: true,
      };
    }

    if (!status.orientationConfigured) {
      return {
        step: stepNumber('orientation'),
        label: 'Orientation setup',
        description: 'Configure on your phone',
      };
    }

    if (!status.licenseActivated) {
      return {
        step: stepNumber('license'),
        label: 'Activate your license',
        description: license?.keyFilePending
          ? 'Your pre-installed license activates automatically'
          : 'Enter your license key in the SkyGlass app',
        detail: licenseProblem(license),
      };
    }

    if (!status.locationConfigured) {
      return {
        step: stepNumber('location'),
        label: 'Location setup',
        description: 'Configure on your phone',
      };
    }

    if (!status.airportConfigured) {
      return {
        step: stepNumber('airport'),
        label: 'Airport setup',
        description: 'Configure on your phone',
      };
    }

    if (!status.faceEnrolled) {
      return {
        step: stepNumber('face'),
        label: 'Face registration',
        description: 'Ready when you are',
      };
    }

    return {
      step: steps.length + 1,
      label: 'Setup complete',
      description: 'Starting mirror',
    };
  };

  const currentStep = getCurrentStep();

  // App shows the overlay on the session's WS events; this covers a reload
  // mid-session, before the next event arrives. Same screen either way.
  if (currentStep.isFaceRegistration) {
    return <RegistrationOverlay />;
  }

  // Set by OrientationFrame on <html>.
  const orientation = document.documentElement.dataset.orientation;
  const orientationNote =
    orientation === 'portrait' ? 'Portrait' : orientation === 'landscape' ? 'Landscape' : null;

  const stepItems: StepListItem[] = steps.map((step, index) => {
    const state = index + 1 < currentStep.step ? 'done' : index + 1 === currentStep.step ? 'now' : 'todo';
    return {
      key: step.id,
      label: step.label,
      state,
      note: step.id === 'orientation' && state === 'done' ? orientationNote : null,
    };
  });

  const phoneCaption = 'Continue setup in the SkyGlass app on your phone.';

  return (
    <SetupFrame
      topRight={mirror.name}
      footLeft="skyglass.local"
      footRight={mirror.version ? `v${mirror.version}` : null}
    >
      <div className="sg-main">
        <div className="sg-col">
          <div className="sg-kicker">Setting up your mirror</div>
          <h1 className="sg-headline">{currentStep.label}</h1>
          {currentStep.description && (
            <p className="sg-body">
              {currentStep.description}
              <span className="setup-progress__dots">{dots}</span>
            </p>
          )}
          {currentStep.detail && <p className="sg-note">{currentStep.detail}</p>}
          <div className="setup-progress__steps">
            <StepList items={stepItems} />
          </div>
        </div>

        {/* Connect QR with a one-time pairing secret (GET /api/pairing/qr);
            in `npm run dev:e2e` it opens the Expo dev build instead. */}
        <div className="sg-panel sg-first">
          <PairingQr caption={phoneCaption} fallback={<p className="sg-caption">{phoneCaption}</p>} />
        </div>
      </div>
    </SetupFrame>
  );
}
