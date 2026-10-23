/**
 * Airline schedule
 *
 * Upload a roster exported from the airline's crew system as an .xlsx file.
 * The mirror reads it and shows the flight duties in the Schedule widget,
 * next to calendar events. Each upload replaces the previous schedule (the
 * mirror keeps it across restarts); a file the mirror can't read is rejected
 * and the current schedule stays. Remove deletes it from the mirror.
 *
 * Opened from Calendars and from the setup complete screen.
 */

import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { ApiError, api, type FlightDuty } from '@/lib/api';
import { colors, spacing, typography } from '@/lib/theme';
import { ScreenHeader } from '@/components';
import { Button, Footer, Notice, Row, RowGroup, SectionLabel, Spinner, Text } from '@/components/ui';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The mirror's upload limit (multer, routes/schedule.ts). */
const MAX_BYTES = 10 * 1024 * 1024;
/** GET /api/schedule/flights accepts 1..30 days. */
const UPCOMING_DAYS = 30;

interface ScheduleState {
  loaded: number;
  upcoming: FlightDuty[];
  next: FlightDuty | null;
}

interface UploadResult {
  fileName: string;
  loaded: number;
}

function flightLabel(f: FlightDuty): string {
  const route = f.departure && f.arrival ? `${f.departure}–${f.arrival}` : null;
  if (f.flightNumber) return route ? `${f.flightNumber} ${route}` : f.flightNumber;
  return f.dutyType || f.title || 'Duty';
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Plain-language reason for a failed upload. */
function uploadErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 400) {
      // The mirror's parser messages are short and readable ("No flights found in the file").
      const reason = e.message && !/^HTTP \d+$/.test(e.message) ? `${e.message.replace(/\.$/, '')}. ` : '';
      return `${reason}Check that it’s an .xlsx file with a header row (Date, Flight, Dep, Arr…). Your current schedule hasn’t changed.`;
    }
    if (e.status === 404) {
      return 'This mirror’s software doesn’t support schedule uploads. Install the latest update on the mirror, then try again.';
    }
    if (e.status === 413) return 'That file is too large. The mirror accepts schedules up to 10 MB.';
    if (e.status === 429) return 'Too many uploads in the last hour. Try again later.';
    if (e.status === 503) return 'The mirror is still starting up. Try again in a minute.';
    if (e.status === undefined) return 'Couldn’t reach the mirror. Check that your phone is on the same WiFi, then try again.';
  }
  return 'The mirror couldn’t read that file. Your current schedule hasn’t changed.';
}

