/**
 * Inspector for the selected tile, sitting above the toolbar.
 *
 * It always reserves its height (showing a hint when nothing is selected) so
 * selecting a tile never resizes the canvas under the user's finger.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SIZE_LABELS, type ModuleDefinition, type ModuleInstance, type ModuleSize } from '@/lib/modules';
import { colors, borderRadius, spacing, typography, tones } from '@/lib/theme';
import { SizeChips, type SizeOption } from './SizeChips';

export const SELECTION_BAR_HEIGHT = 148;
const CONFIRM_TIMEOUT_MS = 3500;

interface SelectionBarProps {
  instance: ModuleInstance | null;
  definition: ModuleDefinition | undefined;
  sizeOptions: SizeOption[];
  needsSetup: boolean;
  /** Shown when the canvas has no tiles at all. */
  empty: boolean;
  onSize: (size: ModuleSize) => void;
  onConfigure: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function SelectionBar(props: SelectionBarProps) {
  const { instance, empty } = props;
  return (
    <View style={styles.container}>
      {instance ? (
        <SelectedContent key={instance.instanceId} {...props} instance={instance} />
      ) : (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)} style={styles.hintWrap}>
          {!empty && (
            <>
              <Ionicons name="hand-left-outline" size={18} color={colors.textMuted} />
              <Text style={styles.hint}>Tap a widget to edit it. Drag to move, drag its corner to resize.</Text>
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}

function SelectedContent({
  instance,
  definition,
  sizeOptions,
  needsSetup,
  onSize,
  onConfigure,
  onDuplicate,
  onRemove,
}: SelectionBarProps & { instance: ModuleInstance }) {
  const [confirming, setConfirming] = useState(false);
  const [blockedHint, setBlockedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  useEffect(() => {
    if (!blockedHint) return;
    const t = setTimeout(() => setBlockedHint(null), 2500);
    return () => clearTimeout(t);
  }, [blockedHint]);

  const handleRemove = () => {
    if (!confirming) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setConfirming(true);
      return;
    }
    onRemove();
  };

  return (
    <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(100)} style={styles.content}>
      <View style={styles.titleRow}>
        <Ionicons
          name={(definition?.icon ?? 'help-circle-outline') as keyof typeof Ionicons.glyphMap}
          size={18}
          color={colors.text}
        />
        <Text style={styles.title} numberOfLines={1}>
          {definition?.name ?? 'Unavailable widget'}
        </Text>
        {blockedHint ? (
          <Text style={styles.blocked} numberOfLines={1}>
            {blockedHint}
          </Text>
        ) : needsSetup ? (
          <TouchableOpacity
            onPress={onConfigure}
            style={styles.setupPill}
            hitSlop={{ top: 9, bottom: 9, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Needs setup. Configure this widget."
          >
            <View style={styles.setupDot} />
            <Text style={styles.setupText}>Needs setup</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {sizeOptions.length > 1 ? (
        <SizeChips
          options={sizeOptions}
          current={instance.size}
          onSelect={onSize}
          onBlocked={(size) => setBlockedHint(`No room for ${SIZE_LABELS[size]} here`)}
        />
      ) : (
        <Text style={styles.singleSize}>
          {definition ? 'This widget has one size.' : 'This widget was removed from SkyGlass. Remove it from the layout.'}
        </Text>
      )}

      <View style={styles.actions}>
        <ActionButton
          icon="options-outline"
          label="Configure"
          onPress={onConfigure}
          disabled={!definition}
        />
        <ActionButton icon="copy-outline" label="Duplicate" onPress={onDuplicate} disabled={!definition} />
        <ActionButton
          icon={confirming ? 'trash' : 'trash-outline'}
          label={confirming ? 'Remove?' : 'Remove'}
          onPress={handleRemove}
          destructive
          confirming={confirming}
        />
      </View>
    </Animated.View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  destructive,
  confirming,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  confirming?: boolean;
}) {
  const color = disabled
    ? colors.textDisabled
    : confirming
      ? colors.background
      : destructive
        ? colors.danger
        : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.action, destructive && styles.actionDanger, confirming && styles.actionConfirm]}
      accessibilityRole="button"
      accessibilityLabel={confirming ? 'Confirm remove widget' : label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    height: SELECTION_BAR_HEIGHT,
    overflow: 'hidden',
  },
  hintWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  hint: {
    ...typography.bodySmall,
    color: colors.textMuted,
    flexShrink: 1,
  },
  content: {
    flex: 1,
    paddingTop: 18,
    gap: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    minHeight: 26,
  },
  title: {
    fontSize: 17,
    color: colors.text,
    flex: 1,
  },
  blocked: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
  setupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: tones.warning.border,
    backgroundColor: tones.warning.fill,
  },
  setupDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  setupText: {
    ...typography.caption,
    color: colors.warning,
  },
  singleSize: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    minHeight: 34,
    textAlignVertical: 'center',
    paddingTop: 9,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  action: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  actionDanger: {
    borderColor: colors.dangerBorder,
  },
  actionConfirm: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  actionLabel: {
    fontSize: 13,
  },
});
