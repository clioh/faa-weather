/**
 * Face Registration Overlay
 *
 * Full-screen registration experience that guides the user through
 * capturing face samples while syncing with the mobile app. Layout:
 * FaceCapture (M-Face-L/P); completion: M-Welcome-L/P.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Live framing / pose guidance from the presence server; null when idle. */
  guidance?: Guidance | null;
}

type GuidanceReason =
  | 'no_face'
  | 'multiple'
  | 'too_far'
  | 'off_centre'
  | 'turn_more'
  | 'other_way'
  | 'hold'
  | 'cooldown';

interface Guidance {
  reason: GuidanceReason;
  /** Length of the steadiness timer when reason is 'hold', else 0. */
  holdMs: number;
}

/** Ring length when a hold arrives without holdMs (HOLD_SECONDS on the presence server). */
const DEFAULT_HOLD_MS = 1000;

// Guided instructions for each capture
const CAPTURE_INSTRUCTIONS = [
  'Look straight at the mirror',
  'Turn your head slightly left',
  'Turn your head slightly right',
  'Tilt your head up a little',
  'Now smile naturally',
];

/**
 * Hint under the instruction for a guidance reason (same table as the phone).
 * `step` is samplesCollected, the index of the current instruction.
 */
function guidanceHint(reason: GuidanceReason | undefined, step: number): string | null {
  switch (reason) {
    case 'no_face':
      return 'Step in front of the mirror';
    case 'multiple':
      return 'Only one person, please';
    case 'too_far':
      return 'Move a little closer';
    case 'off_centre':
      return 'Centre your face in the outline';
    case 'turn_more':
      if (step === 1 || step === 2) return 'Turn a little further';
      if (step === 3) return 'Tilt up a little further';
      if (step === 4) return 'A bigger smile';
      return null;
    case 'other_way':
      return 'Now turn the other way';
    case 'hold':
      return 'Hold still';
    default:
      // cooldown: the next instruction is the cue.
      return null;
  }
}

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
  // Running hold ring; a new key restarts it.
  const [hold, setHold] = useState<{ key: number; ms: number } | null>(null);
  const lastReasonRef = useRef<GuidanceReason | null>(null);
  // Drawn once, so the pieces don't jump on every poll.
  const [confetti] = useState(makeConfetti);
  const mirror = useMirrorInfo();

  // Determine current instruction based on samples collected
  const currentInstruction = registration
    ? CAPTURE_INSTRUCTIONS[Math.min(registration.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)]
    : CAPTURE_INSTRUCTIONS[0];

  // Starts the ring when a hold begins (every 'guidance' hold event, or a
  // poll that sees the change first) and clears it when the reason moves on.
  const applyGuidance = useCallback((guidance: Guidance | null | undefined, holdEvent: boolean) => {
    const reason = guidance?.reason ?? null;
    if (reason !== 'hold') {
      setHold(null);
    } else if (holdEvent || lastReasonRef.current !== 'hold') {
      const ms = guidance?.holdMs || DEFAULT_HOLD_MS;
      setHold((prev) => ({ key: (prev?.key ?? 0) + 1, ms }));
    }
    lastReasonRef.current = reason;
  }, []);

  // Poll registration state
  useEffect(() => {
    const checkRegistration = async () => {
      try {
        const res = await fetch('/api/registration');
        const data = (await res.json()) as RegistrationState;
        setRegistration(data);
        applyGuidance(data.guidance, false);

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
  }, [applyGuidance]);

  // Listen for WebSocket updates
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001`);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'registration') {
          const data = message.data as RegistrationState;
          setRegistration(data);
          applyGuidance(data.guidance, data.action === 'guidance');

          if (data.action === 'capture-start') {
            // Start countdown
            setCountdown(3);
          } else if (data.action === 'captured') {
            // Show flash effect; the ring is done.
            setHold(null);
            setShowFlash(true);
            setPhase('captured');
            setTimeout(() => {
              setShowFlash(false);
              // The last photo's 'completed' lands inside this window; keep its welcome.
              setPhase((p) => (p === 'captured' ? 'capturing' : p));
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
  }, [applyGuidance]);

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

  const samplesCollected = registration?.samplesCollected || 0;
  const reason = registration?.guidance?.reason;

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
          <p className="sg-body registration-welcome__lead">
            Your face has been registered successfully
          </p>
          <p className="sg-body">The mirror will now recognize you automatically</p>
        </div>
      </SetupFrame>
    );
  }

  return (
    <FaceCapture
      instruction={currentInstruction}
      userName={registration?.userName}
      samplesCollected={samplesCollected}
      samplesNeeded={registration?.samplesNeeded || 5}
      body="The mirror takes each photo when you hold still"
      hint={guidanceHint(reason, samplesCollected)}
      hintActive={reason === 'hold'}
      videoStreamUrl={videoStreamUrl}
      countdown={countdown}
      pulse={phase === 'captured'}
      hold={hold}
      overlay={showFlash && <div className="face-capture__flash" />}
    />
  );
}
