/**
 * Live orientation preview for the app's Orientation step.
 *
 * While the phone shows the step, each card it taps is applied to the mirror
 * here without touching config.yaml, and the mirror draws its "This way up?"
 * check. Saving or going back clears it. A preview also expires on its own,
 * so a phone that dies mid-step can't leave the check on screen.
 */

import { EventEmitter } from 'events';
import type { MirrorOrientation } from '../config/index.js';

/** Long enough to walk to the mirror and back; the app re-sends on every tap. */
export const ORIENTATION_PREVIEW_MS = 5 * 60_000;

export class OrientationPreview extends EventEmitter {
  private value: MirrorOrientation | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ttlMs: number = ORIENTATION_PREVIEW_MS) {
    super();
  }

  /** The orientation being previewed, or null when none is. */
  current(): MirrorOrientation | null {
    return this.value;
  }

  /** Show `orientation` on the mirror (and its check screen) until cleared or expired. */
  set(orientation: MirrorOrientation): void {
    this.stopTimer();
    this.timer = setTimeout(() => this.clear(), this.ttlMs);
    this.timer.unref?.();
    this.value = orientation;
    this.emit('change', orientation);
  }

  clear(): void {
    this.stopTimer();
    if (this.value === null) return;
    this.value = null;
    this.emit('change', null);
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Process-wide instance; server.ts broadcasts its changes to the display. */
export const orientationPreview = new OrientationPreview();
