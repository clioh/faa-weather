import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useWsEvent } from './components/modules/useWsEvent';
import { UpdateNotification } from './components/UpdateNotification';
import { RegistrationOverlay } from './components/RegistrationOverlay';
import { ProvisioningScreen } from './components/ProvisioningScreen';
import { SetupProgressScreen } from './components/SetupProgressScreen';
import { LicenseScreen } from './components/LicenseScreen';
import { licenseBlocksMirror, type LicenseStatus } from './license';
import type { MirrorOrientation } from './orientation';
import { ModuleRenderer, MirrorLayout } from './components/modules/ModuleRenderer';

interface Config {
  airport: string;
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  display?: {
    /** Applied by OrientationFrame (GET /api/setup/orientation), not here. */
    orientation?: MirrorOrientation;
    /** Presence fade in milliseconds (config.yaml display.fade_duration). */
    fade_duration?: number;
    presence_timeout?: number;
  };
}

/**
 * provisioning (no WiFi) → setup (includes the license step) → ready. Once
 * ready, a license that is not active (or disabled) shows the license screen
 * instead of the mirror; see licenseBlocksMirror.
 */
type AppMode = 'loading' | 'provisioning' | 'setup' | 'ready';

type PresenceState = 'absent' | 'detecting' | 'present' | 'leaving';

// Get time-of-day greeting
function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Shown when the backend has no layout yet; ModuleRenderer renders its empty state. */
const EMPTY_LAYOUT: MirrorLayout = {
  id: 'empty',
  name: 'Empty',
  modules: [],
  createdAt: '',
  updatedAt: '',
};

/**
 * GET /api/layout returns the layout object directly. Anything without a
 * modules array counts as no layout.
 */
function parseLayout(data: unknown): MirrorLayout | null {
  if (data && Array.isArray((data as MirrorLayout).modules)) {
    return data as MirrorLayout;
  }
  return null;
}

