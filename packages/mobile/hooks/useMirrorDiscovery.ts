/**
 * Mirror Discovery Hook
 *
 * Lists SkyGlass mirrors on the network for the connect screens. The search
 * itself lives in lib/mirrorLocator (mDNS, skyglass.local, the setup hotspot
 * and the subnets of saved mirrors); every result is identified by its
 * /api/discovery response, including the mirror's persistent id.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, MirrorDevice } from '@/lib/api';
import { classifyError, ErrorType, logError } from '@/lib/errors';
import {
  findMirrors,
  probeMirror,
  subnetOf,
  isSetupHotspot,
  MDNS_AVAILABLE,
  SETUP_HOTSPOT,
  type FoundMirror,
} from '@/lib/mirrorLocator';
import { storage } from '@/lib/storage';

interface DiscoveryError {
  type: 'zeroconf' | 'network' | 'timeout' | 'validation';
  message: string;
}

interface DiscoveryState {
  mirrors: MirrorDevice[];
  scanning: boolean;
  error: string | null;
  detailedError: DiscoveryError | null;
}

const SCAN_TIMEOUT = 10000; // 10 seconds

function toDevice(found: FoundMirror): MirrorDevice {
  return {
    id: found.mirrorId ?? `${found.host}:${found.port}`,
    mirrorId: found.mirrorId,
    name: found.provisioning ? `${found.name} (Setup Mode)` : found.name,
    host: found.host,
    port: found.port,
    version: found.version,
    setupComplete: found.setupComplete,
    provisioning: found.provisioning,
  };
}

export function useMirrorDiscovery() {
  const [state, setState] = useState<DiscoveryState>({
    mirrors: [],
    scanning: false,
    error: null,
    detailedError: null,
  });

  const scanRef = useRef<AbortController | null>(null);
  const discoveredRef = useRef<Map<string, MirrorDevice>>(new Map());

  const publish = useCallback(() => {
    setState((prev) => ({ ...prev, mirrors: Array.from(discoveredRef.current.values()) }));
  }, []);

  const stopScan = useCallback(() => {
    scanRef.current?.abort();
    scanRef.current = null;
  }, []);

  const startScan = useCallback(async () => {
    scanRef.current?.abort();
    const controller = new AbortController();
    scanRef.current = controller;

    discoveredRef.current.clear();
    setState({ mirrors: [], scanning: true, error: null, detailedError: null });
    if (!MDNS_AVAILABLE) {
      console.log(
        '[Discovery] mDNS native module not available (Expo Go?); probing known hosts only'
      );
    }

    // Saved mirrors' subnets: a mirror whose DHCP address changed is usually
    // still on the same /24.
    const saved = await storage.getLinkedMirrors().catch(() => []);
    const subnets = saved.map((m) => subnetOf(m.host)).filter((s): s is string => s !== null);

    await findMirrors({
      timeoutMs: SCAN_TIMEOUT,
      includeHotspot: true,
      subnets,
      signal: controller.signal,
      onFound: (found) => {
        const device = toDevice(found);
        discoveredRef.current.set(device.id, device);
        publish();
      },
    });

    // Superseded by a newer scan (stopScan() clears the ref and lands here too).
    if (scanRef.current !== null && scanRef.current !== controller) return;
    scanRef.current = null;
    const mirrors = Array.from(discoveredRef.current.values());
    const none = mirrors.length === 0;
    setState({
      mirrors,
      scanning: false,
      error: none ? 'No mirrors found on network' : null,
      detailedError: none
        ? { type: 'timeout', message: 'No mirrors discovered. Try entering IP manually.' }
        : null,
    });
    console.log(`[Discovery] Scan complete. Found ${mirrors.length} mirror(s)`);
  }, [publish]);

  /** Point the API client at the mirror and check that it answers. */
  const connectToMirror = useCallback(async (mirror: MirrorDevice): Promise<boolean> => {
    api.setBaseUrl(mirror.host, mirror.port, mirror.mirrorId);

    try {
      const health = await api.ping();
      if (!health || typeof health.status !== 'string') {
        logError('useMirrorDiscovery.connectToMirror', new Error('Invalid response from mirror'), {
          mirrorId: mirror.id,
        });
        setState((prev) => ({
          ...prev,
          detailedError: { type: 'validation', message: 'Mirror responded but with invalid data.' },
        }));
        return false;
      }
      return health.status === 'ok';
    } catch (err) {
      const errorType = classifyError(err);
      logError('useMirrorDiscovery.connectToMirror', err, { mirrorId: mirror.id });
      setState((prev) => ({
        ...prev,
        detailedError: {
          type: errorType === ErrorType.NETWORK_TIMEOUT ? 'timeout' : 'network',
          message:
            errorType === ErrorType.NETWORK_TIMEOUT
              ? 'Connection timed out. Mirror may be busy.'
              : 'Could not connect to mirror.',
        },
      }));
      return false;
    }
  }, []);

  /** Identify the mirror at a typed-in address (10.42.0.1 means the setup hotspot). */
  const manualConnect = useCallback(
    async (host: string, port: number = 3001): Promise<MirrorDevice | null> => {
      setState((prev) => ({ ...prev, scanning: true, error: null, detailedError: null }));

      let found = await probeMirror(host, port, 5000);
      if (!found && isSetupHotspot(host)) {
        found = await probeMirror(SETUP_HOTSPOT.host, SETUP_HOTSPOT.port, 5000);
      }

      if (!found) {
        const message = `Could not connect to ${host}:${port}`;
        logError('useMirrorDiscovery.manualConnect', new Error(message), { host, port });
        setState((prev) => ({
          ...prev,
          scanning: false,
          error: message,
          detailedError: { type: 'network', message },
        }));
        return null;
      }

      const mirror = toDevice(found);
      discoveredRef.current.set(mirror.id, mirror);
      setState({
        mirrors: Array.from(discoveredRef.current.values()),
        scanning: false,
        error: null,
        detailedError: null,
      });
      return mirror;
    },
    []
  );

  // Stop any running scan on unmount.
  useEffect(() => () => scanRef.current?.abort(), []);

  // Note: callers (app/index.tsx, app/onboarding/discover.tsx) decide when to
  // scan, so the hook does not auto-start one. The discover screen may instead
  // connect straight to a mirror handed over by the setup-screen QR code.

  return {
    ...state,
    startScan,
    stopScan,
    connectToMirror,
    manualConnect,
  };
}
