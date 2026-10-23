/**
 * Root Layout
 * Sets up navigation, theme, and global providers
 */

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Per-weight imports so only these faces are bundled (the package index pulls
// in every weight and italic).
import { Inter_200ExtraLight } from '@expo-google-fonts/inter/200ExtraLight';
import { Inter_300Light } from '@expo-google-fonts/inter/300Light';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { UserProvider } from '@/context/UserContext';
import { HeaderBackButton } from '@/components/ScreenHeader';
import { goBack } from '@/lib/navigation';
import { usePairingRedirect } from '@/lib/pairing';
import { colors, fonts } from '@/lib/theme';

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
          fontFamily: fonts.uiMedium,
          fontSize: 16,
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
        Mirror · Layout · Settings tabs (/dashboard, /settings). The dashboard
        is entered with replace(), so the tabs are the bottom of the stack; the
        dashboard draws its own header with the way back to the mirror list
        and the profile.
      */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Pushed (not modal); same back control as every other screen. */}
      <Stack.Screen name="updates" options={{ title: 'Software updates', ...pushedHeader }} />
      {/* These screens draw their own ScreenHeader. */}
      <Stack.Screen name="profile" options={{ headerShown: false }} />
      <Stack.Screen name="mirrors" options={{ headerShown: false }} />
      <Stack.Screen name="editor" options={{ headerShown: false }} />
      <Stack.Screen name="templates" options={{ headerShown: false }} />
      <Stack.Screen name="calendars" options={{ headerShown: false }} />
      <Stack.Screen name="add-calendar" options={{ headerShown: false }} />
      <Stack.Screen name="schedule" options={{ headerShown: false }} />
      {/* Opened by lib/pairing only; pops itself when paired. */}
      <Stack.Screen name="pair" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="invite" options={{ headerShown: false }} />
      <Stack.Screen name="invite-person" options={{ headerShown: false }} />
      <Stack.Screen name="person" options={{ headerShown: false }} />
      <Stack.Screen name="paired-phones" options={{ headerShown: false }} />
      {/* Deep-link target for Google sign-in; pops itself straight away. */}
      <Stack.Screen name="oauth/google" options={{ headerShown: false, animation: 'none' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_200ExtraLight,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  const fontsReady = fontsLoaded || fontError != null;

  // Hold the splash screen until the fonts are in (or failed, in which case
  // text falls back to the system font).
  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

  // GestureHandlerRootView must wrap everything that uses gesture-handler
  // gestures (the layout editor canvas).
  return (
    <UserProvider>
      <GestureHandlerRootView style={styles.container}>
        <StatusBar style="light" />
        <RootLayoutNav />
      </GestureHandlerRootView>
    </UserProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
