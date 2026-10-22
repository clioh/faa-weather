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
import { CATEGORIES, SIZE_LABELS, type ModuleDefinition, type ModuleInstance, type ModuleSize } from '@/lib/modules';
import { colors, borderRadius, spacing, typography } from '@/lib/theme';
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

  const tint = definition ? CATEGORIES[definition.category].color : colors.textMuted;

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
        <View style={[styles.iconWrap, { backgroundColor: `${tint}22` }]}>
          <Ionicons
            name={(definition?.icon ?? 'help-circle-outline') as keyof typeof Ionicons.glyphMap}
            size={16}
            color={tint}
          />
        </View>
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
  const color = disabled ? colors.textDisabled : confirming ? colors.text : destructive ? colors.error : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.action, confirming && styles.actionConfirm]}
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
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
    paddingTop: 12,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 26,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  blocked: {
    ...typography.caption,
    color: colors.warning,
    flexShrink: 1,
  },
  setupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255, 170, 0, 0.14)',
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
    fontWeight: '600',
  },
  singleSize: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    minHeight: 34,
    textAlignVertical: 'center',
    paddingTop: 9,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  action: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionConfirm: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  actionLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
});
