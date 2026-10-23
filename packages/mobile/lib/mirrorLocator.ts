/**
 * Mirror locator: finds SkyGlass mirrors on the network and identifies them.
 *
 * Every candidate address is confirmed with GET /api/discovery, which carries
 * the mirror's persistent id (backend `getMirrorId()`, also in the mDNS TXT
 * record). Callers that are looking for a saved mirror match on that id, so a
 * different mirror that happens to answer at an old address is never adopted.
 *
 * Mechanisms, all run in parallel:
 *  - mDNS `_skyglass._tcp` via react-native-zeroconf, when its native module
 *    is linked (dev/EAS builds on iOS and Android; absent in Expo Go).
 *  - `skyglass.local:3001`: iOS resolves .local names natively; Android
 *    usually does not.
 *  - The setup hotspot (10.42.0.1:80, wifi_provisioning.py), only when asked.
 *  - A bounded HTTP sweep of /24 subnets the caller passes in (typically the
 *    subnet the mirror was last seen on). The app has no way to read the
 *    phone's own IP without a native module, so it never guesses it.
 *
 * Nothing here touches the API client's base URL.
 */

import { NativeModules } from 'react-native';
// @ts-expect-error - no types available for react-native-zeroconf
import Zeroconf from 'react-native-zeroconf';

export const MIRROR_PORT = 3001;
export const MIRROR_HOSTNAME = 'skyglass.local';
/** wifi_provisioning.py's captive portal on the SkyGlass-Setup hotspot. */
export const SETUP_HOTSPOT = { host: '10.42.0.1', port: 80 } as const;
export const SETUP_HOTSPOT_SSID = 'SkyGlass-Setup';

/** What GET /api/discovery tells us about the mirror at an address. */
export interface FoundMirror {
  /** Persistent mirror id; null only for a backend too old to report one. */
  mirrorId: string | null;
  name: string;
  host: string;
  port: number;
  version?: string;
  setupComplete: boolean;
  /** True for the setup hotspot's provisioning server (not the full API). */
  provisioning: boolean;
  /** Provisioning server only: progress of the last WiFi join attempt. */
  wifi?: ProvisioningWifiState;
}

