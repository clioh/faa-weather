/**
 * The mirror's connect QR. The link comes from GET /api/pairing/qr and
 * carries a single-use pairing secret, so the phone that scans it is paired
 * straight away; usePairingQr keeps it fresh across rotations.
 */

import { QRCodeSVG } from 'qrcode.react';
import { usePairingQr } from '../pairing';
import './Pairing.css';

interface PairingQrProps {
  /** QR edge length in px. */
  size?: number;
  /** Rendered instead of the QR while no link is available. */
  fallback?: React.ReactNode;
}

export function PairingQr({ size = 168, fallback = null }: PairingQrProps) {
  const qr = usePairingQr();
  if (!qr) return <>{fallback}</>;

  // `npm run dev:e2e` hands out an Expo Go link instead of skyglass://.
  const devBuild = qr.url.startsWith('exp://') || qr.url.startsWith('exps://');

  return (
    <div className="pairing-qr">
      <div className="pairing-qr__code">
        <QRCodeSVG value={qr.url} size={size} level="M" marginSize={0} />
      </div>
      <p className="pairing-qr__hint">Scan with your phone camera to pair</p>
      {devBuild && <p className="pairing-qr__dev">Development build · opens in Expo Go</p>}
    </div>
  );
}
