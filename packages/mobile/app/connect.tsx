/**
 * Connect (deep link target)
 *
 * Opened from the QR code on the mirror's setup screen, by the camera app or
 * the in-app scanner (app/scan.tsx):
 *   https://skyglass.dev/connect#h=192.168.1.27&p=3001&pair=…&m=Hangar
 *     (a Universal Link / App Link; app/+native-intent.tsx rewrites it to
 *     /connect?host=…&port=…&pair=…&name=…, see lib/appLinks)
 *   skyglass://connect?host=192.168.1.27&port=3001                 (older mirrors)
 *   exp://192.168.1.27:8081/--/connect?host=192.168.1.27&port=3001  (Expo Go)
 *
 * The QR also carries a single-use pairing secret (`&pair=<secret>`). This
 * screen claims it straight away (POST /api/pairing/claim), which stores
 * this phone's token for the mirror, so the rest of onboarding never asks
 * for a code. If the secret is expired or already used, the user can scan
 * again or pair with a 6-digit code instead (discovery opens the Pair screen).
 *
 * Then it remembers the mirror address and drops the user into onboarding
 * (or straight to discovery if a profile already exists). The discovery
 * screen connects to the remembered address instead of scanning.
 *
 * Dev builds: `npm run dev:e2e -- --reset` adds `&reset=<nonce>`, which wipes
 * the app's data first (once per nonce, lib/devReset) so setup starts over.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Footer, IconCircle, Spinner, Text, TextButton } from '@/components/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useUser } from '@/context/UserContext';
import { api, ApiError, INVALID_PAIRING_CODE } from '@/lib/api';
import { commonPairingError, getDeviceName } from '@/lib/pairing';
import { storage } from '@/lib/storage';
import { claimResetNonce } from '@/lib/devReset';
import { goBack } from '@/lib/navigation';
import { normalizeHost } from '@/lib/hosts';
import { Notice, PrimaryButton } from '@/components/calendar/ui';
import { colors, spacing, typography } from '@/lib/theme';

/** True when this phone already has a token the mirror accepts. */
async function alreadyPaired(): Promise<boolean> {
  if (!(await api.hasPairingToken().catch(() => false))) return false;
  try {
    const me = await api.whoami();
    return me.kind === 'device';
  } catch {
    return false;
  }
}

function claimErrorMessage(err: unknown, host: string): string {
  if (err instanceof ApiError && err.code === INVALID_PAIRING_CODE) {
    return 'This QR code has expired or was already used. The mirror shows a fresh one every few minutes: scan it again, or pair with a 6-digit code instead.';
  }
  if (err instanceof ApiError && err.status === undefined) {
    return `Couldn’t reach the mirror at ${host}. Make sure your phone is on the same WiFi network as the mirror.`;
  }
  return (
    commonPairingError(err) ??
    'The mirror couldn’t pair with this phone. Scan the code again or pair with a 6-digit code instead.'
  );
}

export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    host?: string;
    port?: string;
    pair?: string;
    /** The mirror's name, from the https link (only used for the copy). */
    name?: string;
    reset?: string;
  }>();
  const { isLoading, isOnboarded, resetAppData } = useUser();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [wasReset, setWasReset] = useState(false);
  const mirrorName =
    typeof params.name === 'string' && params.name.trim() ? params.name.trim().slice(0, 64) : null;
  // The reset flips isOnboarded mid-run; handle each deep link only once.
  const handled = useRef<string | null>(null);

  /** Where the deep link always leads: onboarding, or discovery once there's a profile. */
  const continueOnboarding = useCallback(() => {
    router.replace(isOnboarded && !wasReset ? '/onboarding/discover' : '/onboarding');
  }, [isOnboarded, wasReset]);

  useEffect(() => {
    if (isLoading) return;
    const link = JSON.stringify([params.host, params.port, params.pair, params.reset]);
    if (handled.current === link) return;
    handled.current = link;

    (async () => {
      const resetNonce = typeof params.reset === 'string' ? params.reset.trim() : '';
      const reset = await claimResetNonce(resetNonce).catch(() => false);
      if (reset) {
        await resetAppData().catch((err) => console.warn('[Connect] Dev reset failed', err));
        setWasReset(true);
      }

      const host = normalizeHost(params.host) ?? '';
      const port = params.port ? parseInt(String(params.port), 10) : 3001;
      const secret = typeof params.pair === 'string' ? params.pair.trim() : '';
      const validAddress = !!host && Number.isInteger(port) && port > 0 && port < 65536;

      if (validAddress) {
        await storage.setPendingMirror({ host, port });

        if (secret) {
          api.setBaseUrl(host, port);
          // Dev clients replay the deep link on reload; a used secret is fine
          // when this phone is already paired.
          if (!(await alreadyPaired())) {
            try {
              await api.claimPairing(secret, getDeviceName());
            } catch (err) {
              setClaimError(claimErrorMessage(err, host));
              return;
            }
          }
        }
      }

      router.replace(isOnboarded && !reset ? '/onboarding/discover' : '/onboarding');
    })();
  }, [isLoading, isOnboarded, resetAppData, params.host, params.port, params.pair, params.reset]);

  if (claimError) {
    return (
      <View style={styles.errorScreen}>
        <View style={[styles.errorBody, { paddingTop: insets.top + 72 }]}>
          <IconCircle icon="qr-code-outline" />
          <Text style={styles.title} accessibilityRole="header">
            {mirrorName ? `Couldn’t pair with ${mirrorName}` : 'Couldn’t pair with the QR code'}
          </Text>
          <Notice tone="warning" message={claimError} />
        </View>
        <Footer>
          {/* The address is saved; discovery connects to it and opens the code flow. */}
          <PrimaryButton
            label="Pair with a code instead"
            icon="keypad-outline"
            onPress={continueOnboarding}
          />
          <TextButton label="Cancel" onPress={() => goBack('/')} />
        </Footer>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Spinner size="large" />
      <Text style={styles.text}>Connecting to {mirrorName ?? 'your mirror'}…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  text: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  errorBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
});
