/**
 * Dev build flag
 *
 * True in Metro dev bundles and in Release builds made by
 * `npm run dev:e2e -- --device`, which sets EXPO_PUBLIC_SKYGLASS_DEV_BUILD=1
 * so the embedded bundle keeps the dev-only tools (QR reset, Reset App Data,
 * UI primitives) without Metro. Store builds never set it.
 */

export const isDevBuild = __DEV__ || process.env.EXPO_PUBLIC_SKYGLASS_DEV_BUILD === '1';
