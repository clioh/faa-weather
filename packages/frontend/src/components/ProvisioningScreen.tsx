import { useState, useEffect } from 'react';

import { QRCodeSVG } from 'qrcode.react';

import { SetupFrame } from './setup/SetupFrame';
import { useMirrorInfo } from './setup/useMirrorInfo';
import './ProvisioningScreen.css';

interface ProvisioningScreenProps {
  ssid?: string;
  setupUrl?: string;
  onConnected?: () => void;
}

export function ProvisioningScreen({
  ssid = 'SkyGlass-Setup',
  setupUrl = 'http://10.42.0.1',
  onConnected,
}: ProvisioningScreenProps) {
  const [dots, setDots] = useState('');
  // Set up before; the saved network is gone and retried in the background
  const [reconnecting, setReconnecting] = useState(false);
  const { version } = useMirrorInfo();

  // WiFi QR code format (open network, no password)
  const wifiQrValue = `WIFI:T:nopass;S:${ssid};;`;

  // Animate waiting dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Poll to check if WiFi provisioning is complete
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/provisioning/status', {
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        setReconnecting(data.reconnecting === true);
        // The hotspot is gone once the mirror is online (joined from the
        // phone, or back on its saved network)
        if (data.provisioning === false) {
          onConnected?.();
        }
      } catch {
        // Expected to fail while in provisioning mode
      }
    };

    void checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [onConnected]);

  return (
    <SetupFrame
      topRight="Not connected"
      footLeft="Open network · no password"
      footRight={version ? `v${version}` : null}
    >
      <div className="sg-main sg-main--top">
        <div className="sg-col">
          <div className="sg-kicker">SkyGlass setup</div>
          <h1 className="sg-headline">Let’s get your mirror online.</h1>
          <p className="sg-body">
            {reconnecting
              ? 'The mirror can’t reach its saved Wi-Fi network and keeps retrying it. To use a different network, join the mirror’s setup network.'
              : 'Once the mirror is online, finish setup in the SkyGlass app on your phone.'}
          </p>
          {/* The setup network has no internet, so the store is out of reach
              once the phone joins it: get the app first. */}
          <div className="sg-hotspot__first">
            <div className="sg-hotspot__step">Before you start · Get the SkyGlass app</div>
            <div className="sg-hotspot__value">skyglass.dev/app</div>
            <div className="sg-hotspot__hint">Before you join {ssid}: it has no internet.</div>
          </div>
          <div className="sg-hotspot__waiting" role="status">
            Waiting for setup{dots}
          </div>
        </div>

        <div className="sg-panel sg-first sg-hotspot__codes">
          <div className="sg-hotspot__code">
            <div className="sg-qr sg-qr--small" role="img" aria-label={`QR code to join ${ssid}`}>
              <QRCodeSVG
                value={wifiQrValue}
                size={243}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
            <div className="sg-hotspot__text">
              <div className="sg-hotspot__step">01 · Connect to Wi-Fi</div>
              <div className="sg-hotspot__value">{ssid}</div>
              <div className="sg-hotspot__hint">Scan with phone camera</div>
            </div>
          </div>

          <div className="sg-hotspot__then">then</div>

          <div className="sg-hotspot__code">
            <div className="sg-qr sg-qr--small" role="img" aria-label="QR code for the setup page">
              <QRCodeSVG
                value={setupUrl}
                size={243}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
            <div className="sg-hotspot__text">
              <div className="sg-hotspot__step">02 · Open setup page</div>
              <div className="sg-hotspot__value">{setupUrl.replace('http://', '')}</div>
              <div className="sg-hotspot__hint">Scan or type in browser</div>
            </div>
          </div>
        </div>
      </div>
    </SetupFrame>
  );
}
