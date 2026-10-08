/**
 * Face Registration Overlay
 *
 * A beautiful, full-screen registration experience that guides the user
 * through capturing face samples while syncing with the mobile app.
 */

import { useEffect, useState } from 'react';

interface RegistrationState {
  active: boolean;
  presenceServerUrl: string | null;
  samplesCollected: number;
  samplesNeeded: number;
  userName?: string;
  currentInstruction?: string;
  action?: string;
}

// Guided instructions for each capture
const CAPTURE_INSTRUCTIONS = [
  { text: 'Look straight at the mirror', icon: '👤' },
  { text: 'Turn your head slightly left', icon: '👈' },
  { text: 'Turn your head slightly right', icon: '👉' },
  { text: 'Tilt your head up a little', icon: '👆' },
  { text: 'Now smile naturally', icon: '😊' },
];

export function RegistrationOverlay() {
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [phase, setPhase] = useState<'waiting' | 'capturing' | 'captured' | 'complete'>('waiting');
  const [showFlash, setShowFlash] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [presenceServerUrl, setPresenceServerUrl] = useState<string | null>(null);

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

  const videoStreamUrl = presenceServerUrl
    ? `${presenceServerUrl}/video_feed`
    : `http://${window.location.hostname}:5000/video_feed`;

  // Complete state - celebration!
  if (phase === 'complete') {
    return (
      <div className="registration-overlay">
        <div className="celebration">
          <div className="confetti-container">
            {[...Array(50)].map((_, i) => (
              <div
                key={i}
                className="confetti"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 2}s`,
                  backgroundColor: ['#4ecca3', '#45b7aa', '#ffd700', '#ff6b6b', '#4ecdc4'][Math.floor(Math.random() * 5)],
                }}
              />
            ))}
          </div>

          <div className="success-content">
            <div className="success-icon-container">
              <div className="success-circle" />
              <div className="success-check">✓</div>
            </div>
            <h1>Welcome{registration?.userName ? `, ${registration.userName}` : ''}!</h1>
            <p>Your face has been registered successfully</p>
            <p className="subtitle">The mirror will now recognize you automatically</p>
          </div>
        </div>

        <style>{celebrationStyles}</style>
      </div>
    );
  }

  return (
    <div className="registration-overlay">
      {/* Flash effect on capture */}
      {showFlash && <div className="capture-flash" />}

      {/* Main content */}
      <div className="registration-content">
        {/* Header */}
        <div className="header">
          <h1>Face Registration</h1>
          {registration?.userName && (
            <p className="user-name">Setting up for {registration.userName}</p>
          )}
        </div>

        {/* Camera section - hero */}
        <div className="camera-hero">
          <div className="camera-container">
            <img
              src={videoStreamUrl}
              alt="Camera feed"
              className="camera-feed"
            />

            {/* Animated face guide */}
            <div className={`face-guide ${phase === 'captured' ? 'pulse-success' : ''}`}>
              <svg viewBox="0 0 200 260" className="face-outline">
                <ellipse
                  cx="100"
                  cy="120"
                  rx="70"
                  ry="90"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray="10,5"
                  className="face-ellipse"
                />
                {/* Crosshairs */}
                <line x1="100" y1="20" x2="100" y2="40" stroke="currentColor" strokeWidth="2" />
                <line x1="100" y1="200" x2="100" y2="220" stroke="currentColor" strokeWidth="2" />
                <line x1="20" y1="120" x2="40" y2="120" stroke="currentColor" strokeWidth="2" />
                <line x1="160" y1="120" x2="180" y2="120" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>

            {/* Countdown overlay */}
            {countdown !== null && countdown > 0 && (
              <div className="countdown-overlay">
                <span className="countdown-number">{countdown}</span>
              </div>
            )}
          </div>
        </div>

        {/* Instruction */}
        <div className="instruction-section">
          <div className="instruction-icon">{currentInstruction.icon}</div>
          <p className="instruction-text">{currentInstruction.text}</p>
        </div>

        {/* Progress */}
        <div className="progress-section">
          <div className="progress-dots">
            {[...Array(registration?.samplesNeeded || 5)].map((_, i) => (
              <div
                key={i}
                className={`progress-dot ${i < (registration?.samplesCollected || 0) ? 'filled' : ''} ${i === (registration?.samplesCollected || 0) ? 'current' : ''}`}
              />
            ))}
          </div>
          <p className="progress-text">
            {registration?.samplesCollected || 0} of {registration?.samplesNeeded || 5} photos captured
          </p>
        </div>

        {/* Footer hint */}
        <div className="footer-hint">
          <p>Use your phone to capture each photo</p>
          <div className="phone-icon">📱</div>
        </div>
      </div>

      <style>{mainStyles}</style>
    </div>
  );
}

const mainStyles = `
  .registration-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fadeIn 0.5s ease;
    overflow: hidden;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .capture-flash {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: white;
    animation: flash 0.3s ease-out;
    pointer-events: none;
    z-index: 10000;
  }

  @keyframes flash {
    0% { opacity: 0.8; }
    100% { opacity: 0; }
  }

  .registration-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 800px;
    padding: 40px;
  }

  .header {
    text-align: center;
    margin-bottom: 30px;
  }

  .header h1 {
    font-size: 2.5rem;
    font-weight: 300;
    color: #fff;
    margin: 0;
    letter-spacing: 0.05em;
  }

  .user-name {
    color: #4ecca3;
    font-size: 1.2rem;
    margin-top: 10px;
  }

  .camera-hero {
    width: 100%;
    max-width: 500px;
    margin-bottom: 30px;
  }

  .camera-container {
    position: relative;
    background: #000;
    border-radius: 20px;
    overflow: hidden;
    aspect-ratio: 4/3;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .camera-feed {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .face-guide {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 200px;
    height: 260px;
    transform: translate(-50%, -50%);
    color: rgba(78, 204, 163, 0.7);
    transition: all 0.3s ease;
  }

  .face-guide.pulse-success {
    animation: pulseSuccess 0.5s ease;
  }

  @keyframes pulseSuccess {
    0%, 100% { transform: translate(-50%, -50%) scale(1); color: rgba(78, 204, 163, 0.7); }
    50% { transform: translate(-50%, -50%) scale(1.1); color: rgba(78, 204, 163, 1); }
  }

  .face-outline {
    width: 100%;
    height: 100%;
  }

  .face-ellipse {
    animation: dashedRotate 20s linear infinite;
  }

  @keyframes dashedRotate {
    to { stroke-dashoffset: 100; }
  }

  .countdown-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .countdown-number {
    font-size: 8rem;
    font-weight: 200;
    color: #4ecca3;
    animation: countPulse 1s ease infinite;
  }

  @keyframes countPulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.8; }
  }

  .instruction-section {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 30px;
    padding: 15px 30px;
    background: rgba(78, 204, 163, 0.1);
    border-radius: 50px;
    border: 1px solid rgba(78, 204, 163, 0.3);
  }

  .instruction-icon {
    font-size: 2rem;
  }

  .instruction-text {
    font-size: 1.3rem;
    color: #fff;
    margin: 0;
  }

  .progress-section {
    text-align: center;
    margin-bottom: 30px;
  }

  .progress-dots {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 15px;
  }

  .progress-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.3);
    transition: all 0.3s ease;
  }

  .progress-dot.filled {
    background: #4ecca3;
    border-color: #4ecca3;
    box-shadow: 0 0 10px rgba(78, 204, 163, 0.5);
  }

  .progress-dot.current {
    border-color: #4ecca3;
    animation: pulse 1.5s ease infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(78, 204, 163, 0.4); }
    50% { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(78, 204, 163, 0); }
  }

  .progress-text {
    color: #888;
    font-size: 1rem;
    margin: 0;
  }

  .footer-hint {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #666;
    font-size: 1rem;
  }

  .phone-icon {
    font-size: 1.5rem;
    animation: phoneBounce 2s ease infinite;
  }

  @keyframes phoneBounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }
