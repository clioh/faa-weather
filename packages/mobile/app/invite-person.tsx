/**
 * Invite someone added to this mirror
 *
 * Opened after registering another person's face (setup/face, adding someone)
 * and from their row in Settings › People. Creates a single-use invite
 * (POST /api/users/:id/invite, valid 7 days, replacing any older one) and
 * offers it as a QR code to scan in person and through the share sheet. The
 * link opens skyglass.dev/invite, which hands off to the app (app/invite.tsx).
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Button, Footer, Notice, Spinner, Text, TextButton } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, ApiError } from '@/lib/api';
import { inviteLink } from '@/lib/invites';
import { goBack } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';

const QR_SIZE = 220;

export default function InvitePersonScreen() {
  const { userId, name } = useLocalSearchParams<{ userId: string; name?: string }>();
  const personName = typeof name === 'string' && name ? name : 'them';
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const createInvite = useCallback(async () => {
    if (typeof userId !== 'string') return;
    setLoading(true);
    setError(null);
    try {
      const invite = await api.createInvite(userId);
      const { host, port } = api.getConnectionState();
      setLink(inviteLink({ host, port, token: invite.token, personName, mirrorName: invite.mirrorName }));
      setExpiresAt(invite.expiresAt);
    } catch (err) {
      setLink(null);
      setError(
        err instanceof ApiError && err.code === 'already_joined'
          ? `${personName} already uses SkyGlass on their phone. There’s nothing to send.`
          : 'Couldn’t create the invite. Make sure your phone can reach the mirror and try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [userId, personName]);

  useEffect(() => {
    void createInvite();
  }, [createInvite]);

  const share = () => {
    if (!link) return;
    Share.share({
      message: `I’ve set you up on our SkyGlass mirror. Open this on your phone to make it show your own layout: ${link}`,
    }).catch(() => {});
  };

  const validUntil = expiresAt
    ? new Date(expiresAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    : null;

  return (
    <View style={styles.container}>
      <ScreenHeader title={`Invite ${personName}`} leftIcon="close" onLeftPress={() => goBack('/settings')} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          {personName}’s face is registered. Send them this invite so they can install SkyGlass and choose what the
          mirror shows them.
        </Text>

        {loading ? (
          <View style={styles.qrPlaceholder}>
            <Spinner size="large" />
          </View>
        ) : error ? (
          <Notice tone="error" message={error} />
        ) : link ? (
          <>
            {/* Dark modules on white so any phone camera reads it. */}
            <View style={styles.qrCard} accessible accessibilityLabel={`Invite QR code for ${personName}`}>
              <QRCode value={link} size={QR_SIZE} color="#000000" backgroundColor="#FFFFFF" ecl="M" />
            </View>
            <View style={styles.steps}>
              <Text style={styles.step}>In person: they scan this code with their phone’s camera.</Text>
              <Text style={styles.step}>Elsewhere: share the link by Messages or email.</Text>
              <Text style={styles.step}>They need to be on this home WiFi when they open it.</Text>
            </View>
            {validUntil && (
              <Text style={styles.caption}>Works once, until {validUntil}. A new invite cancels this one.</Text>
            )}
          </>
        ) : null}
      </ScrollView>

      <Footer>
        {link && !error ? (
          <>
            <Button label="Share invite link" icon="share-outline" onPress={share} />
            <TextButton label="Make a new invite" onPress={createInvite} />
          </>
        ) : error ? (
          <Button label="Try again" icon="refresh" onPress={createInvite} />
        ) : null}
        <TextButton label="Done" onPress={() => goBack('/settings')} />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  qrPlaceholder: {
    height: QR_SIZE + 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCard: {
    alignSelf: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  steps: {
    gap: spacing.sm,
  },
  step: {
    ...typography.bodySmall,
    color: colors.text,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
