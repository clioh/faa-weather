/**
 * The mirror's connect QR. The link comes from GET /api/pairing/qr and
 * carries a single-use pairing secret, so the phone that scans it is paired
 * straight away; usePairingQr keeps it fresh across rotations.
 *
 * In production it is https://skyglass.dev/connect#...: the system camera
 * opens the app when it is installed (Universal Links / App Links) and the
 * connect page with the store buttons when it is not.
 */

import type { ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { usePairingQr } from '../pairing';
import './setup/SetupLayout.css';

interface PairingQrProps {
  /** Caption under the code. */
  caption?: ReactNode;
  /** Rendered instead of the QR while no link is available. */
  fallback?: ReactNode;
}

export function PairingQr({
  caption = 'Scan with your phone camera to pair',
  fallback = null,
}: PairingQrProps) {
  const qr = usePairingQr();
  if (!qr) return <>{fallback}</>;

  // `npm run dev:e2e` hands out an Expo Go (exp://) or USB build (skyglass://)
  // link instead of the web link, which only works with the app installed.
  const devBuild = qr.url.startsWith('exp://') || qr.url.startsWith('exps://');
  const webLink = qr.url.startsWith('https://') || qr.url.startsWith('http://');

  return (
    <div className="sg-pairing-qr">
      {/* Drawn at 1080p size; .sg-qr scales it with the panel. */}
      <div className="sg-qr" role="img" aria-label="QR code that pairs your phone with this mirror">
        <QRCodeSVG value={qr.url} size={336} level="M" marginSize={0} />
      </div>
      {caption && <p className="sg-caption">{caption}</p>}
      {webLink && <p className="sg-caption sg-faint">No app yet? The link takes you to it.</p>}
      {devBuild && (
        <p className="sg-caption sg-faint sg-mono">Development build · opens in Expo Go</p>
      )}
    </div>
  );
}