`;

const celebrationStyles = `
  .registration-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    overflow: hidden;
  }

  .celebration {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .confetti-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .confetti {
    position: absolute;
    top: -20px;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    animation: confettiFall 4s ease-out forwards;
  }

  @keyframes confettiFall {
    0% {
      transform: translateY(0) rotate(0deg);
      opacity: 1;
    }
    100% {
      transform: translateY(100vh) rotate(720deg);
      opacity: 0;
    }
  }

  .success-content {
    text-align: center;
    animation: scaleIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes scaleIn {
    0% { transform: scale(0); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  .success-icon-container {
    position: relative;
    width: 150px;
    height: 150px;
    margin: 0 auto 40px;
  }

  .success-circle {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: linear-gradient(135deg, #4ecca3 0%, #45b7aa 100%);
    animation: circleGrow 0.5s ease-out 0.2s both;
  }

  @keyframes circleGrow {
    0% { transform: scale(0); }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }

  .success-check {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 5rem;
    color: #fff;
    animation: checkPop 0.4s ease-out 0.5s both;
  }

  @keyframes checkPop {
    0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
    50% { transform: translate(-50%, -50%) scale(1.3); }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  }

  .success-content h1 {
    font-size: 3rem;
    font-weight: 300;
    color: #fff;
    margin: 0 0 15px;
    animation: slideUp 0.5s ease-out 0.7s both;
  }

  .success-content p {
    font-size: 1.3rem;
    color: #4ecca3;
    margin: 0 0 10px;
    animation: slideUp 0.5s ease-out 0.8s both;
  }

  .success-content .subtitle {
    font-size: 1rem;
    color: #888;
    animation: slideUp 0.5s ease-out 0.9s both;
  }

  @keyframes slideUp {
    0% { transform: translateY(20px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
`;
