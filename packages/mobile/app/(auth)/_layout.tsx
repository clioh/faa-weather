/**
 * Auth Group Layout
 * Handles authentication screens with a consistent style
 */

import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function AuthLayout() {
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
      }}
    >
      <Stack.Screen
        name="sign-in"
        options={{
          title: 'Sign In',
          headerBackVisible: true,
        }}
      />
      <Stack.Screen
        name="sign-up"
        options={{
          title: 'Create Account',
          headerBackVisible: true,
        }}
      />
    </Stack>
  );
}
