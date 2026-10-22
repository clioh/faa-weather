/**
 * Paired phones (Settings)
 *
 * The phones the current mirror accepts (GET /api/pairing/devices). This
 * phone is marked and can be renamed; other phones can be removed, which
 * signs them out of the mirror at once. "Unpair this phone" removes this
 * phone's own entry, forgets its token and returns to the mirror list.
 */

import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Badge, Footer, Row, RowGroup, SectionLabel, Spinner, Text } from '@/components/ui';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, type PairedDevice } from '@/lib/api';
import { goHome } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';
import { ErrorToast, ScreenHeader, type ToastType } from '@/components';
import { Field, Notice, PrimaryButton, SecondaryButton, Sheet, errorMessage } from '@/components/calendar/ui';

const NAME_MAX = 60;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function lastSeenLabel(device: PairedDevice): string {
  if (device.current) return 'This phone';
  const seen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
  if (!seen || Number.isNaN(seen.getTime())) return 'Not used yet';
  const days = Math.floor((Date.now() - seen.getTime()) / 86400000);
  if (days <= 0) return 'Last used today';
  if (days === 1) return 'Last used yesterday';
  if (days < 30) return `Last used ${days} days ago`;
  return `Last used ${formatDate(device.lastSeenAt)}`;
}

export default function PairedPhonesScreen() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const [renaming, setRenaming] = useState<PairedDevice | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  /** The phone to remove; the current phone means "Unpair this phone". */
  const [removing, setRemoving] = useState<PairedDevice | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      const list = await api.getPairedDevices();
      // This phone first, then most recently used.
      list.sort((a, b) =>
        a.current !== b.current ? (a.current ? -1 : 1) : (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '')
      );
      setDevices(list);
      setLoadError(null);
      loadedOnce.current = true;
    } catch (e) {
      if (!loadedOnce.current) setLoadError(errorMessage(e, 'Couldn’t reach the mirror.'));
      else setToast({ message: errorMessage(e, 'Couldn’t refresh the list.'), type: 'error' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const current = devices.find((d) => d.current) ?? null;
  const others = devices.filter((d) => !d.current);

  const openRename = (device: PairedDevice) => {
    setNameDraft(device.name);
    setNameError(null);
    setRenaming(device);
  };

  const saveName = async () => {
    if (!renaming || savingName) return;
    const name = nameDraft.trim();
    if (!name) {
      setNameError('Give this phone a name.');
      return;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(name)) {
      setNameError('Use letters, numbers and punctuation only.');
      return;
    }
    if (name === renaming.name) {
      setRenaming(null);
      return;
    }
    setSavingName(true);
    try {
      const updated = await api.renamePairedDevice(renaming.id, name);
      setDevices((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
      Haptics.selectionAsync();
      setRenaming(null);
    } catch (e) {
      setNameError(errorMessage(e, 'Couldn’t rename this phone.'));
    } finally {
      setSavingName(false);
    }
  };

  const openRemove = (device: PairedDevice) => {
    setRemoveError(null);
    setRemoving(device);
  };

  const confirmRemove = async () => {
    if (!removing || removeBusy) return;
    const target = removing;
    setRemoveBusy(true);
    try {
      await api.removePairedDevice(target.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (target.current) {
        // The mirror no longer accepts this phone; drop the token and start over.
        await api.forgetPairing();
        setRemoving(null);
        goHome();
        return;
      }
      setDevices((prev) => prev.filter((d) => d.id !== target.id));
      setToast({ message: `${target.name} removed`, type: 'success' });
      setRemoving(null);
    } catch (e) {
      setRemoveError(errorMessage(e, 'Couldn’t remove that phone.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  let body;
  if (loading) {
    body = (
      <View style={styles.centered}>
        <Spinner size="large" />
      </View>
    );
  } else if (loadError) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Couldn’t load paired phones</Text>
        <Text style={styles.emptyText}>{loadError}</Text>
        <SecondaryButton
          label="Try again"
          onPress={() => {
            setLoading(true);
            load();
          }}
          style={styles.emptyButton}
        />
      </View>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.intro}>
          These phones can set up and control this mirror. A new phone pairs with a code shown on the mirror, so
          only someone at the mirror can add one.
        </Text>

        {current ? (
          <View>
            <SectionLabel>THIS PHONE</SectionLabel>
            <RowGroup>
              <DeviceRow device={current} />
              <Row
                icon="create-outline"
                title="Rename this phone"
                tone="accent"
                onPress={() => openRename(current)}
              />
            </RowGroup>
          </View>
        ) : (
          <Notice tone="info" message="This phone isn’t in the mirror’s list (it may be connected as the mirror itself)." />
        )}

        <View>
          <SectionLabel>OTHER PHONES</SectionLabel>
          <RowGroup>
            {others.length === 0 ? (
              <Row title="No other phones are paired." style={styles.emptyRow} />
            ) : (
              others.map((device) => (
                <DeviceRow key={device.id} device={device} onRemove={() => openRemove(device)} />
              ))
            )}
          </RowGroup>
        </View>
      </ScrollView>
    );
  }

  const removingSelf = removing?.current === true;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Paired phones" fallbackHref="/settings" />
      {body}

      {!loading && !loadError && current ? (
        <Footer>
          <SecondaryButton
            label="Unpair this phone"
            icon="log-out-outline"
            tone="danger"
            onPress={() => openRemove(current)}
          />
        </Footer>
      ) : null}

      <Sheet
        visible={renaming !== null}
        title="Rename this phone"
        body="The name the mirror shows for this phone in its paired phones list."
        onClose={() => !savingName && setRenaming(null)}
      >
        <Field
          label="Name"
          value={nameDraft}
          onChangeText={(t) => {
            setNameDraft(t);
            if (nameError) setNameError(null);
          }}
          onSubmitEditing={saveName}
          error={nameError}
          placeholder="Clio’s iPhone"
          autoFocus
          maxLength={NAME_MAX}
          returnKeyType="done"
          autoCapitalize="words"
        />
        <PrimaryButton label="Save" onPress={saveName} loading={savingName} style={styles.sheetButton} />
        <SecondaryButton label="Cancel" onPress={() => setRenaming(null)} disabled={savingName} />
      </Sheet>

      <Sheet
        visible={removing !== null}
        title={removingSelf ? 'Unpair this phone?' : removing ? `Remove ${removing.name}?` : 'Remove phone?'}
        body={
          removingSelf
            ? 'This phone stops controlling the mirror. To use it again, pair it with a new code from the mirror.'
            : 'That phone is signed out of the mirror straight away. It can pair again with a code shown on the mirror.'
        }
        onClose={() => !removeBusy && setRemoving(null)}
      >
        {removeError ? <Notice tone="error" message={removeError} /> : null}
        <SecondaryButton
          label={removingSelf ? 'Unpair' : 'Remove'}
          tone="danger"
          onPress={confirmRemove}
          loading={removeBusy}
          accessibilityLabel={removingSelf ? 'Confirm unpair this phone' : `Confirm remove ${removing?.name ?? 'phone'}`}
        />
        <SecondaryButton label="Keep it" onPress={() => setRemoving(null)} disabled={removeBusy} />
      </Sheet>

      <ErrorToast
        visible={toast !== null}
        message={toast?.message ?? ''}
        type={toast?.type ?? 'info'}
        onDismiss={() => setToast(null)}
        dismissAfter={3000}
      />
    </View>
  );
}

function DeviceRow({ device, onRemove }: { device: PairedDevice; onRemove?: () => void }) {
  const added = formatDate(device.createdAt);
  return (
    <Row
      icon="phone-portrait-outline"
      title={device.name}
      caption={
        (device.current ? (added ? `Paired ${added}` : 'Paired') : lastSeenLabel(device)) +
        (!device.current && added ? ` · paired ${added}` : '')
      }
      badge={device.current ? <Badge label="THIS PHONE" /> : undefined}
      trailing={
        onRemove ? (
          <Pressable
            style={styles.removeButton}
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${device.name}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: 26 },
  intro: { ...typography.body, color: colors.textSecondary },
  emptyRow: { opacity: 0.6 },
  removeButton: { width: 44, height: 44, marginRight: -spacing.sm, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typography.h3, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  emptyButton: { marginTop: spacing.md, alignSelf: 'stretch' },
  sheetButton: { marginTop: spacing.xs },
});
