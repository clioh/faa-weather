/**
 * Auth Group Layout
 * Handles authentication screens with a consistent style
 */

import { Stack } from 'expo-router';
import { HeaderBackButton } from '@/components/ScreenHeader';
import { goBack } from '@/lib/navigation';
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
        // Screens here are often pushed straight from the dashboard or
        // settings, which makes them the first route of this nested stack and
        // hides the native back button. Always draw our own.
        headerBackVisible: false,
        headerLeft: () => <HeaderBackButton onPress={() => goBack('/')} />,
      }}
    >
      <Stack.Screen
        name="sign-in"
        options={{
          title: 'Sign In',
        }}
      />
      <Stack.Screen
        name="sign-up"
        options={{
          title: 'Create Account',
        }}
      />
    </Stack>
  );
}
