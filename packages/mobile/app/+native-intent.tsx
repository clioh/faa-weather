/**
 * Native intent: rewrites incoming links before expo-router routes them.
 *
 * Universal Links / App Links for skyglass.dev (/connect, /invite) carry
 * their values in the URL fragment, which expo-router doesn't turn into
 * route params. expo-router hands this function the raw URL the OS opened
 * the app with (fragment included, on iOS and Android, at launch and while
 * running); lib/appLinks rewrites the skyglass.dev forms to
 * /connect?host=… or /invite?host=… and passes everything else through.
 */

import { redirectAppLink } from '@/lib/appLinks';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return redirectAppLink(path);
  } catch (err) {
    console.warn('[native-intent] Could not read link', err);
    return '/';
  }
}
