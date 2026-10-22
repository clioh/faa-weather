/**
 * Mirror Camera Preview
 *
 * Shows the live MJPEG stream from the presence server (/video_feed).
 * React Native's <Image> cannot render multipart/x-mixed-replace responses:
 * the request never completes, so nothing is ever drawn. Browsers handle
 * MJPEG in a plain <img>, so the stream is embedded in a minimal HTML page
 * inside a WebView.
 *
 * The WebView is transparent until the first frame paints, so the
 * placeholder beneath it (spinner + "Connecting to mirror...") shows while
 * the stream connects and comes back if the stream drops. The page retries
 * on its own.
 */

import { useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { Text } from '@/components/ui/Text';
import { WebView } from 'react-native-webview';
import { colors, spacing, typography } from '@/lib/theme';

interface MirrorCameraPreviewProps {
  /** Full MJPEG stream URL, e.g. http://192.168.1.20:5000/video_feed. Null while unknown. */
  streamUrl: string | null;
  style?: StyleProp<ViewStyle>;
  placeholderText?: string;
}

const RETRY_MS = 1500;

function buildStreamPage(streamUrl: string): string {
  // JSON.stringify yields a safe JS string literal for the URL.
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
  img.hidden { visibility: hidden; }
</style>
</head>
<body>
<img id="stream" class="hidden" alt="">
<script>
  var img = document.getElementById('stream');
  var base = ${JSON.stringify(streamUrl)};
  var retry = null;
  function connect() {
    img.className = 'hidden';
    img.src = base + (base.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
  }
  img.onload = function () { img.className = ''; };
  img.onerror = function () {
    clearTimeout(retry);
    retry = setTimeout(connect, ${RETRY_MS});
  };
  connect();
</script>
</body>
</html>`;
}

export function MirrorCameraPreview({
  streamUrl,
  style,
  placeholderText = 'Connecting to mirror...',
}: MirrorCameraPreviewProps) {
  const source = useMemo(
    () => (streamUrl ? { html: buildStreamPage(streamUrl), baseUrl: streamUrl } : null),
    [streamUrl]
  );

  return (
    <View style={[styles.container, style]}>
      <View style={styles.placeholder}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.placeholderText}>{placeholderText}</Text>
      </View>
      {source && (
        <WebView
          source={source}
          style={styles.webview}
          originWhitelist={['*']}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          cacheEnabled={false}
          setBuiltInZoomControls={false}
          pointerEvents="none"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  placeholderText: {
    ...typography.body,
    color: colors.textMuted,
  },
  webview: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
});