export interface ProvisioningWifiState {
  state: 'idle' | 'connecting' | 'connected' | 'failed';
  ssid: string | null;
  error: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a real mirror id (the backend generates a UUID v4). */
export function isMirrorId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

export function isSetupHotspot(host: string, port?: number): boolean {
  return host === SETUP_HOTSPOT.host && (port === undefined || port === SETUP_HOTSPOT.port);
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** "192.168.1.27" -> "192.168.1"; null for hostnames and the setup hotspot. */
export function subnetOf(host: string): string | null {
  const m = IPV4_RE.exec(host);
  if (!m) return null;
  const subnet = `${m[1]}.${m[2]}.${m[3]}`;
  return subnet === '10.42.0' ? null : subnet;
}

// ============================================================
// HTTP probe
// ============================================================

/** Identify whatever answers /api/discovery at host:port, or null. */
export async function probeMirror(
  host: string,
  port: number,
  timeoutMs = 2500,
  signal?: AbortSignal
): Promise<FoundMirror | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`http://${host}:${port}/api/discovery`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || typeof body.name !== 'string') return null;
    const wifi = body.wifi as Partial<ProvisioningWifiState> | undefined;
    return {
      mirrorId: isMirrorId(body.mirrorId) ? body.mirrorId : null,
      name: body.name || 'SkyGlass',
      host,
      port,
      version: typeof body.version === 'string' ? body.version : undefined,
      setupComplete: body.setupComplete === true,
      provisioning: body.provisioning === true,
      wifi:
        wifi && typeof wifi === 'object'
          ? {
              state: wifi.state ?? 'idle',
              ssid: typeof wifi.ssid === 'string' ? wifi.ssid : null,
              error: typeof wifi.error === 'string' ? wifi.error : null,
            }
          : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ============================================================
// mDNS (react-native-zeroconf), one shared browser
// ============================================================

interface ZeroconfService {
  name: string;
  host?: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, string | undefined>;
}

type ServiceListener = (service: ZeroconfService) => void;

// The native module is absent in Expo Go and in any build that did not link
// it; the JS wrapper then dereferences null on scan()/stop().
export const MDNS_AVAILABLE = NativeModules.RNZeroconf != null;

let zeroconf: Zeroconf | null = null;
const serviceListeners = new Set<ServiceListener>();

function getZeroconf(): Zeroconf | null {
  if (!MDNS_AVAILABLE) return null;
  if (!zeroconf) {
    zeroconf = new Zeroconf();
    zeroconf.on('resolved', (service: ZeroconfService) => {
      serviceListeners.forEach((listener) => listener(service));
    });
    zeroconf.on('error', (error: Error) => {
      console.log('[Locator] mDNS error:', error?.message ?? error);
    });
  }
  return zeroconf;
}

/**
 * Browse `_skyglass._tcp` until the returned function is called. Concurrent
 * callers share one native browse (starting a second one would cancel the
 * first on iOS).
 */
function browseMdns(listener: ServiceListener): () => void {
  const zc = getZeroconf();
  if (!zc) return () => {};

  serviceListeners.add(listener);
  if (serviceListeners.size === 1) {
    try {
      zc.scan('skyglass', 'tcp', 'local.');
    } catch (err) {
      console.log('[Locator] mDNS scan failed to start:', err);
    }
  } else {
    // A browse is already running: hand over what it has resolved so far.
    const known = Object.values(zc.getServices() as Record<string, ZeroconfService>);
    known.filter((s) => s.addresses?.length).forEach(listener);
  }

  return () => {
    if (!serviceListeners.delete(listener)) return;
    if (serviceListeners.size === 0) {
      try {
        zc.stop();
      } catch (err) {
        console.log('[Locator] mDNS stop failed:', err);
      }
    }
  };
}

/** IPv4 addresses first (TXT `ip` is only the address at backend start). */
function mdnsCandidates(service: ZeroconfService): string[] {
  const addrs = (service.addresses ?? []).filter((a) => IPV4_RE.test(a));
  const txtIp = service.txt?.ip;
  const out = [...addrs];
  if (txtIp && IPV4_RE.test(txtIp) && !out.includes(txtIp)) out.push(txtIp);
  return out;
}

// ============================================================
// Subnet sweep
// ============================================================

async function sweepSubnets(
  subnets: string[],
  port: number,
  onFound: (mirror: FoundMirror) => void,
  signal: AbortSignal,
  { concurrency = 48, timeoutMs = 1500 } = {}
): Promise<void> {
  const hosts: string[] = [];
  for (const subnet of subnets) {
    for (let i = 1; i < 255; i++) hosts.push(`${subnet}.${i}`);
  }
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < hosts.length) {
      const host = hosts[next++];
      const found = await probeMirror(host, port, timeoutMs, signal);
      if (found && !signal.aborted) onFound(found);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
}

// ============================================================
// Public API
// ============================================================

export interface FindOptions {
  /** Overall budget. */
  timeoutMs?: number;
  /** Also probe the setup hotspot (10.42.0.1:80). */
  includeHotspot?: boolean;
  /** /24 prefixes ("192.168.1") to sweep on port 3001. */
  subnets?: string[];
  /** Extra host:port pairs to probe first (e.g. the last known address). */
  hosts?: { host: string; port: number }[];
  /** Called once per newly identified mirror address. */
  onFound?: (mirror: FoundMirror) => void;
  /** Return as soon as this matches. */
  stopWhen?: (mirror: FoundMirror) => boolean;
  signal?: AbortSignal;
}

/**
 * Run every discovery mechanism in parallel and collect the mirrors that
 * answer. Results are deduplicated by mirror id (or address when the mirror
 * has none); a full mirror wins over its own provisioning server.
 */
export async function findMirrors(options: FindOptions = {}): Promise<FoundMirror[]> {
  const {
    timeoutMs = 8000,
    includeHotspot = false,
    subnets = [],
    hosts = [],
    onFound,
    stopWhen,
    signal: outerSignal,
  } = options;

  const controller = new AbortController();
  const signal = controller.signal;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onOuterAbort = () => {
    controller.abort();
    finish();
  };
  if (outerSignal?.aborted) onOuterAbort();
  outerSignal?.addEventListener('abort', onOuterAbort);

  const results = new Map<string, FoundMirror>();
  const probed = new Set<string>();

  const record = (mirror: FoundMirror) => {
    if (signal.aborted) return;
    const key = mirror.mirrorId ?? `${mirror.host}:${mirror.port}`;
    const existing = results.get(key);
    if (existing && (!existing.provisioning || mirror.provisioning)) return;
    results.set(key, mirror);
    onFound?.(mirror);
    if (stopWhen?.(mirror)) {
      controller.abort();
      finish();
    }
  };

  const probe = async (host: string, port: number, timeout = 2500) => {
    const key = `${host}:${port}`;
    if (probed.has(key) || signal.aborted) return;
    probed.add(key);
    const found = await probeMirror(host, port, timeout, signal);
    // A host can be probed under more than one name (skyglass.local and its
    // IP); keep both entries out of the way by keying on the mirror id.
    if (found) record(found);
  };

  const tasks: Promise<unknown>[] = [];
  hosts.forEach(({ host, port }) => tasks.push(probe(host, port)));
  tasks.push(probe(MIRROR_HOSTNAME, MIRROR_PORT, 4000));
  if (includeHotspot) tasks.push(probe(SETUP_HOTSPOT.host, SETUP_HOTSPOT.port));

  const stopMdns = browseMdns((service) => {
    for (const host of mdnsCandidates(service)) {
      void probe(host, service.port || MIRROR_PORT);
    }
  });

  const uniqueSubnets = [...new Set(subnets)];
  if (uniqueSubnets.length) {
    tasks.push(sweepSubnets(uniqueSubnets, MIRROR_PORT, record, signal));
  }

  const timer = setTimeout(() => {
    controller.abort();
    finish();
  }, timeoutMs);

  // mDNS has no natural end, so the budget always applies; but when every
  // HTTP task is done and mDNS isn't running there is nothing left to wait for.
  void Promise.all(tasks).then(() => {
    if (!MDNS_AVAILABLE) finish();
  });

  await done;
  clearTimeout(timer);
  stopMdns();
  controller.abort();
  outerSignal?.removeEventListener('abort', onOuterAbort);
  return Array.from(results.values());
}

export interface LocateOptions {
  /** Where the mirror was last seen; probed first and its /24 is swept. */
  lastHost?: string;
  lastPort?: number;
  /** Additional /24 prefixes to sweep (e.g. other saved mirrors' subnets). */
  subnets?: string[];
  /** Accept the provisioning server on the setup hotspot as a match. */
  acceptProvisioning?: boolean;
  includeHotspot?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Find the mirror with this id. Returns null when it isn't found (never a
 * different mirror).
 */
export async function locateMirror(
  mirrorId: string,
  options: LocateOptions = {}
): Promise<FoundMirror | null> {
  const {
    lastHost,
    lastPort = MIRROR_PORT,
    subnets = [],
    acceptProvisioning = false,
    includeHotspot = false,
    timeoutMs = 8000,
    signal,
  } = options;

  const matches = (m: FoundMirror) =>
    m.mirrorId === mirrorId && (acceptProvisioning || !m.provisioning);

  const sweep = [...subnets];
  const lastSubnet = lastHost ? subnetOf(lastHost) : null;
  if (lastSubnet) sweep.unshift(lastSubnet);

  const hosts: { host: string; port: number }[] = [];
  if (lastHost && !isSetupHotspot(lastHost, lastPort))
    hosts.push({ host: lastHost, port: lastPort });

  const found = await findMirrors({
    timeoutMs,
    includeHotspot,
    subnets: sweep,
    hosts,
    stopWhen: matches,
    signal,
  });
  return found.find(matches) ?? null;
}
