/**
 * Face Registration Overlay
 *
 * Full-screen registration experience that guides the user through
 * capturing face samples while syncing with the mobile app. Layout:
 * FaceCapture (M-Face-L/P); completion: M-Welcome-L/P.
 */

import { useEffect, useState } from 'react';
import { FaceCapture } from './FaceCapture';
import { LogoMark } from './setup/LogoMark';
import { SetupFrame } from './setup/SetupFrame';
import { useMirrorInfo } from './setup/useMirrorInfo';
import './RegistrationOverlay.css';

interface RegistrationState {
  active: boolean;
  presenceServerUrl: string | null;
  /** Short-lived token of the active enrollment session; the only key to /video_feed. */
  enrollmentToken?: string | null;
  samplesCollected: number;
  samplesNeeded: number;
  userName?: string;
  currentInstruction?: string;
  action?: string;
}

// Guided instructions for each capture
const CAPTURE_INSTRUCTIONS = [
  'Look straight at the mirror',
  'Turn your head slightly left',
  'Turn your head slightly right',
  'Tilt your head up a little',
  'Now smile naturally',
];

/** Confetti on the welcome screen: sky blue and white only. */
const CONFETTI_COLORS = ['var(--color-accent)', 'var(--color-accent-dim)', '#ffffff'];

function makeConfetti() {
  return Array.from({ length: 50 }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 2,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  }));
}

export function RegistrationOverlay() {
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [phase, setPhase] = useState<'waiting' | 'capturing' | 'captured' | 'complete'>('waiting');
  const [showFlash, setShowFlash] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [presenceServerUrl, setPresenceServerUrl] = useState<string | null>(null);
  // Drawn once, so the pieces don't jump on every poll.
  const [confetti] = useState(makeConfetti);
  const mirror = useMirrorInfo();

  // Determine current instruction based on samples collected
  const currentInstruction = registration
    ? CAPTURE_INSTRUCTIONS[Math.min(registration.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)]
    : CAPTURE_INSTRUCTIONS[0];

  // Poll registration state
  useEffect(() => {
    const checkRegistration = async () => {
      try {
        const res = await fetch('/api/registration');
        const data = await res.json();
        setRegistration(data);

        if (data.presenceServerUrl) {
          setPresenceServerUrl(data.presenceServerUrl);
        }
      } catch (e) {
        console.error('Failed to check registration state:', e);
      }
    };

    checkRegistration();
    const interval = setInterval(checkRegistration, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for WebSocket updates
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001`);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'registration') {
          const data = message.data as RegistrationState;
          setRegistration(data);

          if (data.action === 'capture-start') {
            // Start countdown
            setCountdown(3);
          } else if (data.action === 'captured') {
            // Show flash effect
            setShowFlash(true);
            setPhase('captured');
            setTimeout(() => {
              setShowFlash(false);
              setPhase('capturing');
            }, 500);
          } else if (data.action === 'completed') {
            setPhase('complete');
          }
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    return () => ws.close();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (countdown === null) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCountdown(null);
      setPhase('capturing');
    }
  }, [countdown]);

  // Don't render if registration is not active
  if (!registration?.active && phase !== 'complete') {
    return null;
  }

  // The presence server only streams during an enrollment session, with that
  // session's token (docs/SECURITY.md). No token, no stream.
  const enrollmentToken = registration?.enrollmentToken ?? null;
  const videoStreamUrl = enrollmentToken
    ? `${presenceServerUrl ?? `http://${window.location.hostname}:5000`}/video_feed?token=${encodeURIComponent(enrollmentToken)}`
    : null;

  // Complete state - celebration!
  if (phase === 'complete') {
    return (
      <SetupFrame
        className="registration-welcome"
        topLeft={null}
        footRight={mirror.version ? `v${mirror.version}` : null}
      >
        <div className="registration-welcome__confetti" aria-hidden="true">
          {confetti.map((piece, i) => (
            <div
              key={i}
              className="registration-welcome__piece"
              style={{
                left: `${piece.left}%`,
                animationDelay: `${piece.delay}s`,
                backgroundColor: piece.color,
              }}
            />
          ))}
        </div>

        <div className="sg-center registration-welcome__content">
          <LogoMark className="registration-welcome__mark" />
          <h1 className="sg-headline registration-welcome__headline">
            Welcome{registration?.userName ? `, ${registration.userName}` : ''}!
          </h1>
          <p className="sg-body registration-welcome__lead">Your face has been registered successfully</p>
          <p className="sg-body">The mirror will now recognize you automatically</p>
        </div>
      </SetupFrame>
    );
  }

  return (
    <FaceCapture
      instruction={currentInstruction}
      userName={registration?.userName}
      samplesCollected={registration?.samplesCollected || 0}
      samplesNeeded={registration?.samplesNeeded || 5}
      body="Use your phone to capture each photo"
      videoStreamUrl={videoStreamUrl}
      countdown={countdown}
      pulse={phase === 'captured'}
      overlay={showFlash && <div className="face-capture__flash" />}
    />
  );
}
