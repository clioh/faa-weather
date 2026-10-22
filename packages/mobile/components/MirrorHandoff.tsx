/**
 * Mirror hand-off after the WiFi step.
 *
 * Once the mirror has its home WiFi credentials it leaves the SkyGlass-Setup
 * hotspot, joins the home network and gets a new address from DHCP; the phone
 * falls back to its own WiFi. This screen keeps looking for the mirror by id
 * (lib/mirrorLocator) until it answers as a full mirror on the new network,
 * then calls onConnected with where it was found.
 *
 * Failure: when joining fails, wifi_provisioning.py brings the hotspot back up
 * and reports the error from /api/discovery (`wifi.state === 'failed'`). The
 * phone only sees that if it is back on SkyGlass-Setup, so after a timeout we
 * also explain the likely causes and how to retry.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  findMirrors,
  subnetOf,
  SETUP_HOTSPOT_SSID,
  type FoundMirror,
} from '@/lib/mirrorLocator';
import { storage } from '@/lib/storage';
import { goToManualEntry } from './MirrorNotFound';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

/** Joining (up to ~30 s), DHCP, and the mirror's services starting on a Pi. */
const HANDOFF_TIMEOUT_MS = 3 * 60 * 1000;
/** Pause between searches. */
const RETRY_DELAY_MS = 3000;
/** When mDNS and skyglass.local haven't found it, sweep common home subnets once. */
const COMMON_SWEEP_AFTER_MS = 45 * 1000;
const COMMON_HOME_SUBNETS = ['192.168.1', '192.168.0', '10.0.0', '192.168.86', '192.168.68', '10.0.1'];

type Phase = 'searching' | 'failed' | 'timeout';

interface MirrorHandoffProps {
  ssid: string;
  /** Persistent id of the mirror being moved; nothing else is accepted. */
  mirrorId: string | null;
  /** The phone sent the credentials over the SkyGlass-Setup hotspot. */
  fromHotspot: boolean;
  onConnected: (mirror: FoundMirror) => void;
  /** Back to the network list (to fix the password or pick another network). */
  onChooseNetwork: () => void;
}

