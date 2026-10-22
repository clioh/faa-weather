/**
 * Connected-mirror tabs: Mirror · Layout · Settings.
 *
 * The group folder doesn't change URLs, so these are still /dashboard and
 * /settings for goToDashboard(), goBack() fallbacks and deep links.
 *
 * Layout isn't a real tab: pressing it opens the editor full screen on the
 * root stack, where it keeps its own close button and unsaved-changes guard.
 * The `edit-layout` route only exists so the tab has somewhere to point.
 */

import { Tabs, type BottomTabBarProps } from 'expo-router/tabs';
import { router } from 'expo-router';
import { TabBar, type TabBarItem } from '@/components/ui/TabBar';
import { colors } from '@/lib/theme';

export const unstable_settings = {
  initialRouteName: 'dashboard',
};

const ITEMS: Record<string, Omit<TabBarItem, 'key'>> = {
  dashboard: { label: 'Mirror', icon: 'tablet-portrait-outline' },
  'edit-layout': { label: 'Layout', icon: 'grid-outline' },
  settings: { label: 'Settings', icon: 'options-outline' },
};

function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  // Only routes with a tab entry; anything else in the group gets no button.
  const items = state.routes.flatMap((route) =>
    ITEMS[route.name] ? [{ key: route.key, ...ITEMS[route.name] }] : []
  );
  const active = state.routes[state.index];

  // Same event flow as the stock tab bar, so per-screen `tabPress` listeners
  // (the Layout tab's) can take over.
  const onPress = (key: string) => {
    const route = state.routes.find((r) => r.key === key);
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (route.key !== active.key && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  const onLongPress = (key: string) => {
    navigation.emit({ type: 'tabLongPress', target: key });
  };

  return <TabBar items={items} activeKey={active.key} onPress={onPress} onLongPress={onLongPress} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen
        name="edit-layout"
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/editor');
          },
        }}
      />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
