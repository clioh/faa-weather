/**
 * Dev-only gallery of the components/ui primitives and their states, to
 * compare against docs/design/mockups/Foundations.dc.html. Open
 * skyglass:///dev/ui (or router.push('/dev/ui')) in a dev build.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import {
  Badge,
  BottomSheet,
  Button,
  Chip,
  Field,
  Notice,
  PageSheetHeader,
  Row,
  RowGroup,
  SectionLabel,
  Spinner,
  StepProgress,
  Switch,
  TabBar,
  Text,
  TextButton,
  Toast,
} from '@/components/ui';
import { KeyboardAvoidingScreen } from '@/components/KeyboardAvoidingScreen';
import { colors, fonts, spacing, typography } from '@/lib/theme';

const noop = () => {};

export default function DevUiScreen() {
  const [on, setOn] = useState(true);
  const [chip, setChip] = useState('All');
  const [tab, setTab] = useState('mirror');
  const [sheet, setSheet] = useState(false);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: 'UI primitives', headerBackTitle: 'Back' }} />
      <KeyboardAvoidingScreen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionLabel>Type</SectionLabel>
        <Text style={[typography.hero, styles.white]}>08:42</Text>
        <Text style={[typography.h1, styles.white]}>Find your mirror</Text>
        <Text style={[typography.h3, styles.white]}>Add a widget</Text>
        <Text style={[typography.body, styles.secondary]}>Make sure the mirror is powered on.</Text>
        <Text style={[typography.caption, styles.muted]}>Paired Oct 3, 2026</Text>
        <Text style={[styles.white, { fontFamily: fonts.mono, fontSize: 15 }]}>KJFK 31012KT 10SM</Text>

        <SectionLabel style={styles.gap}>Buttons</SectionLabel>
        <Button label="Continue" onPress={noop} />
        <Button label="Scan again" variant="secondary" icon="refresh" onPress={noop} />
        <Button label="Disconnect" variant="danger" onPress={noop} />
        <Button label="Save airport" disabled onPress={noop} />
        <Button label="Saving" loading onPress={noop} />
        <View style={styles.inline}>
          <Button label="Small" size="small" onPress={noop} />
          <Button label="Small" size="small" variant="secondary" onPress={noop} />
          <TextButton label="Text button" onPress={noop} />
        </View>

        <SectionLabel style={styles.gap}>Chips, switches, badges</SectionLabel>
        <View style={styles.inline}>
          {['All', 'Aviation', 'Weather'].map((c) => (
            <Chip key={c} label={c} selected={chip === c} onPress={() => setChip(c)} />
          ))}
          <Chip label="4×2" blocked onPress={noop} />
        </View>
        <View style={styles.inline}>
          <Switch value={on} onValueChange={setOn} accessibilityLabel="Demo switch" />
          <Switch value={!on} onValueChange={(v) => setOn(!v)} accessibilityLabel="Demo switch 2" />
          <Badge label="NEW" />
          <Badge label="NO FACE DATA" tone="warning" />
          <Spinner />
        </View>

        <SectionLabel style={styles.gap}>Rows</SectionLabel>
        <RowGroup>
          <Row icon="airplane-outline" title="Home airport" value="KJFK" valueMono onPress={noop} />
          <Row
            title="Auto-download updates"
            caption="Download updates in the background"
            trailing={<Switch value={on} onValueChange={setOn} accessibilityLabel="Auto-download updates" />}
          />
          <Row title="Software updates" badge={<Badge label="v1.4.0" />} onPress={noop} />
          <Row
            leading={<Text style={styles.icao}>KBDU</Text>}
            title="Boulder Municipal"
            caption="Boulder · 3 NM"
            selected
            onPress={noop}
          />
          <Row icon="add" title="Add a person" tone="accent" onPress={noop} />
        </RowGroup>

        <SectionLabel style={styles.gap}>Fields</SectionLabel>
        <Field label="Name" placeholder="Enter your name" />
        <Field label="Password" secureTextEntry revealable defaultValue="hunter2" />
        <Field label="License key" mono defaultValue="XXXX-O1" error="License keys never contain 0, O, 1 or I." />

        <SectionLabel style={styles.gap}>Notices, toast, progress</SectionLabel>
        <Notice tone="info" message="Your kit came with a license. The mirror activates it once it is online." />
        <Notice tone="warning" message="Mirror not responding" />
        <Notice
          tone="error"
          message="Connection timed out. The mirror may be busy or unreachable."
          onRetry={noop}
          onDismiss={noop}
        />
        <Notice
          tone="error"
          title="Key not recognized"
          message="No SkyGlass license matches this key."
          action={{ label: 'skyglass.dev/license', onPress: noop }}
        />
        <Toast message="Saved to mirror" tone="success" style={styles.start} />
        <StepProgress labels={['Profile', 'Mirror', 'Setup', 'Template', 'Ready']} current={2} />

        <SectionLabel style={styles.gap}>Sheets</SectionLabel>
        <View style={styles.pageSheet}>
          <PageSheetHeader title="Add widget" onClose={noop} action={{ label: 'Done', onPress: noop }} />
        </View>
        <Button label="Open bottom sheet" variant="secondary" onPress={() => setSheet(true)} />
      </ScrollView>
      </KeyboardAvoidingScreen>
      <TabBar
        items={[
          { key: 'mirror', label: 'Mirror', icon: 'tablet-portrait-outline' },
          { key: 'layout', label: 'Layout', icon: 'grid-outline' },
          { key: 'settings', label: 'Settings', icon: 'options-outline', badge: true },
        ]}
        activeKey={tab}
        onPress={setTab}
      />
      <BottomSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Discard changes?"
        body="Your edits haven’t been saved."
      >
        <Button label="Discard" variant="danger" onPress={() => setSheet(false)} />
        <Button label="Keep editing" variant="secondary" onPress={() => setSheet(false)} />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  gap: {
    marginTop: spacing.md,
  },
  inline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  white: { color: colors.text },
  secondary: { color: colors.textSecondary },
  muted: { color: colors.textMuted },
  icao: { fontFamily: fonts.mono, fontSize: 16, width: 56, color: colors.text },
  start: { alignSelf: 'flex-start' },
  pageSheet: {
    backgroundColor: colors.surface,
    borderRadius: 14,
  },
});
