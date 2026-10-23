/**
 * Accept an invite (deep link target)
 *
 *   skyglass://invite?host=192.168.1.27&port=3001&token=sgi_…
 *
 * Opened from the skyglass.dev/invite page (lib/invites.ts) that someone
 * shared after adding this person to their mirror and registering their face.
 * Accepting pairs this phone with the mirror as that person
 * (POST /api/invites/claim), makes this phone's profile theirs, and links the
 * mirror. Their face is already registered, so they go straight to their
 * layout.
 *
 * A phone that already has a profile is asked first: accepting replaces it on
 * this phone (the old person stays on their mirrors).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Footer, IconCircle, Spinner, Text, TextButton } from '@/components/ui';
import { Notice, PrimaryButton } from '@/components/calendar/ui';
import { useUser } from '@/context/UserContext';
import { api, ApiError } from '@/lib/api';
import { getDeviceName } from '@/lib/pairing';
import { parseInviteParams } from '@/lib/invites';
import { storage } from '@/lib/storage';
import { goHome, goToDashboard } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';

type Phase =
  | { kind: 'checking' }
  | { kind: 'replace'; currentName: string }
  | { kind: 'accepting' }
  | { kind: 'done'; name: string; mirrorName: string }
  | { kind: 'error'; message: string };

function acceptErrorMessage(err: unknown, host: string): string {
  if (err instanceof ApiError && err.code === 'invalid_invite') {
    return 'This invite has expired or was already used. Ask whoever invited you to send a new one.';
  }
  if (err instanceof ApiError && err.code === 'too_many_devices') return err.message;
  if (err instanceof ApiError && err.status === undefined) {
    return `Couldn’t reach the mirror at ${host}. Make sure your phone is on the same WiFi network as the mirror, then open the invite again.`;
  }
  return 'The mirror couldn’t accept this invite. Open the invite link again, or ask for a new one.';
}

export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ host?: string; port?: string; token?: string }>();
  const { user, isLoading, resetAppData, createProfile, addMirror, setCurrentMirror } = useUser();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const invite = parseInviteParams(params);
  const started = useRef(false);

  const accept = useCallback(async () => {
    if (!invite) return;
    setPhase({ kind: 'accepting' });
    try {
      api.setBaseUrl(invite.host, invite.port);
      const result = await api.claimInvite(invite.token, getDeviceName());
      api.setBaseUrl(invite.host, invite.port, result.mirror.id);
      await createProfile(result.user.name, result.user.id);
      const mirror = {
        mirrorId: result.mirror.id,
        mirrorName: result.mirror.name,
        host: invite.host,
        port: invite.port,
        // Whoever invited them registered their face already.
        faceEnrolled: true,
        lastConnected: new Date().toISOString(),
      };
      await addMirror(mirror);
      setCurrentMirror(mirror);
      await storage.setOnboardingState({ phase: 'complete' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhase({ kind: 'done', name: result.user.name, mirrorName: result.mirror.name });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setPhase({ kind: 'error', message: acceptErrorMessage(err, invite.host) });
    }
  }, [invite, createProfile, addMirror, setCurrentMirror]);

  useEffect(() => {
    if (isLoading || started.current) return;
    started.current = true;
    if (!invite) {
      setPhase({ kind: 'error', message: 'This invite link is incomplete. Open the link you were sent again.' });
    } else if (user) {
      setPhase({ kind: 'replace', currentName: user.name });
    } else {
      void accept();
    }
  }, [isLoading, invite, user, accept]);

  const replaceAndAccept = async () => {
    await resetAppData().catch((err) => console.warn('[Invite] Reset failed', err));
    await accept();
  };

  if (phase.kind === 'checking' || phase.kind === 'accepting') {
    return (
      <View style={styles.centered}>
        <Spinner size="large" />
        <Text style={styles.caption}>Joining the mirror…</Text>
      </View>
    );
  }

  const body =
    phase.kind === 'done' ? (
      <>
        <IconCircle icon="person-add-outline" />
        <Text style={styles.title} accessibilityRole="header">
          Welcome, {phase.name}
        </Text>
        <Text style={styles.subtitle}>
          You’re set up on {phase.mirrorName}. Your face is already registered, so the mirror will show your layout when
          it recognizes you. Make it yours.
        </Text>
      </>
    ) : phase.kind === 'replace' ? (
      <>
        <IconCircle icon="swap-horizontal-outline" />
        <Text style={styles.title} accessibilityRole="header">
          Accept the invite?
        </Text>
        <Text style={styles.subtitle}>
          This phone is set up for {phase.currentName}. Accepting the invite makes it yours on this phone instead.{' '}
          {phase.currentName} stays on their mirrors.
        </Text>
      </>
    ) : (
      <>
        <IconCircle icon="mail-unread-outline" />
        <Text style={styles.title} accessibilityRole="header">
          Couldn’t accept the invite
        </Text>
        <Notice tone="warning" message={phase.message} />
      </>
    );

  return (
    <View style={styles.container}>
      <View style={[styles.body, { paddingTop: insets.top + 72 }]}>{body}</View>
      <Footer>
        {phase.kind === 'done' ? (
          <>
            <PrimaryButton
              label="Customize my layout"
              icon="grid-outline"
              onPress={() => {
                goToDashboard();
                router.push('/editor');
              }}
            />
            <TextButton label="Go to dashboard" onPress={goToDashboard} />
          </>
        ) : phase.kind === 'replace' ? (
          <>
            <PrimaryButton label="Accept invite" icon="checkmark" onPress={replaceAndAccept} />
            <TextButton label="Cancel" onPress={goHome} />
          </>
        ) : (
          <TextButton label="Close" onPress={goHome} />
        )}
      </Footer>
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
    gap: spacing.md,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  caption: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
