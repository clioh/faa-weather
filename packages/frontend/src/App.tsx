import { useEffect, useState, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { WidgetContainer } from './components/WidgetContainer';
import { widgetRegistry, WidgetConfig } from './components/widgets';
import { UpdateNotification } from './components/UpdateNotification';
import { RegistrationOverlay } from './components/RegistrationOverlay';
// SetupScreen is currently unused - setup is shown on mobile app
// import { SetupScreen } from './components/SetupScreen';
import { ProvisioningScreen } from './components/ProvisioningScreen';
import { SetupProgressScreen } from './components/SetupProgressScreen';
import { LicenseInvalidScreen } from './components/LicenseInvalidScreen';
import { ModuleRenderer, MirrorLayout } from './components/modules/ModuleRenderer';

interface Config {
  airport: string;
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  display: {
    presence_timeout: number;
    fade_duration: number;
  };
  widgets: WidgetConfig[];
}

type AppMode = 'loading' | 'provisioning' | 'setup' | 'ready' | 'license_invalid';

type PresenceState = 'absent' | 'detecting' | 'present' | 'leaving';

// Get time-of-day greeting
function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Default widget configuration if none provided
const defaultWidgets: WidgetConfig[] = [
  { type: 'clock', position: 'top-left', showZulu: true },
  { type: 'aviation', position: 'top-right' },
  { type: 'schedule', position: 'center-right', daysAhead: 7 },
  { type: 'radar', position: 'center-left', zoom: 6 },
  { type: 'tfr', position: 'bottom-left', radiusNm: 100 },
  { type: 'notam', position: 'bottom-center', maxItems: 5 },
  { type: 'astro', position: 'bottom-right', showZulu: true },
];

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [layout, setLayout] = useState<MirrorLayout | null>(null);
  const [useLayoutMode, setUseLayoutMode] = useState(false);
  const [isPresent, setIsPresent] = useState(true);
  const [presenceState, setPresenceState] = useState<PresenceState>('present');
  const [registrationMode, setRegistrationMode] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('loading');
  const [_adminUrl, setAdminUrl] = useState('');
  const { lastMessage, isConnected } = useWebSocket('ws://localhost:3001');

  // Multi-user state
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [showGreeting, setShowGreeting] = useState(false);

  // License status state
  const [supportEmail, setSupportEmail] = useState('support@magicmirror.dev');

  // Check app mode: license → provisioning → setup → ready
  useEffect(() => {
    const checkMode = async () => {
      // Check license status first
      try {
        const licenseRes = await fetch('/api/license/status', {
          signal: AbortSignal.timeout(5000)
        });
        const licenseData = await licenseRes.json();

        if (licenseData.enabled && licenseData.status === 'invalid') {
          if (licenseData.supportEmail) {
            setSupportEmail(licenseData.supportEmail);
          }
          setAppMode('license_invalid');
          return;
        }
      } catch {
        // If license check fails, continue - server might be starting up
        console.log('License check failed, continuing...');
      }

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
        const setupRes = await fetch('/api/setup/status');
        const setupData = await setupRes.json();

        if (setupData.adminUrl) {
          setAdminUrl(setupData.adminUrl);
        } else {
          const host = window.location.hostname;
          setAdminUrl(`http://${host}:5000/admin`);
        }

        if (setupData.needsSetup) {
          setAppMode('setup');
        } else {
          setAppMode('ready');
        }
      } catch {
        // If we can't check setup status, assume ready
        setAppMode('ready');
      }
    };

    checkMode();
  }, []);

  // Fetch configuration and layout (only if ready)
  useEffect(() => {
    if (appMode !== 'ready') return;

    // Try to fetch the new layout API first
    const fetchLayout = async () => {
      try {
        const res = await fetch('/api/layout');
        if (res.ok) {
          const data = await res.json();
          // GET /api/layout returns the layout object directly; accept a
          // legacy `{ layout }` wrapper too.
          const layoutData = data?.layout ?? data;
          if (layoutData && Array.isArray(layoutData.modules) && layoutData.modules.length > 0) {
            setLayout(layoutData);
            setUseLayoutMode(true);
            console.log('Using layout mode with', layoutData.modules.length, 'modules');
          }
        }
      } catch (err) {
        console.log('Layout API not available, falling back to legacy config');
      }
    };

    // Always fetch config for global settings (airport, location, etc.)
    fetch('/api/config')
      .then((res) => res.json())
      .then(setConfig)
      .catch(console.error);

    // Try to fetch layout
    fetchLayout();

    // Also fetch initial presence state
    fetch('/api/presence')
      .then((res) => res.json())
      .then((data) => {
        setIsPresent(data.present);
        setPresenceState(data.present ? 'present' : 'absent');
      })
      .catch(console.error);
  }, [appMode]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'presence') {
      const data = lastMessage.data as {
        present: boolean;
        state?: PresenceState;
        displayState?: string;
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

      setIsPresent(data.present);
      if (data.state) {
        setPresenceState(data.state);
      } else {
        setPresenceState(data.present ? 'present' : 'absent');
      }

      // Handle user change
      const newUserId = data.userId || null;
      const previousUserId = currentUserId;

      if (newUserId !== previousUserId) {
        setCurrentUserId(newUserId);
        setCurrentUserName(data.userName || null);

        // User changed - show greeting and load their layout
        if (newUserId && data.present) {
          console.log(`User recognized: ${data.userName} (${newUserId})`);

          // Show greeting for new user
          setShowGreeting(true);
          setTimeout(() => setShowGreeting(false), 5000);

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
            setUseLayoutMode(true);
            console.log(`Loaded layout for ${data.userName}:`, userLayout.name);
          }
        } else if (!newUserId && previousUserId) {
          // User left - optionally load default layout
          console.log('User left, loading default layout');
          // Fetch default layout
          fetch('/api/layout')
            .then(res => res.json())
            .then(data => {
              if (data.layout && data.layout.modules?.length > 0) {
                setLayout(data.layout);
              }
            })
            .catch(console.error);
        }
      }
    }

    if (lastMessage.type === 'registration') {
      const data = lastMessage.data as { active: boolean };
      setRegistrationMode(data.active);
    }

    // Handle layout updates from mobile app
    if (lastMessage.type === 'layout-update') {
      const data = lastMessage.data as { layout: MirrorLayout };
      if (data.layout) {
        setLayout(data.layout);
        setUseLayoutMode(true);
        console.log('Layout updated via WebSocket');
      }
    }

    // Handle user-specific layout updates
    if (lastMessage.type === 'user-layout-update') {
      const data = lastMessage.data as { userId: string; modules: MirrorLayout['modules'] };
      // Only apply if it's for the current user
      if (data.userId === currentUserId) {
        setLayout((prev) => prev ? { ...prev, modules: data.modules, updatedAt: new Date().toISOString() } : null);
        setUseLayoutMode(true);
        console.log('User layout updated via WebSocket');
      }
    }

    // Handle license activation from mobile app
    if (lastMessage.type === 'license') {
      const data = lastMessage.data as { status: string; activatedAt?: string };
      if (data.status === 'valid') {
        console.log('License activated via mobile app');
        // If we were showing setup, now we can check if setup is complete
        if (appMode === 'setup') {
          // Re-check setup status to see if we should move to ready
          fetch('/api/setup/status')
            .then((res) => res.json())
            .then((setupData) => {
              if (!setupData.needsSetup) {
                setAppMode('ready');
              }
            })
            .catch(console.error);
        }
      }
    }
  }, [lastMessage, currentUserId, appMode]);

  // Apply fade duration from config
  useEffect(() => {
    if (config?.display?.fade_duration) {
      document.documentElement.style.setProperty(
        '--transition-fade',
        `${config.display.fade_duration}ms ease-in-out`
      );
    }
  }, [config]);

  // Merge config with defaults and render widgets
  const widgets = useMemo(() => {
    const widgetConfigs = config?.widgets?.length ? config.widgets : defaultWidgets;

    return widgetConfigs
      .filter((w) => w.enabled !== false) // Filter out disabled widgets
      .map((widgetConfig) => {
        const Component = widgetRegistry[widgetConfig.type];
        if (!Component) {
          console.warn(`Unknown widget type: ${widgetConfig.type}`);
          return null;
        }

        // Build props from config, adding global config values
        const props = {
          ...widgetConfig,
          // Add global config values that widgets commonly need
          airport: config?.airport,
          timezone: config?.location?.timezone,
          latitude: config?.location?.latitude,
          longitude: config?.location?.longitude,
        };

        return (
          <Component
            key={`${widgetConfig.type}-${widgetConfig.position}`}
            {...props}
          />
        );
      })
      .filter(Boolean);
  }, [config]);

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

  // Show setup progress screen if setup is needed
  // This shows on the mirror while user configures on phone
  if (appMode === 'setup') {
    return (
      <SetupProgressScreen
        onSetupComplete={() => setAppMode('ready')}
      />
    );
  }

  // Show license invalid screen
  if (appMode === 'license_invalid') {
    return <LicenseInvalidScreen supportEmail={supportEmail} />;
  }

  if (!config) {
    return (
      <div className="loading">
        <span>Loading...</span>
      </div>
    );
  }

  // Show registration overlay when in registration mode
  if (registrationMode) {
    return <RegistrationOverlay />;
  }

  // Render content based on mode (layout vs legacy widgets)
  const renderContent = () => {
    if (useLayoutMode && layout) {
      return (
        <ModuleRenderer
          layout={layout}
          airport={config?.airport}
          timezone={config?.location?.timezone}
          latitude={config?.location?.latitude}
          longitude={config?.location?.longitude}
        />
      );
    }

    // Legacy widget mode
    return (
      <WidgetContainer>
        {widgets}
      </WidgetContainer>
    );
  };

  return (
    <div className={`mirror-container ${isPresent ? 'visible' : 'hidden'}`}>
      {renderContent()}

      {/* Personalized greeting when user is recognized */}
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

      <div className="connection-status">
        {isConnected ? '●' : '○'}
      </div>

      {/* Update notification */}
      <UpdateNotification wsConnected={isConnected} />
    </div>
  );
}

export default App;
