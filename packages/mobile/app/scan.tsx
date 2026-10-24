/**
 * Scan the mirror's code
 *
 * Full-screen QR scanner, opened from "Scan the mirror's code" on the
 * mirror list (/) and onboarding discovery. Reads the mirror's pairing QR
 * code (https://skyglass.dev/connect#…, or a staging origin's /connect#…, or
 * the older skyglass://connect and
 * exp://…/--/connect forms) and invite links (https://skyglass.dev/invite#…),
 * through the same parser as app/+native-intent.tsx (lib/appLinks), and
 * replaces itself with /connect or /invite. Anything else gets an inline
 * "That's not a SkyGlass code".
 *
 * Camera denied: explains, offers Open Settings, and the 6-digit code
 * fallback (back to the list, where tapping the mirror asks for its code).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Footer, IconCircle, Notice, Spinner, Text, TextButton } from '@/components/ui';
import { parseAppLink, type AppLink } from '@/lib/appLinks';
import { goBack } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';

/** How long "That's not a SkyGlass code" stays up, and the same code is ignored. */
const REJECT_MS = 3000;

function openLink(link: AppLink) {
  if (link.kind === 'connect') {
    router.replace({
      pathname: '/connect',
      params: {
        host: link.host,
        port: String(link.port),
        ...(link.pair ? { pair: link.pair } : {}),
        ...(link.name ? { name: link.name } : {}),
      },
    });
  } else {
    router.replace({
      pathname: '/invite',
      params: { host: link.host, port: String(link.port), token: link.token },
    });
  }
}

function CloseButton() {
  return (
    <Pressable
      onPress={() => goBack('/')}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={8}
      style={({ pressed }) => [styles.close, pressed && styles.pressed]}
    >
      <Ionicons name="close" size={24} color={colors.text} />
    </Pressable>
  );
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [found, setFound] = useState(false);
  const [rejected, setRejected] = useState(false);
  const lastRejected = useRef<{ data: string; at: number } | null>(null);
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(false);

  // Ask once on arrival; the denied screen covers the rest.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !asked.current) {
      asked.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(
    () => () => {
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
    },
    []
  );

  const onScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (found) return;
      const link = parseAppLink(data, { anyOrigin: true });
      if (link) {
        setFound(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        openLink(link);
        return;
      }
      // The camera reports the same code many times a second.
      const now = Date.now();
      const last = lastRejected.current;
      if (last && last.data === data && now - last.at < REJECT_MS) return;
      lastRejected.current = { data, at: now };
      setRejected(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
      rejectTimer.current = setTimeout(() => setRejected(false), REJECT_MS);
    },
    [found]
  );

  const codeInstead = <TextButton label="Use a 6-digit code instead" onPress={() => goBack('/')} />;

  // Still finding out, or the system prompt is up.
  if (!permission || (!permission.granted && permission.canAskAgain && !asked.current)) {
    return (
      <View style={styles.centered}>
        <Spinner size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.xs }]}>
          <CloseButton />
        </View>
        <View style={styles.deniedBody}>
          <IconCircle icon="camera-outline" />
          <Text style={styles.title} accessibilityRole="header">
            Camera access is off
          </Text>
          <Text style={styles.body}>
            SkyGlass needs the camera to scan the code on your mirror. Turn it on in Settings, or
            pair with the 6-digit code the mirror shows: close this, tap your mirror in the list,
            and enter the code.
          </Text>
        </View>
        <Footer>
          {permission.canAskAgain ? (
            <Button label="Allow camera" icon="camera-outline" onPress={requestPermission} />
          ) : (
            <Button
              label="Open Settings"
              icon="settings-outline"
              onPress={() => {
                void Linking.openSettings();
              }}
            />
          )}
          {codeInstead}
        </Footer>
      </View>
    );
  }

  const frame = Math.min(width - spacing.xxl * 2, 280);

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={found ? undefined : onScanned}
      />

      <View style={[styles.band, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.topBar}>
          <CloseButton />
        </View>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            Scan the mirror’s code
          </Text>
          <Text style={styles.body}>
            Point your camera at the QR code on the mirror, or at an invite someone sent you.
          </Text>
        </View>
      </View>

      <View style={styles.viewfinderArea} pointerEvents="none">
        <View
          style={[
            styles.viewfinder,
            { width: frame, height: frame },
            found && styles.viewfinderFound,
            rejected && styles.viewfinderRejected,
          ]}
          accessible
          accessibilityLabel="Viewfinder"
        />
      </View>

      <View style={styles.band}>
        <View style={styles.status} accessibilityLiveRegion="polite">
          {found ? (
            <View style={styles.foundRow}>
              <Spinner />
              <Text style={styles.body}>Opening…</Text>
            </View>
          ) : rejected ? (
            <Notice
              tone="warning"
              title="That’s not a SkyGlass code"
              message="Scan the QR code on your mirror’s screen, or an invite link."
            />
          ) : null}
        </View>
        <Footer>{codeInstead}</Footer>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  band: {
    backgroundColor: colors.overlay,
  },
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  heading: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: 10,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  viewfinderArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 22,
  },
  viewfinderFound: {
    borderColor: colors.primary,
  },
  viewfinderRejected: {
    borderColor: colors.warning,
  },
  status: {
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    justifyContent: 'center',
  },
  foundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  deniedBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 72,
    gap: spacing.lg,
  },
});