/** null when the backend can't answer; the mirror is not blocked on a failed check. */
async function fetchLicenseStatus(): Promise<LicenseStatus | null> {
  try {
    const res = await fetch('/api/license/status', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as LicenseStatus;
    return typeof data?.state === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** While the license screen is up, re-check this often in case a WS event was missed. */
const LICENSE_RECHECK_MS = 60_000;
/** Greeting on recognition; matches the .user-greeting animations in theme.css. */
const GREETING_MS = 2800;

/** How long the registration welcome screen stays up after the last photo. */
const WELCOME_MS = 6000;

/** Startup requests that failed (backend still starting) are retried: 1 s, 2 s, 4 s … up to 30 s. */
const RETRY_MAX_MS = 30_000;
function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, RETRY_MAX_MS);
}

async function fetchDefaultLayout(): Promise<MirrorLayout> {
  try {
    const res = await fetch('/api/layout');
    if (!res.ok) return EMPTY_LAYOUT;
    return parseLayout(await res.json()) ?? EMPTY_LAYOUT;
  } catch {
    return EMPTY_LAYOUT;
  }
}

// Same origin in every setup: Vite proxies /ws in dev, and in production the
// backend serves the UI and accepts the WebSocket upgrade itself.
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  // GET /api/config answered 401 pairing_required: this page isn't running
  // on the mirror (e.g. a dev machine on the LAN).
  const [notOnMirror, setNotOnMirror] = useState(false);

  // The wake/sleep fade length comes from config.yaml; the CSS default (1 s)
  // applies until the config arrives.
  const fadeMs = useRef(1000);
  useEffect(() => {
    const ms = config?.display?.fade_duration;
    if (typeof ms === 'number' && ms > 0) {
      document.documentElement.style.setProperty('--transition-fade', `${ms}ms ease-in-out`);
      fadeMs.current = ms;
    }
  }, [config?.display?.fade_duration]);
  const [layout, setLayout] = useState<MirrorLayout | null>(null);
  // Unsaved layout being edited in the phone app; shown instead of `layout`
  // until the app releases its display hold.
  const [previewModules, setPreviewModules] = useState<MirrorLayout['modules'] | null>(null);
  // Stays false until /api/layout has answered, so the empty state does not
  // flash before the real layout arrives.
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [isPresent, setIsPresent] = useState(true);
  const [presenceState, setPresenceState] = useState<PresenceState>('present');
  const [registrationMode, setRegistrationMode] = useState(false);
  const registrationEndTimer = useRef<number | undefined>(undefined);
  const [appMode, setAppMode] = useState<AppMode>('loading');
  const { lastMessage, isConnected } = useWebSocket(WS_URL);

  // Multi-user state
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [showGreeting, setShowGreeting] = useState(false);
  // Switching to the shared layout after someone leaves waits for the sleep
  // fade, so their layout fades out instead of flashing the shared one.
  // Bumped on every user change so a late switch never replaces a newcomer's layout.
  const leaveTimer = useRef<number | undefined>(undefined);
  const userChange = useRef(0);

  // Latest GET /api/license/status (or WS `license` payload); null until known.
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const licenseBlocked = appMode === 'ready' && licenseBlocksMirror(license);

  // Check app mode: provisioning → setup → ready. Retried with backoff
  // while the backend can't answer (kiosk up before the backend), so the
  // mirror never opens without a license check.
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    const retry = () => {
      if (cancelled) return;
      retryTimer = window.setTimeout(() => void checkMode(), retryDelay(attempt++));
    };

    const checkMode = async () => {
      if (cancelled) return;
      // Fetched first: the setup screen shows license problems in its
      // license step, and awaiting it keeps a ready mirror from flashing its
      // widgets before the license screen.
      const licenseStatus = await fetchLicenseStatus();
      if (cancelled) return;
      if (licenseStatus) setLicense(licenseStatus);

      try {
        // Check if we're in provisioning mode (no WiFi)
        const provRes = await fetch('/api/provisioning/status', {
          signal: AbortSignal.timeout(3000)
        });
        const provData = await provRes.json();

        if (provData.provisioning) {
          setAppMode('provisioning');
          return;
        }
      } catch {
        // If provisioning endpoint fails, check if we're on the AP network
        // (10.42.0.x means we're connected to the setup hotspot)
        const host = window.location.hostname;
        if (host.startsWith('10.42.0.')) {
          setAppMode('provisioning');
          return;
        }
      }

      // Check if setup is needed
      try {
        const setupRes = await fetch('/api/setup/status', { signal: AbortSignal.timeout(5000) });
        if (!setupRes.ok) throw new Error(`GET /api/setup/status: ${setupRes.status}`);
        const setupData = await setupRes.json();
        if (cancelled) return;
        // The license status must be known before the mirror opens; a
        // backend that answered setup will answer it on the retry.
        if (!setupData.needsSetup && !licenseStatus) throw new Error('license status unavailable');
        setAppMode(setupData.needsSetup ? 'setup' : 'ready');
      } catch (error) {
        console.warn('Mirror status check failed, retrying:', error);
        retry();
      }
    };

    void checkMode();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  // The server sends the current license status to every new socket, and
  // re-reading it on each (re)connect covers a state change that happened
  // while the kiosk was disconnected (e.g. the backend restarted released).
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    fetchLicenseStatus().then((status) => {
      if (status && !cancelled) setLicense(status);
    });
    return () => {
      cancelled = true;
    };
  }, [isConnected]);

  // License changed (key entered in the app, refresh, revocation, connect
  // snapshot): the payload is the full status object. Listened to via the
  // per-message window event so it is never lost to React batching.
  useWsEvent('license', (data) => {
    const status = data as LicenseStatus | null;
    if (status && typeof status.state === 'string') setLicense(status);
  });

  // A mirror with no saved layout shows the default for its orientation
  // (GET /api/layout), so a saved orientation change re-reads it. Previews
  // while the phone's Orientation step is open don't count.
  const savedOrientation = useRef<string | null>(null);
  useWsEvent('orientation', (data) => {
    const orientation = (data as { orientation?: unknown } | null)?.orientation;
    if (typeof orientation !== 'string') return;
    // Sent only when the config changes, so the first one compares with the loaded config.
    const previous = savedOrientation.current ?? config?.display?.orientation ?? 'landscape';
    savedOrientation.current = orientation;
    if (previous === orientation || currentUserId) return;
    const change = userChange.current;
    void fetchDefaultLayout().then((defaultLayout) => {
      if (userChange.current === change) setLayout(defaultLayout);
    });
  });

  // Setup finishes with the license already active, but re-read it so the
  // mirror never opens on a stale status.
  const handleSetupComplete = useCallback(() => {
    fetchLicenseStatus().then((status) => {
      if (status) setLicense(status);
      setAppMode('ready');
    });
  }, []);

  // The WS `license` event normally clears the license screen; poll as a
  // fallback (e.g. the socket reconnected after the event was sent).
  useEffect(() => {
    if (!licenseBlocked) return;
    const interval = setInterval(() => {
      fetchLicenseStatus().then((status) => {
        if (status) setLicense(status);
      });
    }, LICENSE_RECHECK_MS);
    return () => clearInterval(interval);
  }, [licenseBlocked]);

  // Fetch configuration and layout (only if ready)
  useEffect(() => {
    if (appMode !== 'ready' || licenseBlocked) return;

    let cancelled = false;
    let configRetry: number | undefined;
    let configAttempt = 0;

    // Global settings (airport, location) that widgets fall back to. The
    // mirror shows "Loading..." until this arrives, so keep retrying.
    const loadConfig = () => {
      fetch('/api/config', { signal: AbortSignal.timeout(5000) })
        .then(async (res) => {
          // The API only trusts the mirror itself (and paired phones). Opened
          // from another machine, say so instead of showing an empty mirror.
          if (res.status === 401) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            if (body?.error === 'pairing_required') {
              if (!cancelled) setNotOnMirror(true);
              return;
            }
          }
          if (!res.ok) throw new Error(`GET /api/config: ${res.status}`);
          const data = (await res.json()) as Config;
          if (!cancelled) setConfig(data);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error(error);
          configRetry = window.setTimeout(loadConfig, retryDelay(configAttempt++));
        });
    };
    loadConfig();

    fetchDefaultLayout().then((defaultLayout) => {
      // A user layout pushed over the WebSocket while this was in flight wins.
      setLayout((current) => current ?? defaultLayout);
      setLayoutLoaded(true);
    });

    // Also fetch initial presence state
    fetch('/api/presence')
      .then((res) => res.json())
      .then((data) => {
        setIsPresent(data.present || Boolean(data.hold));
        setPresenceState(data.present ? 'present' : 'absent');
        // Reloaded while someone is recognized: show their layout, not the shared one.
        if (cancelled || !data.userId) return;
        setCurrentUserId(data.userId);
        setCurrentUserName(data.userName || null);
        if (data.userLayout) {
          setLayout({
            id: data.userLayout.id,
            name: data.userLayout.name,
            modules: data.userLayout.modules,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          setLayoutLoaded(true);
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      window.clearTimeout(configRetry);
    };
  }, [appMode, licenseBlocked]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'presence') {
      const data = lastMessage.data as {
        present: boolean;
        state?: PresenceState;
        displayState?: string;
        /** The phone app is holding the display on (layout editing). */
        hold?: boolean;
        userId?: string | null;
        userName?: string | null;
        userLayout?: {
          id: string;
          name: string;
          modules: MirrorLayout['modules'];
          createdAt?: string;
          updatedAt?: string;
        } | null;
      };

      setIsPresent(data.present || Boolean(data.hold));
      if (data.state) {
        setPresenceState(data.state);
      } else {
        setPresenceState(data.present ? 'present' : 'absent');
      }

      // Handle user change
      const newUserId = data.userId || null;
      const previousUserId = currentUserId;

      if (newUserId !== previousUserId) {
        window.clearTimeout(leaveTimer.current);
        const change = ++userChange.current;
        setCurrentUserId(newUserId);
        setCurrentUserName(data.userName || null);

        // User changed - show greeting and load their layout
        if (newUserId && data.present) {
          console.log(`User recognized: ${data.userName} (${newUserId})`);

          // Show greeting for new user
          setShowGreeting(true);
          setTimeout(() => setShowGreeting(false), GREETING_MS);

          // Load user's layout if provided
          if (data.userLayout) {
            const userLayout: MirrorLayout = {
              id: data.userLayout.id,
              name: data.userLayout.name,
              modules: data.userLayout.modules,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            setLayout(userLayout);
            setLayoutLoaded(true);
            console.log(`Loaded layout for ${data.userName}:`, userLayout.name);
          }
        } else if (!newUserId && previousUserId) {
          console.log('User left, loading default layout');
          const showDefault = () =>
            fetchDefaultLayout().then((defaultLayout) => {
              if (userChange.current === change) setLayout(defaultLayout);
            });
          const goingDark = !data.present && !data.hold;
          if (goingDark) {
            leaveTimer.current = window.setTimeout(showDefault, fadeMs.current + 200);
          } else {
            void showDefault();
          }
        }
      }
    }

    if (lastMessage.type === 'registration') {
      const data = lastMessage.data as { active: boolean; action?: string };
      window.clearTimeout(registrationEndTimer.current);
      if (data.action === 'completed') {
        // `active` is already false: keep the overlay up for its welcome screen.
        registrationEndTimer.current = window.setTimeout(() => setRegistrationMode(false), WELCOME_MS);
      } else {
        setRegistrationMode(data.active);
      }
    }

    // Handle layout updates from mobile app
    if (lastMessage.type === 'layout-update') {
      const data = lastMessage.data as { layout: MirrorLayout };
      if (data.layout) {
        setLayout(data.layout);
        setLayoutLoaded(true);
        console.log('Layout updated via WebSocket');
      }
    }

    // Live preview from the phone's layout editor; null clears it
    if (lastMessage.type === 'layout-preview') {
      const data = lastMessage.data as { modules: MirrorLayout['modules'] | null };
      setPreviewModules(data.modules);
    }

    // Handle user-specific layout updates
    if (lastMessage.type === 'user-layout-update') {
      const data = lastMessage.data as { userId: string; modules: MirrorLayout['modules'] };
      // Only apply if it's for the current user
      if (data.userId === currentUserId) {
        setLayout((prev) => ({
          ...(prev ?? EMPTY_LAYOUT),
          modules: data.modules,
          updatedAt: new Date().toISOString(),
        }));
        console.log('User layout updated via WebSocket');
      }
    }

    // Backend reloaded config/config.yaml (setup wrote a new airport or
    // location): apply it live instead of waiting for a reload.
    if (lastMessage.type === 'config') {
      setConfig(lastMessage.data as Config);
    }

  }, [lastMessage, currentUserId]);

  // Show loading while checking app mode
  if (appMode === 'loading') {
    return (
      <div className="loading">
        <span>Loading...</span>
      </div>
    );
  }

  // Show provisioning screen (WiFi setup via QR code)
  if (appMode === 'provisioning') {
    return (
      <ProvisioningScreen
        onConnected={() => setAppMode('setup')}
      />
    );
  }

  // Registration takes over every screen past WiFi, setup included, so the
  // setup screen's Face step shows the live feed and guidance too.
  if (registrationMode) {
    return <RegistrationOverlay />;
  }

  // Show setup progress screen if setup is needed
  // This shows on the mirror while user configures on phone
  if (appMode === 'setup') {
    return (
      <SetupProgressScreen
        license={license}
        onSetupComplete={handleSetupComplete}
      />
    );
  }

  // Setup is done but the license isn't active: nothing else shows.
  if (licenseBlocked && license) {
    return <LicenseScreen status={license} />;
  }

  if (notOnMirror) {
    return (
      <div className="pairing-remote" role="alert">
        <div className="pairing-remote__content">
          <h1 className="pairing-remote__title">This display must run on the mirror itself</h1>
          <p className="pairing-remote__body">
            The mirror only answers its own screen and paired phones. Open this page on the
            mirror (http://localhost:3001), or use the SkyGlass app.
          </p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="loading">
        <span>Loading...</span>
      </div>
    );
  }

  const renderContent = () => {
    const previewLayout: MirrorLayout | null = previewModules
      ? {
          id: 'preview',
          name: 'Preview',
          createdAt: '',
          updatedAt: '',
          ...layout,
          modules: previewModules,
        }
      : null;
    const activeLayout = previewLayout ?? layout ?? (layoutLoaded ? EMPTY_LAYOUT : null);
    if (!activeLayout) return null;
    return (
      <ModuleRenderer
        layout={activeLayout}
        preview={previewModules !== null}
        airport={config?.airport}
        timezone={config?.location?.timezone}
        latitude={config?.location?.latitude}
        longitude={config?.location?.longitude}
      />
    );
  };

  return (
    <div className={`mirror-container ${isPresent ? 'visible' : 'hidden'}`}>
      {renderContent()}

      {/* Personalized greeting when user is recognized: alone on black, then
          the black fades away to reveal the layout. */}
      {showGreeting && currentUserName && (
        <div className="user-greeting">
          <span className="greeting-text">
            {getTimeOfDayGreeting()}, {currentUserName}
          </span>
        </div>
      )}

      {/* Status indicators */}
      <div className="presence-indicator">
        <span className={`dot ${presenceState}`} />
        <span>{presenceState.toUpperCase()}</span>
        {currentUserName && <span className="current-user"> | {currentUserName}</span>}
      </div>

      <div className={`connection-status${isConnected ? '' : ' offline'}`}>
        {isConnected ? '●' : '○'}
      </div>

      {/* Update notification */}
      <UpdateNotification wsConnected={isConnected} />
    </div>
  );
}

export default App;
