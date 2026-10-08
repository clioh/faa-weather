/**
 * Mirror Discovery Hook
 * Uses mDNS/Bonjour via react-native-zeroconf to discover SkyGlass devices
 */

import { useState, useEffect, useCallback, useRef } from 'react';
// @ts-expect-error - no types available for react-native-zeroconf
import Zeroconf from 'react-native-zeroconf';
import { api, MirrorDevice } from '@/lib/api';
import { classifyError, ErrorType, logError } from '@/lib/errors';

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

interface ZeroconfService {
  name: string;
  fullName: string;
  host: string;
  port: number;
  txt: {
    id?: string;
    version?: string;
    api?: string;
    ws?: string;
    ip?: string;
  };
  addresses: string[];
}

// Service type for SkyGlass mDNS
const MDNS_SERVICE_TYPE = 'skyglass';
const MDNS_PROTOCOL = 'tcp';
const SCAN_TIMEOUT = 10000; // 10 seconds

// Fallback hosts when mDNS doesn't work
const FALLBACK_HOSTS = [
  { host: '10.42.0.1', port: 3001, name: 'SkyGlass (Setup Mode)' },
  { host: 'skyglass.local', port: 3001, name: 'SkyGlass' },
];

export function useMirrorDiscovery() {
  const [state, setState] = useState<DiscoveryState>({
    mirrors: [],
    scanning: false,
    error: null,
    detailedError: null,
  });

  const zeroconfRef = useRef<Zeroconf | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discoveredRef = useRef<Map<string, MirrorDevice>>(new Map());

  // Initialize Zeroconf
  useEffect(() => {
    const zeroconf = new Zeroconf();
    zeroconfRef.current = zeroconf;

    // Handle service resolution
    zeroconf.on('resolved', (service: ZeroconfService) => {
      console.log('[Discovery] Resolved service:', service.name);

      const host = service.txt?.ip || service.addresses?.[0] || service.host;
      const mirror: MirrorDevice = {
        id: service.txt?.id || `${host}:${service.port}`,
        name: service.name || 'SkyGlass',
        host,
        port: service.port,
        version: service.txt?.version,
        setupComplete: true,
      };

      discoveredRef.current.set(mirror.id, mirror);
      setState((prev) => ({
        ...prev,
        mirrors: Array.from(discoveredRef.current.values()),
      }));
    });

    // Handle errors
    zeroconf.on('error', (error: Error) => {
      logError('useMirrorDiscovery.zeroconf', error);
      setState((prev) => ({
        ...prev,
        detailedError: {
          type: 'zeroconf',
          message: 'Network discovery failed. Try entering IP manually.',
        },
      }));
    });

    // Handle service found (before resolution)
    zeroconf.on('found', (name: string) => {
      console.log('[Discovery] Found service:', name);
    });

    // Handle service removed
    zeroconf.on('remove', (name: string) => {
      console.log('[Discovery] Service removed:', name);
      // Find and remove the mirror with this name
      for (const [id, mirror] of discoveredRef.current.entries()) {
        if (mirror.name === name) {
          discoveredRef.current.delete(id);
          setState((prev) => ({
            ...prev,
            mirrors: Array.from(discoveredRef.current.values()),
          }));
          break;
        }
      }
    });

    return () => {
      zeroconf.stop();
      zeroconf.removeAllListeners();
    };
  }, []);

  // Try fallback hosts (provisioning AP, .local domain)
  const tryFallbackHosts = useCallback(async () => {
    for (const { host, port, name } of FALLBACK_HOSTS) {
      try {
        api.setBaseUrl(host, port);
        const health = await Promise.race([
          api.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 3000)
          ),
        ]);

        // Validate response structure
        if (!health || typeof health.status !== 'string') {
          logError('useMirrorDiscovery.tryFallbackHosts', new Error('Invalid health response'), { host, port });
          continue;
        }

        if (health.status === 'ok') {
          const mirror: MirrorDevice = {
            id: `${host}:${port}`,
            name: name,
            host,
            port,
            version: health.version,
            setupComplete: host !== '10.42.0.1',
          };

          // Try to get more info from discovery endpoint
          try {
            const discovery = await api.getDiscoveryInfo();
            // Validate discovery response
            if (discovery && typeof discovery.name === 'string') {
              mirror.name = discovery.name || mirror.name;
              mirror.version = discovery.version || mirror.version;
              mirror.setupComplete = discovery.setupComplete ?? mirror.setupComplete;
            }
          } catch (discoveryErr) {
            // Discovery endpoint not available, use defaults - this is normal
            console.log('[Discovery] Discovery endpoint not available for', host);
          }

          discoveredRef.current.set(mirror.id, mirror);
          setState((prev) => ({
            ...prev,
            mirrors: Array.from(discoveredRef.current.values()),
          }));
        }
      } catch (err) {
        // Host not responding, continue to next - this is expected
        const errorType = classifyError(err);
        if (errorType !== ErrorType.NETWORK_TIMEOUT && errorType !== ErrorType.NETWORK_ERROR) {
          logError('useMirrorDiscovery.tryFallbackHosts', err, { host, port });
        }
      }
    }
  }, []);

  const startScan = useCallback(async () => {
    const zeroconf = zeroconfRef.current;
    if (!zeroconf) {
      setState((prev) => ({
        ...prev,
        error: 'Discovery not initialized',
        detailedError: { type: 'zeroconf', message: 'Discovery service not available' },
      }));
      return;
    }

    // Clear previous results
    discoveredRef.current.clear();
    setState({ mirrors: [], scanning: true, error: null, detailedError: null });

    console.log('[Discovery] Starting mDNS scan for _skyglass._tcp');

    // Start mDNS scan
    try {
      zeroconf.scan(MDNS_SERVICE_TYPE, MDNS_PROTOCOL);
    } catch (error) {
      logError('useMirrorDiscovery.startScan', error);
      setState((prev) => ({
        ...prev,
        detailedError: {
          type: 'zeroconf',
          message: 'Failed to start network discovery. Try entering IP manually.',
        },
      }));
    }

    // Also try fallback hosts in parallel
    tryFallbackHosts();

    // Set timeout to stop scanning
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }

    scanTimeoutRef.current = setTimeout(() => {
      stopScan();
    }, SCAN_TIMEOUT);
  }, [tryFallbackHosts]);

  const stopScan = useCallback(() => {
    const zeroconf = zeroconfRef.current;
    if (zeroconf) {
      zeroconf.stop();
    }

    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }

    const mirrors = Array.from(discoveredRef.current.values());
    const noMirrorsFound = mirrors.length === 0;

    setState((prev) => ({
      mirrors,
      scanning: false,
      error: noMirrorsFound ? 'No mirrors found on network' : null,
      detailedError: noMirrorsFound
        ? prev.detailedError || { type: 'timeout', message: 'No mirrors discovered. Try entering IP manually.' }
        : null,
    }));

    console.log(`[Discovery] Scan complete. Found ${mirrors.length} mirror(s)`);
  }, []);

  const connectToMirror = useCallback(async (mirror: MirrorDevice): Promise<boolean> => {
    api.setBaseUrl(mirror.host, mirror.port);

    try {
      const health = await api.ping();

      // Validate response structure
      if (!health || typeof health.status !== 'string') {
        logError('useMirrorDiscovery.connectToMirror', new Error('Invalid response from mirror'), {
          mirrorId: mirror.id,
        });
        setState((prev) => ({
          ...prev,
          detailedError: {
            type: 'validation',
            message: 'Mirror responded but with invalid data.',
          },
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

  const manualConnect = useCallback(async (host: string, port: number = 3001): Promise<MirrorDevice | null> => {
    setState((prev) => ({ ...prev, scanning: true, error: null, detailedError: null }));

    try {
      api.setBaseUrl(host, port);
      const health = await api.ping();

      // Validate response
      if (!health || typeof health.status !== 'string' || health.status !== 'ok') {
        throw new Error('Invalid or unsuccessful health check response');
      }

      let mirrorName = 'SkyGlass';
      let version = health.version;
      let setupComplete = true;

      // Try to get more info
      try {
        const discovery = await api.getDiscoveryInfo();
        if (discovery && typeof discovery.name === 'string') {
          mirrorName = discovery.name || mirrorName;
          version = discovery.version || version;
          setupComplete = discovery.setupComplete ?? setupComplete;
        }
      } catch (discoveryErr) {
        // Use defaults - discovery endpoint is optional
        console.log('[Discovery] Discovery endpoint not available for manual connect');
      }

      const mirror: MirrorDevice = {
        id: `${host}:${port}`,
        name: mirrorName,
        host,
        port,
        version,
        setupComplete,
      };

      discoveredRef.current.set(mirror.id, mirror);

      setState({
        mirrors: Array.from(discoveredRef.current.values()),
        scanning: false,
        error: null,
        detailedError: null,
      });

      return mirror;
    } catch (err) {
      const errorType = classifyError(err);
      logError('useMirrorDiscovery.manualConnect', err, { host, port });

      let errorMessage: string;
      let detailedType: DiscoveryError['type'];

      switch (errorType) {
        case ErrorType.NETWORK_TIMEOUT:
          errorMessage = `Connection to ${host} timed out`;
          detailedType = 'timeout';
          break;
        case ErrorType.NETWORK_OFFLINE:
          errorMessage = 'No internet connection';
          detailedType = 'network';
          break;
        default:
          errorMessage = `Could not connect to ${host}:${port}`;
          detailedType = 'network';
      }

      setState((prev) => ({
        ...prev,
        scanning: false,
        error: errorMessage,
        detailedError: { type: detailedType, message: errorMessage },
      }));
      return null;
    }
  }, []);

  // Auto-start scan on mount
  useEffect(() => {
    startScan();
  }, []);

  return {
    ...state,
    startScan,
    stopScan,
    connectToMirror,
    manualConnect,
  };
}
