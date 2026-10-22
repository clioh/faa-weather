/**
 * Full-screen pairing code. When a phone asks to pair without scanning the
 * QR (POST /api/pairing/request), the backend sends local sockets a WS
 * `pairing` { state: 'show', code, deviceName, expiresAt }. The person at the
 * mirror reads the code and types it into the app, which proves they can see
 * this screen.
 *
 * Mounted beside <App /> (main.tsx), so it covers every screen, including
 * setup, provisioning, license and a mirror faded out for absence. It also
 * holds the physical display on while the code is up.
 */

import { useEffect, useRef, useState } from 'react';
import { useWsEvent } from './modules/useWsEvent';
import { groupCode, toEpochMs, type PairingEvent } from '../pairing';
import { SetupFrame } from './setup/SetupFrame';
import './Pairing.css';

type Result = 'paired' | 'failed' | 'expired';

type View =
  | { kind: 'code'; code: string; deviceName: string; expiresAt: number; total: number }
  | { kind: 'result'; result: Result; deviceName: string };

/** How long the outcome stays up before the overlay goes away. */
const RESULT_MS = 3500;
const LEAVE_MS = 450;
/** Fallback lifetime when the event carries no usable expiry (contract: 2 min). */
const DEFAULT_TTL_MS = 120_000;

const RESULT_COPY: Record<Result, { title: string; tone: 'positive' | 'neutral' }> = {
  paired: { title: 'Phone paired', tone: 'positive' },
  failed: { title: 'Pairing cancelled', tone: 'neutral' },
  expired: { title: 'Code expired', tone: 'neutral' },
};

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Wake the panel (and keep it on) for as long as the code is valid. */
function holdDisplay(ms: number) {
  const seconds = Math.min(600, Math.max(5, Math.ceil(ms / 1000) + 5));
  fetch('/api/display/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seconds }),
  }).catch(() => {
    // The overlay still renders; the panel may just be asleep.
  });
}

export function PairingCodeOverlay() {
  const [view, setViewState] = useState<View | null>(null);
  // Mirror of `view` for event handlers and timers.
  const viewRef = useRef<View | null>(null);
  const setView = (next: View | null) => {
    viewRef.current = next;
    setViewState(next);
  };
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dismissTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    dismissTimer.current = null;
    leaveTimer.current = null;
  };

  const showResult = (result: Result, deviceName: string) => {
    clearTimers();
    setLeaving(false);
    setView({ kind: 'result', result, deviceName });
    dismissTimer.current = window.setTimeout(() => {
      setLeaving(true);
      leaveTimer.current = window.setTimeout(() => {
        setView(null);
        setLeaving(false);
      }, LEAVE_MS);
    }, RESULT_MS);
  };

  useEffect(() => clearTimers, []);

  useWsEvent('pairing', (raw) => {
    const data = raw as PairingEvent | null;
    if (!data || typeof data !== 'object') return;

    if (data.state === 'show') {
      const code = String(data.code ?? '').trim();
      if (!code) return;
      const at = Date.now();
      let expiresAt = toEpochMs(data.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= at) expiresAt = at + DEFAULT_TTL_MS;
      clearTimers();
      setLeaving(false);
      setNow(at);
      setView({
        kind: 'code',
        code,
        deviceName: data.deviceName?.trim() || 'a phone',
        expiresAt,
        total: expiresAt - at,
      });
      holdDisplay(expiresAt - at);
      return;
    }

    if (data.state === 'hide') {
      // Only answer a request this screen is showing.
      const current = viewRef.current;
      if (current?.kind === 'code') {
        showResult(data.result ?? 'failed', data.deviceName || current.deviceName);
      }
    }
  });

  // Countdown, and local expiry in case the `hide` event never arrives.
  const codeExpiresAt = view?.kind === 'code' ? view.expiresAt : null;
  useEffect(() => {
    if (codeExpiresAt === null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= codeExpiresAt) {
        window.clearInterval(interval);
        const current = viewRef.current;
        if (current?.kind === 'code') showResult('expired', current.deviceName);
      }
    };
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
    // showResult only touches refs and state setters, so it is not a dependency.
  }, [codeExpiresAt]);

  if (!view) return null;

  const className = `pairing-overlay${leaving ? ' is-leaving' : ''}`;

  if (view.kind === 'result') {
    const copy = RESULT_COPY[view.result];
    return (
      <SetupFrame className={className}>
        <div
          className={`sg-center pairing-overlay__result tone-${copy.tone}`}
          role="status"
          aria-live="polite"
        >
          <div className="pairing-overlay__result-mark" aria-hidden="true">
            {view.result === 'paired' ? (
              <svg viewBox="0 0 48 48" width="100%" height="100%">
                <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M15 24.5l6 6 12-13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 48 48" width="100%" height="100%">
                <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M16 24h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </div>
          <h1 className="sg-headline pairing-overlay__title">{copy.title}</h1>
          {view.result === 'paired' && (
            <p className="sg-body">{view.deviceName} can now control this mirror.</p>
          )}
        </div>
      </SetupFrame>
    );
  }

  const remaining = Math.max(0, view.expiresAt - now);
  const fraction = view.total > 0 ? Math.min(1, remaining / view.total) : 0;
  const groups = groupCode(view.code);

  return (
    <SetupFrame
      className={className}
      topLeft={
        <div className="sg-kicker pairing-overlay__kicker">
          <span className="pairing-overlay__dot" aria-hidden="true" />
          Pairing request
        </div>
      }
      footLeft="Only someone at the mirror can see this code"
    >
      <div
        className="sg-center pairing-overlay__center"
        role="alertdialog"
        aria-live="assertive"
        aria-labelledby="pairing-title"
      >
        <h1 id="pairing-title" className="sg-headline pairing-overlay__title">
          Pair <span className="pairing-overlay__device">{view.deviceName}</span>?
        </h1>

        <div className="pairing-overlay__code" aria-label={`Code ${view.code.split('').join(' ')}`}>
          {groups.map((group, i) => (
            <span key={i} className="pairing-overlay__group">
              {group}
            </span>
          ))}
        </div>

        <p className="sg-body">Enter this code in the SkyGlass app</p>

        <div className="pairing-overlay__timer">
          <div className="sg-bar pairing-overlay__bar" aria-hidden="true">
            <i style={{ width: `${fraction * 100}%` }} />
          </div>
          <span className="sg-mono sg-faint pairing-overlay__remaining">
            Expires in {formatRemaining(remaining)}
          </span>
        </div>
      </div>
    </SetupFrame>
  );
}
