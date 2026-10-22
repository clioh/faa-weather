/**
 * Setup Flow Layout
 * Handles the step-by-step setup wizard navigation
 */

import { Stack } from 'expo-router';
import { HeaderBackButton } from '@/components/ScreenHeader';
import { goBack } from '@/lib/navigation';
import { colors } from '@/lib/theme';

export default function SetupLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '600',
        },
        contentStyle: {
          backgroundColor: colors.background,
        },
        animation: 'slide_from_right',
        // Screens here are often pushed straight from the dashboard or
        // settings, which makes them the first route of this nested stack and
        // hides the native back button. Always draw our own.
        headerBackVisible: false,
        headerLeft: () => <HeaderBackButton onPress={() => goBack('/dashboard')} />,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Setup',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="wifi"
        options={{
          title: 'WiFi Setup',
        }}
      />
      <Stack.Screen
        name="license"
        options={{
          title: 'License',
        }}
      />
      <Stack.Screen
        name="airport"
        options={{
          title: 'Home Airport',
        }}
      />
      <Stack.Screen
        name="location"
        options={{
          title: 'Location',
        }}
      />
      <Stack.Screen
        name="face"
        options={{
          title: 'Face Registration',
        }}
      />
      <Stack.Screen
        name="complete"
        options={{
          title: 'Setup Complete',
          headerShown: false,
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}
