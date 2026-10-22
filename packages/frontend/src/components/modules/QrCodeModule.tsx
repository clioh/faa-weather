/**
 * QR code — a link or Wi-Fi string as a scannable code, drawn white on the
 * black ground (phone cameras read inverted codes) with a caption beneath.
 */

import { QRCodeSVG } from 'qrcode.react';
import { ModuleProps } from './index';
import { ModuleEmpty, ModuleFrame } from './ModuleFrame';
import './QrCodeModule.css';

export function QrCodeModule({ config }: ModuleProps) {
  const content = typeof config.content === 'string' ? config.content.trim() : '';
  const label = typeof config.label === 'string' ? config.label.trim() : '';

  if (!content) {
    return (
      <ModuleFrame title="QR code">
        <ModuleEmpty title="Nothing to encode" hint="Add a link or text in the app" />
      </ModuleFrame>
    );
  }

  return (
    <ModuleFrame className="qr">
      <div className="qr-code">
        <QRCodeSVG
          value={content}
          size={256}
          level="M"
          fgColor="#ffffff"
          bgColor="transparent"
          marginSize={2}
          title={label || content}
        />
      </div>
      {label && <div className="qr-caption">{label}</div>}
    </ModuleFrame>
  );
}
