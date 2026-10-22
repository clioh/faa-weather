/**
 * useDisplayHold
 *
 * Keeps the mirror's display on while a screen that previews layouts is
 * focused (layout editor, template pickers), so the user can look up from
 * the phone and see the result even when presence detection would have
 * turned the display off.
 *
 * The backend hold is time-limited and renewed while the screen is focused,
 * so a crashed or backgrounded app never leaves the mirror stuck on. On blur
 * the hold is released, which also clears any live preview.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';

const HOLD_SECONDS = 60;
const RENEW_MS = 20_000;

export function useDisplayHold(enabled: boolean): void {
  const active = useRef(false);

  const renew = useCallback(() => {
    api.holdDisplay(HOLD_SECONDS).catch(() => {
      // Mirror unreachable: nothing to hold. The screen still works offline.
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      active.current = true;
      renew();
      const timer = setInterval(renew, RENEW_MS);
      return () => {
        clearInterval(timer);
        active.current = false;
        api.releaseDisplay().catch(() => {});
      };
    }, [enabled, renew])
  );

  // Belt and braces for screens that unmount without a blur event.
  useEffect(
    () => () => {
      if (active.current) {
        api.releaseDisplay().catch(() => {});
      }
    },
    []
  );
}
