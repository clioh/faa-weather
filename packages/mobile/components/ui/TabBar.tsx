/**
 * Bottom tab bar: hairline top border, 22pt outline icons, 11pt labels, the
 * active tab in accent. Presentational only; the navigator that owns the
 * tabs passes the items and handles presses.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import type { IconName } from './Button';
import { colors, spacing } from '@/lib/theme';

export interface TabBarItem {
  key: string;
  label: string;
  icon: IconName;
  /** Filled variant shown when active, if the outline one reads too thin. */
  activeIcon?: IconName;
  badge?: boolean;
}

interface TabBarProps {
  items: TabBarItem[];
  activeKey: string;
  onPress: (key: string) => void;
  onLongPress?: (key: string) => void;
}

export function TabBar({ items, activeKey, onPress, onLongPress }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
      accessibilityRole="tablist"
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        const tint = active ? colors.primary : colors.textMuted;
        return (
          <Pressable
            key={item.key}
            onPress={() => onPress(item.key)}
            onLongPress={onLongPress ? () => onLongPress(item.key) : undefined}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
          >
            <View>
              <Ionicons
                name={active && item.activeIcon ? item.activeIcon : item.icon}
                size={22}
                color={tint}
              />
              {item.badge ? <View style={styles.badge} /> : null}
            </View>
            <Text style={[styles.label, { color: tint }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.background,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontSize: 11,
  },
  badge: {
    position: 'absolute',
    top: -1,
    right: -4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
});
