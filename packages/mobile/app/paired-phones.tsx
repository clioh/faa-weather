/**
 * Paired phones (Settings)
 *
 * The phones the current mirror accepts (GET /api/pairing/devices). This
 * phone is marked and can be renamed; other phones can be removed, which
 * signs them out of the mirror at once. "Unpair this phone" removes this
 * phone's own entry, forgets its token and returns to the mirror list.
 */

import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, type PairedDevice } from '@/lib/api';
import { goHome } from '@/lib/navigation';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
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
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  } else if (loadError) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
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
          <View style={styles.card}>
            <DeviceRow device={current} />
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.action}
              onPress={() => openRename(current)}
              accessibilityRole="button"
              accessibilityLabel="Rename this phone"
            >
              <Ionicons name="create-outline" size={20} color={colors.primary} />
              <Text style={styles.actionText}>Rename this phone</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Notice tone="info" message="This phone isn’t in the mirror’s list (it may be connected as the mirror itself)." />
        )}

        <Text style={styles.sectionTitle}>OTHER PHONES</Text>
        {others.length === 0 ? (
          <View style={[styles.card, styles.emptyCard]}>
            <Text style={styles.emptyCardText}>No other phones are paired.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {others.map((device, index) => (
              <View key={device.id}>
                {index > 0 && <View style={styles.divider} />}
                <DeviceRow device={device} onRemove={() => openRemove(device)} />
              </View>
            ))}
          </View>
        )}

        {current ? (
          <SecondaryButton
            label="Unpair this phone"
            icon="log-out-outline"
            tone="danger"
            onPress={() => openRemove(current)}
            style={styles.unpair}
          />
        ) : null}
      </ScrollView>
    );
  }

  const removingSelf = removing?.current === true;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Paired phones" fallbackHref="/settings" />
      {body}

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
        {removeError ? <Text style={styles.sheetError}>{removeError}</Text> : null}
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
    <View style={styles.row}>
      <View style={[styles.rowIcon, device.current && styles.rowIconCurrent]}>
        <Ionicons name="phone-portrait-outline" size={22} color={device.current ? colors.primary : colors.textSecondary} />
      </View>
      <View style={styles.rowInfo}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {device.name}
          </Text>
          {device.current ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>THIS PHONE</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowMeta}>
          {device.current ? (added ? `Paired ${added}` : 'Paired') : lastSeenLabel(device)}
          {!device.current && added ? ` · paired ${added}` : ''}
        </Text>
      </View>
      {onRemove ? (
        <TouchableOpacity
          style={styles.removeButton}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${device.name}`}
        >
          <Ionicons name="trash-outline" size={20} color={colors.error} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  intro: { ...typography.bodySmall, color: colors.textSecondary },
  sectionTitle: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  emptyCard: { padding: spacing.md },
  emptyCardText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md, minHeight: 64 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconCurrent: { backgroundColor: colors.primaryMuted },
  rowInfo: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { ...typography.body, color: colors.text, fontWeight: '600', flexShrink: 1 },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primaryMuted,
  },
  badgeText: { ...typography.label, fontSize: 10, color: colors.primary },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 48 },
  actionText: { ...typography.body, color: colors.primary, fontWeight: '500' },
  unpair: { marginTop: spacing.md },
  emptyTitle: { ...typography.h3, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  emptyButton: { marginTop: spacing.md, alignSelf: 'stretch' },
  sheetButton: { marginTop: spacing.sm },
  sheetError: { ...typography.bodySmall, color: colors.error },
});
