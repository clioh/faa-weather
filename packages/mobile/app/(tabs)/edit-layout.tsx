/**
 * Placeholder behind the Layout tab. The tab press opens /editor directly
 * (see (tabs)/_layout.tsx); this only runs if /edit-layout is opened by URL.
 */

import { Redirect } from 'expo-router';

export default function EditLayoutTab() {
  return <Redirect href="/editor" />;
}