export default function ScheduleScreen() {
  const [state, setState] = useState<ScheduleState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [loaded, upcoming, next] = await Promise.all([
        api.getFlightScheduleCount(),
        api.getFlightDuties(UPCOMING_DAYS),
        api.getNextFlightDuty(),
      ]);
      setState({ loaded, upcoming, next });
      setLoadError(null);
    } catch (e) {
      setLoadError(
        e instanceof ApiError && e.status === 404
          ? 'This mirror’s software doesn’t support schedule uploads. Install the latest update on the mirror, then try again.'
          : e instanceof Error && e.message
            ? e.message
            : 'Couldn’t reach the mirror.'
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const pickAndUpload = async () => {
    if (uploading) return;
    setUploadError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      // Some Android file providers report spreadsheets as octet-stream; the name is checked below.
      type: [XLSX_MIME, 'application/octet-stream'],
      copyToCacheDirectory: true,
      multiple: false,
    }).catch(() => null);
    if (!picked || picked.canceled || !picked.assets?.length) return;

    const file = picked.assets[0];
    if (!/\.xlsx$/i.test(file.name)) {
      setUploadError(
        /\.(xls|csv|numbers)$/i.test(file.name)
          ? `${file.name} isn’t an .xlsx file. Open it in Excel, Numbers or Google Sheets and export it as Excel (.xlsx).`
          : `${file.name} isn’t an .xlsx file. Pick the Excel export of your schedule.`
      );
      return;
    }
    if (file.size && file.size > MAX_BYTES) {
      setUploadError('That file is too large. The mirror accepts schedules up to 10 MB.');
      return;
    }

    setUploading(true);
    setResult(null);
    try {
      const res = await api.uploadFlightSchedule(file.uri, file.name, file.mimeType ?? XLSX_MIME);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({ fileName: file.name, loaded: res.eventsLoaded });
      await load();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setUploadError(uploadErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = () => {
    Alert.alert('Remove the schedule?', 'Your flights disappear from the mirror. Calendars stay as they are.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.clearFlightSchedule();
            setResult(null);
            await load();
          } catch {
            Alert.alert('Couldn’t remove', 'The mirror couldn’t remove the schedule. Try again.');
          }
        },
      },
    ]);
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const hasSchedule = !!state && state.loaded > 0;
  const upcoming = state?.upcoming ?? [];
  const range =
    upcoming.length > 0
      ? `${shortDate(upcoming[0].startTime)} to ${shortDate(upcoming[upcoming.length - 1].startTime)}`
      : null;

  let body;
  if (!state && !loadError) {
    body = (
      <View style={styles.centered}>
        <Spinner size="large" />
      </View>
    );
  } else if (!state) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Couldn’t load the schedule</Text>
        <Text style={styles.emptyText}>{loadError}</Text>
        <Button label="Try again" variant="secondary" onPress={() => load()} style={styles.emptyButton} />
      </View>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.intro}>
          Upload the roster your airline’s crew system exports as an Excel file. Your flights show in the Schedule
          widget, next to your calendars. A new upload replaces the old one.
        </Text>

        {result ? (
          <Notice
            tone="info"
            icon="checkmark-circle"
            title="Schedule loaded"
            message={`${plural(result.loaded, 'flight')} from ${result.fileName}.`}
            onDismiss={() => setResult(null)}
          />
        ) : null}
        {uploadError ? (
          <Notice tone="error" title="Couldn’t load that file" message={uploadError} onDismiss={() => setUploadError(null)} />
        ) : null}

        <View>
          <SectionLabel>On the mirror</SectionLabel>
          {hasSchedule ? (
            <RowGroup>
              <Row title="Flights loaded" value={String(state.loaded)} valueMono />
              <Row
                title="Next 30 days"
                caption={range ?? undefined}
                value={plural(upcoming.length, 'flight')}
                valueMono
              />
              {state.next ? (
                <Row
                  title={flightLabel(state.next)}
                  caption={`Next · ${shortDate(state.next.startTime)}, ${shortTime(state.next.startTime)}`}
                  captionMono
                  icon="airplane-outline"
                />
              ) : (
                <Row title="No upcoming flights" caption="Every flight in this schedule is in the past." />
              )}
            </RowGroup>
          ) : (
            <RowGroup>
              <Row icon="document-outline" title="No schedule uploaded" caption="Calendar events still show as usual." />
            </RowGroup>
          )}
        </View>

        {upcoming.length > 0 ? (
          <View>
            <SectionLabel>Coming up</SectionLabel>
            <RowGroup>
              {upcoming.slice(0, 5).map((f) => (
                <Row
                  key={f.id}
                  title={flightLabel(f)}
                  caption={`${shortDate(f.startTime)} · ${shortTime(f.startTime)}–${shortTime(f.endTime)}${f.aircraftType ? ` · ${f.aircraftType}` : ''}`}
                  captionMono
                />
              ))}
            </RowGroup>
          </View>
        ) : null}

        {hasSchedule ? (
          <RowGroup>
            <Row icon="trash-outline" title="Remove schedule" tone="danger" onPress={remove} />
          </RowGroup>
        ) : null}

        <View style={styles.help}>
          <SectionLabel>File format</SectionLabel>
          <Text style={styles.helpText}>
            The first sheet needs a header row, then one row per duty. SkyGlass reads these columns:
          </Text>
          <Text style={styles.helpMono}>Date · Flight · Dep · Arr · ETD · ETA</Text>
          <Text style={styles.helpText}>and, if your roster has them:</Text>
          <Text style={styles.helpMono}>Report · Release · Duty · Aircraft</Text>
          <Text style={styles.helpText}>
            If your airline offers a calendar link (iCal or webcal) instead, add it under Calendars; it stays up to date
            on its own.
          </Text>
        </View>

      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Airline schedule" fallbackHref="/calendars" />
      {body}
      {state ? (
        <Footer>
          <Button
            label={hasSchedule ? 'Upload a new schedule' : 'Choose an .xlsx file'}
            icon="document-attach-outline"
            onPress={pickAndUpload}
            loading={uploading}
            accessibilityHint="Opens Files to pick your schedule, then sends it to the mirror"
          />
        </Footer>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: 22 },
  intro: { ...typography.bodySmall, color: colors.textSecondary },
  help: { gap: spacing.sm },
  helpText: { ...typography.bodySmall, color: colors.textSecondary },
  helpMono: { ...typography.mono, fontSize: 13, color: colors.text },
  emptyTitle: { ...typography.h3, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  emptyButton: { marginTop: spacing.md, alignSelf: 'stretch' },
});
