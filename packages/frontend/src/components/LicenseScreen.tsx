/**
 * License screen
 *
 * Replaces the mirror UI once setup is complete whenever the license is in
 * any state other than active or disabled (docs/LICENSING.md, "Mirror").
 * Nothing here is interactive: the mirror is read from across the room, so
 * every state says what happened and what to do next on the phone or web.
 */

import { QRCodeSVG } from 'qrcode.react';
import {
  DEFAULT_MANAGE_URL,
  DEFAULT_SUPPORT_EMAIL,
  type LicenseStatus,
} from '../license';
import './LicenseScreen.css';

type Tone = 'neutral' | 'warning' | 'alert';

interface StateCopy {
  tone: Tone;
  eyebrow: string;
  title: string;
  body: string;
  /** Ordered next steps. */
  steps: string[];
  showSupport?: boolean;
}

function copyFor(status: LicenseStatus, manageHost: string): StateCopy {
  switch (status.state) {
    case 'expired':
      return {
        tone: 'warning',
        eyebrow: 'Offline for over 30 days',
        title: 'Reconnect to verify',
        body:
          "SkyGlass checks its license online at least once a month. This mirror hasn't been able to reach skyglass.dev in that time.",
        steps: [
          'Connect the mirror to the internet. It verifies on its own within a few minutes.',
          'To change networks, open the SkyGlass app on your phone and go to Settings › WiFi Network.',
        ],
      };
    case 'released':
      return {
        tone: 'neutral',
        eyebrow: 'License moved',
        title: 'This license was released',
        body:
          'The license on this mirror was released so it can run a different mirror. One license runs one mirror at a time.',
        steps: [
          'To bring it back here, open the SkyGlass app and enter the key again in Settings › License.',
          `Or use a different key. Manage your licenses at ${manageHost}.`,
        ],
      };
    case 'revoked':
      return {
        tone: 'alert',
        eyebrow: 'License revoked',
        title: 'This license is no longer valid',
        body: 'The license was revoked, usually after a refund or a payment dispute.',
        steps: [
          'Enter a different key in the SkyGlass app under Settings › License.',
          "If you think this is a mistake, contact support and we'll sort it out.",
        ],
        showSupport: true,
      };
    case 'bound_elsewhere':
      return {
        tone: 'alert',
        eyebrow: 'In use on another mirror',
        title: 'This key belongs to another mirror',
        body: 'The license key saved on this mirror is already activated on a different mirror.',
        steps: [
          `Release it from the other mirror at ${manageHost}.`,
          'Then enter the key again in the SkyGlass app under Settings › License, or enter a different key.',
        ],
        showSupport: true,
      };
    case 'unlicensed':
    default:
      if (status.keyFilePending) {
        return {
          tone: 'neutral',
          eyebrow: 'Pre-installed license',
          title: 'Activating SkyGlass',
          body: status.message ?? 'Activating the pre-installed license…',
          steps: [
            'This happens on its own as soon as the mirror is online.',
            'To change networks, open the SkyGlass app on your phone and go to Settings › WiFi Network.',
          ],
        };
      }
      return {
        tone: 'neutral',
        eyebrow: 'License needed',
        title: 'Activate SkyGlass',
        body: 'This mirror needs a license key to run.',
        steps: [
          'Open the SkyGlass app on your phone and go to Settings › License.',
          'Enter the key from your purchase email. Kits activate on their own once online.',
          `Lost your key? Have it re-sent from ${manageHost}.`,
        ],
      };
  }
}

function formatLastChecked(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  const when = date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  if (days <= 0) return `today, ${when}`;
  return `${days} day${days === 1 ? '' : 's'} ago (${when})`;
}

interface LicenseScreenProps {
  status: LicenseStatus;
}

export function LicenseScreen({ status }: LicenseScreenProps) {
  const supportEmail = status.supportEmail || DEFAULT_SUPPORT_EMAIL;
  const manageUrl = status.manageUrl || DEFAULT_MANAGE_URL;
  const manageHost = manageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const copy = copyFor(status, manageHost);
  const lastChecked = status.state === 'expired' ? formatLastChecked(status.lastCheckedAt) : null;

  return (
    <div className={`license-screen tone-${copy.tone}`} role="alert">
      <div className="license-screen__content">
        <div className="license-screen__eyebrow">
          <span className="license-screen__dot" aria-hidden="true" />
          {copy.eyebrow}
        </div>

        <h1 className="license-screen__title">{copy.title}</h1>
        <p className="license-screen__body">{copy.body}</p>

        {(lastChecked || status.keyLast4) && (
          <dl className="license-screen__facts">
            {lastChecked && (
              <div>
                <dt>Last verified</dt>
                <dd>{lastChecked}</dd>
              </div>
            )}
            {status.keyLast4 && (
              <div>
                <dt>License key</dt>
                <dd className="mono">····-{status.keyLast4}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="license-screen__next">
          <ol className="license-screen__steps">
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <div className="license-screen__qr">
            <div className="license-screen__qr-code">
              <QRCodeSVG value={manageUrl} size={132} level="M" />
            </div>
            <span className="mono">{manageHost}</span>
          </div>
        </div>

        {copy.showSupport && (
          <p className="license-screen__support">
            Support: <span className="mono">{supportEmail}</span>
          </p>
        )}

        <div className="license-screen__waiting">
          <span className="license-screen__pulse" aria-hidden="true" />
          This screen clears on its own once the license is active.
        </div>
      </div>
    </div>
  );
}
