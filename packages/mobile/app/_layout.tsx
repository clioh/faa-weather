/**
 * Root Layout
 * Sets up navigation, theme, and global providers
 */

import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import { ClerkProvider, ClerkLoaded } from '@clerk/expo';
import { UserProvider } from '@/context/UserContext';
import { HeaderBackButton, HeaderIconButton } from '@/components/ScreenHeader';
import { goBack, goHome } from '@/lib/navigation';
import { usePairingRedirect } from '@/lib/pairing';
import { colors } from '@/lib/theme';

// Clerk publishable key from environment
const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Token cache for Clerk using SecureStore
const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // SecureStore not available, ignore
    }
  },
  async clearToken(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // SecureStore not available, ignore
    }
  },
};

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Native-header screens draw the app's own back control so it matches the
// custom headers elsewhere.
const pushedHeader = {
  headerBackVisible: false,
  headerLeft: () => <HeaderBackButton onPress={() => goBack('/dashboard')} />,
};

function RootLayoutNav() {
  // A 401 pairing_required from the mirror opens the Pair screen (once).
  usePairingRedirect();
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
        name="index"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="connect"
        options={{
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="onboarding"
        options={{
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="setup"
        options={{
          headerShown: false,
        }}
      />
      {/*
        The dashboard is entered with replace(), so it is the bottom of the
        stack. Give it explicit ways out: the mirror list on the left and the
        profile on the right.
      */}
      <Stack.Screen
        name="dashboard"
        options={{
          title: 'SkyGlass',
          headerBackVisible: false,
          headerLeft: () => <HeaderBackButton label="Mirrors" onPress={goHome} />,
          headerRight: () => (
            <HeaderIconButton
              icon="person-circle-outline"
              accessibilityLabel="Profile"
              onPress={() => router.push('/profile')}
            />
          ),
        }}
      />
      {/* Pushed (not modal); same back control as every other screen. */}
      <Stack.Screen name="settings" options={{ title: 'Settings', ...pushedHeader }} />
      <Stack.Screen name="updates" options={{ title: 'Software Updates', ...pushedHeader }} />
      {/* These screens draw their own ScreenHeader. */}
      <Stack.Screen name="profile" options={{ headerShown: false }} />
      <Stack.Screen name="mirrors" options={{ headerShown: false }} />
      <Stack.Screen name="editor" options={{ headerShown: false }} />
      <Stack.Screen name="templates" options={{ headerShown: false }} />
      <Stack.Screen name="calendars" options={{ headerShown: false }} />
      <Stack.Screen name="add-calendar" options={{ headerShown: false }} />
      {/* Opened by lib/pairing only; pops itself when paired. */}
      <Stack.Screen name="pair" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="paired-phones" options={{ headerShown: false }} />
      {/* Deep-link target for Google sign-in; pops itself straight away. */}
      <Stack.Screen name="oauth/google" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen
        name="(auth)"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Hide splash screen after a short delay
    const timer = setTimeout(() => {
      SplashScreen.hideAsync();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // GestureHandlerRootView must wrap everything that uses gesture-handler
  // gestures (the layout editor canvas).
  // If Clerk key is not set, render without Clerk (for local-only usage)
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <UserProvider>
        <GestureHandlerRootView style={styles.container}>
          <StatusBar style="light" />
          <RootLayoutNav />
        </GestureHandlerRootView>
      </UserProvider>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkLoaded>
        <UserProvider>
          <GestureHandlerRootView style={styles.container}>
            <StatusBar style="light" />
            <RootLayoutNav />
          </GestureHandlerRootView>
        </UserProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
