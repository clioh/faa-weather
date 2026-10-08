/**
 * Setup Flow Layout
 * Handles the step-by-step setup wizard navigation
 */

import { Stack } from 'expo-router';
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
