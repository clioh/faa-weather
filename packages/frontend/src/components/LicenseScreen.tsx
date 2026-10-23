/**
 * License screen
 *
 * Replaces the mirror UI once setup is complete whenever the license is in
 * any state other than active or disabled (docs/LICENSING.md, "Mirror").
 * Nothing here is interactive: the mirror is read from across the room, so
 * every state says what happened and what to do next on the phone or web.
 */

import { QRCodeSVG } from 'qrcode.react';
import { DEFAULT_MANAGE_URL, DEFAULT_SUPPORT_EMAIL, type LicenseStatus } from '../license';
import { SetupFrame } from './setup/SetupFrame';
import { StepList } from './setup/StepList';
import { useMirrorInfo } from './setup/useMirrorInfo';
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
  /** Working on it: a spinner sits next to the body. */
  busy?: boolean;
}

function copyFor(status: LicenseStatus, manageHost: string): StateCopy {
  switch (status.state) {
    case 'expired':
      return {
        tone: 'warning',
        eyebrow: 'Offline for over 30 days',
        title: 'Reconnect to verify',
        body: "SkyGlass checks its license online at least once a month. This mirror hasn't been able to reach skyglass.dev in that time.",
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
        body: 'The license on this mirror was released so it can run a different mirror. One license runs one mirror at a time.',
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
          busy: true,
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
  const { version } = useMirrorInfo();
  const supportEmail = status.supportEmail || DEFAULT_SUPPORT_EMAIL;
  const manageUrl = status.manageUrl || DEFAULT_MANAGE_URL;
  const manageHost = manageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const copy = copyFor(status, manageHost);
  const lastChecked = status.state === 'expired' ? formatLastChecked(status.lastCheckedAt) : null;
  const problem = copy.tone !== 'neutral';
  const body = <p className={problem ? 'sg-note' : 'sg-body'}>{copy.body}</p>;

  return (
    <SetupFrame
      className={`license-screen tone-${copy.tone}`}
      role="alert"
      footLeft={manageHost}
      footRight={version ? `v${version}` : null}
    >
      <div className="sg-main sg-main--top license-screen__main">
        <div className="sg-col">
          <div className="sg-kicker license-screen__kicker">{copy.eyebrow}</div>
          <h1 className="sg-headline">{copy.title}</h1>

          {copy.busy ? (
            <div className="license-screen__busy">
              <span className="sg-spin" aria-hidden="true" />
              {body}
            </div>
          ) : (
            body
          )}

          {(lastChecked || status.keyLast4 || copy.showSupport) && (
            <dl className="sg-facts license-screen__facts">
              {lastChecked && (
                <div>
                  <dt>Last verified</dt>
                  <dd>{lastChecked}</dd>
                </div>
              )}
              {status.keyLast4 && (
                <div>
                  <dt>License key</dt>
                  <dd>····-{status.keyLast4}</dd>
                </div>
              )}
              {copy.showSupport && (
                <div>
                  <dt>Support</dt>
                  <dd>{supportEmail}</dd>
                </div>
              )}
            </dl>
          )}

          <p className="license-screen__waiting">
            This screen clears on its own once the license is active.
          </p>
        </div>

        <div className="sg-col license-screen__side">
          <StepList long items={copy.steps.map((step) => ({ key: step, label: step }))} />

          <div className="license-screen__qr">
            <div className="sg-qr sg-qr--small">
              <QRCodeSVG value={manageUrl} size={243} level="M" />
            </div>
            <span className="sg-mono sg-faint">{manageHost}</span>
          </div>
        </div>
      </div>
    </SetupFrame>
  );
}
