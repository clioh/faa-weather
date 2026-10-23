/**
 * Orientation Setup Screen (mockup S-Orientation)
 * How the mirror panel is mounted. Each card is previewed on the mirror right
 * away (it turns its screen and shows "This way up?"); the primary button
 * saves. Leaving without saving (Back, swipe, hardware back) ends the preview,
 * so the mirror returns to its saved orientation.
 */

import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { api, type MirrorOrientation } from '@/lib/api';
import { continueSetup } from '@/lib/setupSteps';
import { goBack } from '@/lib/navigation';
import { logError } from '@/lib/errors';
import { Button, Footer, Notice, Spinner, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/lib/theme';

interface OrientationOption {
  value: MirrorOrientation;
  title: string;
  caption?: string;
}

const OPTIONS: OrientationOption[] = [
  { value: 'landscape', title: 'Landscape' },
  { value: 'portrait-cw', title: 'Portrait', caption: 'Turned right' },
  { value: 'portrait-ccw', title: 'Portrait', caption: 'Turned left' },
];

/** A small panel with an up arrow; the thick edge is where the bottom bezel ended up. */
function MountPicture({ value, selected }: { value: MirrorOrientation; selected: boolean }) {
  const portrait = value !== 'landscape';
  return (
    <View style={styles.pic}>
      <View
        style={[
          styles.panel,
          portrait ? styles.panelPortrait : styles.panelLandscape,
          value === 'portrait-cw' && styles.bezelLeft,
          value === 'portrait-ccw' && styles.bezelRight,
          selected && styles.panelSelected,
        ]}
      >
        <Svg width={14} height={20} viewBox="0 0 24 32">
          <Path
            d="M12 30V3M3 12l9-9 9 9"
            fill="none"
            stroke={colors.primary}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </View>
  );
}

export default function OrientationSetupScreen() {
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const [selected, setSelected] = useState<MirrorOrientation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the mirror is showing a preview this screen started, and whether
  // it was saved; on the way out an unsaved preview is reverted.
  const previewing = useRef(false);
  const saved = useRef(false);

  const preview = async (value: MirrorOrientation) => {
    try {
      previewing.current = true;
      await api.setOrientation(value, true);
      setError(null);
    } catch (err) {
      logError('OrientationSetup.preview', err, { value });
      setError("Couldn't reach the mirror. Check it's on and try again.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    api
      .getOrientation()
      .then((state) => {
        if (cancelled) return;
        const current = state.preview ?? state.orientation;
        setSelected(current);
        // Show the check straight away, so the arrow is already on the glass.
        void preview(current);
      })
      .catch((err) => {
        if (cancelled) return;
        logError('OrientationSetup.load', err);
        setSelected('landscape');
        setError("Couldn't reach the mirror. Check it's on and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (previewing.current && !saved.current) {
        api.clearOrientationPreview().catch((err) => logError('OrientationSetup.revert', err));
      }
    };
  }, []);

  const choose = (value: MirrorOrientation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(value);
    void preview(value);
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api.setOrientation(selected);
      saved.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (flow === 'setup') await continueSetup('orientation');
      else goBack('/settings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save orientation');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Spinner size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>How is your mirror mounted?</Text>
          <Text style={styles.body}>
            The mirror turns its screen to match. Look at the glass and check the arrow points up.
          </Text>
        </View>

        <View
          style={styles.options}
          accessibilityRole="radiogroup"
          accessibilityLabel="Mirror orientation"
        >
          {OPTIONS.map((option) => {
            const isSelected = selected === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => choose(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={
                  option.caption ? `${option.title}, ${option.caption}` : option.title
                }
                style={({ pressed }) => [
                  styles.option,
                  isSelected && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <MountPicture value={option.value} selected={isSelected} />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  {option.caption ? <Text style={styles.caption}>{option.caption}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <Notice tone="error" message={error} />
        ) : (
          <Notice
            tone="info"
            icon="tablet-portrait-outline"
            message="The mirror now shows a large arrow and an outline around the edge of the glass. If the arrow points sideways or down, pick the other portrait option."
          />
        )}

        <View style={styles.spacer} />

        <Text style={styles.caption}>
          Your layouts follow this too. You can change it later in Settings › Mirror.
        </Text>
      </ScrollView>

      <Footer>
        <Button
          label="The arrow points up"
          onPress={handleConfirm}
          disabled={!selected}
          loading={saving}
        />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  options: {
    flexDirection: 'row',
    gap: 10,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: 14,
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  optionSelected: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  pressed: {
    backgroundColor: colors.surfaceHighlight,
  },
  pic: {
    height: 96,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  panel: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelSelected: {
    borderColor: colors.text,
  },
  panelLandscape: {
    width: 92,
    height: 54,
  },
  panelPortrait: {
    width: 54,
    height: 92,
  },
  bezelLeft: {
    borderLeftWidth: 6,
  },
  bezelRight: {
    borderRightWidth: 6,
  },
  optionText: {
    alignItems: 'center',
    gap: 2,
  },
  optionTitle: {
    fontSize: 14,
    color: colors.text,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  spacer: {
    flex: 1,
  },
});
