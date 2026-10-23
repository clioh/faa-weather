/**
 * Onboarding Flow Layout
 * Handles the step-by-step onboarding navigation
 */

import { Stack } from 'expo-router';
import { colors, fonts } from '@/lib/theme';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontFamily: fonts.uiMedium,
          fontSize: 16,
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
          title: 'Create profile',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="discover"
        options={{
          title: 'Find mirror',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="template"
        options={{
          title: 'Choose layout',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
