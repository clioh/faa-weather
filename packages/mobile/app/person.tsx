/**
 * Someone else on this mirror (Settings › People)
 *
 * Until they accept their invite, this phone sets them up: send (or re-send)
 * the invite, arrange their layout, register their face again. Once they use
 * SkyGlass on their own phone, their layout is theirs (the mirror refuses
 * edits from other phones); this phone can still remove them.
 */

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Notice, Row, RowGroup, Spinner, Text } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, type MirrorPerson } from '@/lib/api';
import { goBack } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';

export default function PersonScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [person, setPerson] = useState<MirrorPerson | null>(null);
  const [hasFace, setHasFace] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const name = person?.name ?? (typeof params.name === 'string' ? params.name : 'Person');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([api.getPeople(), api.getRegisteredFaces().catch(() => [])])
        .then(([people, faces]) => {
          if (cancelled) return;
          setPerson(people.find((p) => p.id === id) ?? null);
          setHasFace(faces.some((f) => f.id === id));
          setError(null);
        })
        .catch(() => {
          if (!cancelled)
            setError('Couldn’t reach the mirror. Check that your phone is on the same network.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [id])
  );

  const remove = () => {
    Alert.alert(
      `Remove ${name}?`,
      `The mirror will stop recognizing ${name}, and their layout is deleted. Their phone stays paired until you remove it in Paired phones.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            try {
              // Face first: a face without a person would still be recognized.
              if (hasFace) await api.deleteFace(id);
              if (person) await api.deletePerson(id);
              goBack('/settings');
            } catch {
              Alert.alert('Couldn’t remove', `The mirror couldn’t remove ${name}. Try again.`);
            }
          },
        },
      ]
    );
  };

  const joined = person?.joined === true;
  const status = !person
    ? 'Only a face is registered for this person.'
    : joined
      ? `${name} uses SkyGlass on their phone and manages their own layout.`
      : person.inviteExpiresAt
        ? `Invite sent. It works until ${new Date(person.inviteExpiresAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.`
        : `${name} hasn’t been invited yet. Until they accept, you can set up their layout for them.`;

  return (
    <View style={styles.container}>
      <ScreenHeader title={name} fallbackHref="/settings" />
      {loading ? (
        <View style={styles.centered}>
          <Spinner size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <Notice tone="warning" message={error} />
          ) : (
            <Text style={styles.status}>{status}</Text>
          )}
          {hasFace === false && person && (
            <Notice
              tone="info"
              message={`${name} has no face registered, so the mirror won’t recognize them yet.`}
            />
          )}

          {person && !joined && (
            <RowGroup>
              <Row
                icon="paper-plane-outline"
                title={person.inviteExpiresAt ? 'Send a New Invite' : `Invite ${name}`}
                caption="QR code or a link to share"
                onPress={() =>
                  router.push({ pathname: '/invite-person', params: { userId: id, name } })
                }
              />
              <Row
                icon="grid-outline"
                title={`Edit ${name}’s Layout`}
                caption="What the mirror shows when it recognizes them"
                onPress={() =>
                  router.push({ pathname: '/editor', params: { personId: id, personName: name } })
                }
              />
              <Row
                icon="scan-outline"
                title={hasFace ? 'Register Face Again' : 'Register Face'}
                onPress={() =>
                  router.push({
                    pathname: '/setup/face',
                    params: { personId: id, personName: name },
                  })
                }
              />
            </RowGroup>
          )}

          <RowGroup>
            <Row icon="trash-outline" title={`Remove ${name}`} tone="danger" onPress={remove} />
          </RowGroup>
        </ScrollView>
      )}
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  status: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
