/**
 * Mirror orientation (config display.orientation, docs/design/MIRROR_AND_ORIENTATION.md).
 *
 * The panel can be mounted landscape or turned a quarter either way. The Pi's
 * HDMI output stays landscape, so for a portrait mount the mirror turns its
 * own UI in CSS: OrientationFrame sets data-rotate on <html> and theme.css
 * turns .orientation-frame and swaps --app-w / --app-h.
 */

export type MirrorOrientation = 'landscape' | 'portrait-cw' | 'portrait-ccw';

/** Shape of GET /api/setup/orientation and the WS `orientation` event. */
export interface OrientationState {
  /** Saved in config.yaml. */
  orientation: MirrorOrientation;
  /** Being tried from the app's Orientation step; null when none is. */
  preview: MirrorOrientation | null;
}

/** Same reading as the backend: the legacy value `portrait` is portrait-cw. */
function normalizeOrientation(value: unknown): MirrorOrientation {
  if (value === 'portrait') return 'portrait-cw';
  return value === 'portrait-cw' || value === 'portrait-ccw' ? value : 'landscape';
}

export function parseOrientationState(data: unknown): OrientationState | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { orientation?: unknown; preview?: unknown };
  return {
    orientation: normalizeOrientation(d.orientation),
    preview: d.preview ? normalizeOrientation(d.preview) : null,
  };
}

/**
 * Degrees to turn the UI so it reads upright. A panel turned clockwise
 * ("turned right") puts the screen's left edge at the top, so the content
 * turns -90°; turned left, +90°. Nothing turns when the output is already
 * portrait (rotated by the OS, or a tall browser window in development).
 */
export function uiRotation(
  orientation: MirrorOrientation,
  outputIsLandscape: boolean
): -90 | 0 | 90 {
  if (!outputIsLandscape || orientation === 'landscape') return 0;
  return orientation === 'portrait-cw' ? -90 : 90;
}

/** "Landscape", "Portrait, turned right", "Portrait, turned left". */
export function orientationLabel(orientation: MirrorOrientation): string {
  if (orientation === 'portrait-cw') return 'Portrait, turned right';
  if (orientation === 'portrait-ccw') return 'Portrait, turned left';
  return 'Landscape';
}
