/**
 * Navigation helpers
 *
 * One place for the app's "where does back go" rules so every screen behaves
 * the same way:
 *
 * - goBack(fallback): pop if there is anything to pop to. Screens entered with
 *   router.replace() (resuming onboarding, QR deep links) have nothing on the
 *   stack, so they land on their logical parent instead.
 * - goHome(): return to the mirror list and drop everything above it, so a
 *   later swipe-back can't land on a stale dashboard.
 * - goToDashboard(): same idea for the dashboard after connecting to a mirror
 *   or skipping setup.
 *
 * router.dismissTo() pops to the route when it is already in the stack and
 * otherwise replaces the current screen with it, which covers both the pushed
 * and the replaced case.
 */

import { router, type Href } from 'expo-router';

export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}

export function goHome(): void {
  router.dismissTo('/');
}

export function goToDashboard(): void {
  router.dismissTo('/dashboard');
}
