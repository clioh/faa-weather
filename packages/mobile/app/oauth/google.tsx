/**
 * Landing route for the Google sign-in deep link (skyglass://oauth/google).
 * The add-calendar screen normally receives the redirect through
 * WebBrowser.openAuthSessionAsync; on Android the link can also be routed
 * here. Step out of the way: pop back to whatever was open (the add flow,
 * still waiting for its browser result), or land on Calendars.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Spinner } from '@/components/ui';
import { router } from 'expo-router';
import { colors } from '@/lib/theme';

export default function GoogleOAuthRedirect() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/calendars');
  }, []);

  return (
    <View style={styles.container}>
      <Spinner />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
