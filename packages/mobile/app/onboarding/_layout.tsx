/**
 * Onboarding Flow Layout
 * Handles the step-by-step onboarding navigation
 */

import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function OnboardingLayout() {
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
          title: 'Welcome',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="profile"
        options={{
          title: 'Create Profile',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="discover"
        options={{
          title: 'Find Mirror',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="template"
        options={{
          title: 'Choose Layout',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
