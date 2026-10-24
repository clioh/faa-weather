/**
 * SkyGlass phone app (iOS and Android), bundle ID / package com.skyglass.app
 *
 * One place for everything the site needs to know about the app: store links for the
 * /app, /connect and /invite pages, and the identifiers the build turns into the app-link
 * files (vite.config.ts writes /.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json from these values; see docs/CLOUD_SERVICE.md, "App links").
 *
 * FILL THESE IN WHEN THE APPS ARE REGISTERED. Until then:
 * - a null store URL shows "Coming soon to the App Store / Google Play" instead of a link;
 * - APPLE_TEAM_ID null means no apple-app-site-association is published (the build warns),
 *   so iOS Universal Links don't open the app and links land on the web page instead;
 * - an empty ANDROID_CERT_SHA256 means no assetlinks.json is published (the build warns),
 *   so Android App Links aren't verified and links land on the web page instead.
 * The web pages still work in every case: they offer "Open in SkyGlass app" (custom scheme).
 *
 * This file is imported by vite.config.ts, so keep it free of browser-only code.
 */

/** App Store listing, e.g. https://apps.apple.com/app/skyglass/id1234567890. */
export const APP_STORE_URL: string | null = null

/** Google Play listing, e.g. https://play.google.com/store/apps/details?id=com.skyglass.app. */
export const PLAY_STORE_URL: string | null = null

/** Custom URL scheme the app registers (skyglass://connect, skyglass://invite). */
export const APP_URL_SCHEME = 'skyglass'

/** iOS bundle ID and Android package name. */
export const IOS_BUNDLE_ID = 'com.skyglass.app'
export const ANDROID_PACKAGE = 'com.skyglass.app'

/**
 * Apple Developer Team ID (10 characters, Apple Developer account > Membership).
 * The iOS app ID in apple-app-site-association is `${APPLE_TEAM_ID}.com.skyglass.app`.
 */
export const APPLE_TEAM_ID: string | null = null

/**
 * SHA-256 fingerprints of the Android signing certificates, as colon-separated upper-case hex
 * ("AB:CD:..."). Use the Play App Signing key (Play Console > Test and release > App integrity)
 * and, if you sideload debug or internal builds, their upload/debug keys too
 * (`keytool -list -v -keystore <file>` or `eas credentials`).
 */
export const ANDROID_CERT_SHA256: string[] = []

/** Paths the app claims as Universal Links / App Links. The app's config must list the same. */
export const APP_LINK_PATHS = ['/connect', '/invite']