export function MirrorHandoff({
  ssid,
  mirrorId,
  fromHotspot,
  onConnected,
  onChooseNetwork,
}: MirrorHandoffProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('searching');
  const [failure, setFailure] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    // Without an id there is no safe way to tell this mirror from another.
    if (!mirrorId) {
      setPhase('timeout');
      return;
    }

    const controller = new AbortController();
    const started = Date.now();
    const waker = { wake: () => {} };
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        waker.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    // Coming back from the Settings app (after joining WiFi): look right away.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') waker.wake();
    });
    const tick = setInterval(() => setElapsed(Date.now() - started), 1000);

    setPhase('searching');
    setFailure(null);
    setElapsed(0);

    (async () => {
      const saved = await storage.getLinkedMirrors().catch(() => []);
      const subnets = [
        ...new Set(saved.map((m) => subnetOf(m.host)).filter((s): s is string => s !== null)),
      ];
      let sweptCommon = false;

      // Give the mirror a moment to drop the hotspot before the first look.
      if (fromHotspot) await sleep(4000);

      while (!controller.signal.aborted) {
        const sweepCommon = !sweptCommon && Date.now() - started > COMMON_SWEEP_AFTER_MS;
        if (sweepCommon) sweptCommon = true;

        const found = await findMirrors({
          includeHotspot: fromHotspot,
          subnets: sweepCommon ? [...subnets, ...COMMON_HOME_SUBNETS] : subnets,
          timeoutMs: sweepCommon ? 50000 : 7000,
          signal: controller.signal,
          stopWhen: (m) => m.mirrorId === mirrorId && !m.provisioning,
        });
        if (controller.signal.aborted) return;

        const mine = found.filter((m) => m.mirrorId === mirrorId);
        const online = mine.find((m) => !m.provisioning);
        if (online) {
          onConnectedRef.current(online);
          return;
        }
        const hotspot = mine.find((m) => m.provisioning);
        if (hotspot?.wifi?.state === 'failed') {
          setFailure(hotspot.wifi.error);
          setPhase('failed');
          return;
        }
        if (Date.now() - started > HANDOFF_TIMEOUT_MS) {
          setPhase('timeout');
          return;
        }
        await sleep(RETRY_DELAY_MS);
      }
    })();

    return () => {
      controller.abort();
      waker.wake();
      appState.remove();
      clearInterval(tick);
    };
  }, [mirrorId, fromHotspot, attempt]);

  const keepSearching = () => setAttempt((n) => n + 1);

  if (phase === 'searching') {
    const seconds = Math.floor(elapsed / 1000);
    return (
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        <View style={styles.hero}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.title}>Connecting your mirror to {ssid}…</Text>
          <Text style={styles.subtitle}>
            This usually takes a minute or two{seconds > 5 ? ` (${seconds}s)` : ''}.
          </Text>
        </View>

        {fromHotspot && (
          <View style={styles.card}>
            <Step n={1}>
              Your mirror is leaving the "{SETUP_HOTSPOT_SSID}" network and joining {ssid}.
            </Step>
            <Step n={2}>
              Your phone should switch back to {ssid} on its own. If it doesn't, open Settings ›
              Wi-Fi, join {ssid}, and come back here.
            </Step>
            <Step n={3}>We'll find the mirror on {ssid} and continue setup automatically.</Step>
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View style={styles.hero}>
        <Ionicons name="warning-outline" size={48} color={colors.warning} />
        <Text style={styles.title}>
          {phase === 'failed'
            ? `Your mirror couldn't join ${ssid}`
            : `We couldn't find your mirror on ${ssid}`}
        </Text>
        {phase === 'failed' && failure && <Text style={styles.subtitle}>{failure}</Text>}
        {phase === 'timeout' && !mirrorId && (
          <Text style={styles.subtitle}>
            This mirror didn't report an id, so the app can't look for it automatically.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Common causes</Text>
        <Bullet>The WiFi password was mistyped (passwords are case-sensitive).</Bullet>
        <Bullet>
          The network is 5 GHz only. The mirror needs a 2.4 GHz network; many routers have a
          setting to turn 2.4 GHz on or split the bands.
        </Bullet>
        <Bullet>
          It's a guest network or one with a sign-in page, which keeps devices from seeing each
          other.
        </Bullet>
        <Bullet>The mirror is too far from the router.</Bullet>
        <Bullet>Your phone isn't on {ssid}. Check Settings › Wi-Fi.</Bullet>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>To try again</Text>
        <Text style={styles.cardText}>
          {phase === 'failed'
            ? `The mirror has reopened the "${SETUP_HOTSPOT_SSID}" network. Join it in Settings › Wi-Fi, then choose your network again.`
            : `If the mirror's screen shows the "${SETUP_HOTSPOT_SSID}" instructions again, it couldn't join. Join "${SETUP_HOTSPOT_SSID}" in Settings › Wi-Fi, then choose your network again.`}
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={onChooseNetwork}>
          <Ionicons name="wifi" size={18} color={colors.background} />
          <Text style={styles.primaryText}>Choose network again</Text>
        </TouchableOpacity>
        {mirrorId && (
          <TouchableOpacity style={styles.button} onPress={keepSearching}>
            <Ionicons name="refresh" size={18} color={colors.text} />
            <Text style={styles.buttonText}>Search again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.button} onPress={goToManualEntry}>
          <Ionicons name="create-outline" size={18} color={colors.text} />
          <Text style={styles.buttonText}>Enter address manually</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <Text style={styles.cardText}>{children}</Text>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.bullet}>•</Text>
      <Text style={styles.cardText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  cardTitle: {
    ...typography.label,
    color: colors.textMuted,
  },
  cardText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryMuted,
  },
  stepNumberText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  bullet: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  actions: {
    gap: spacing.sm,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceHighlight,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  buttonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  primaryText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
