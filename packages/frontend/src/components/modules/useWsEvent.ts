/**
 * useWsEvent — react to backend WebSocket messages inside a widget.
 *
 * useWebSocket re-dispatches every message as a `skyglass:ws` window event,
 * so widgets can listen without App.tsx knowing about them:
 *
 *   useWsEvent('todos', () => refresh());
 */

import { useEffect, useRef } from 'react';

export const WS_EVENT = 'skyglass:ws';

interface WsEventDetail {
  type: string;
  data: unknown;
  timestamp?: number;
}

export function useWsEvent(type: string, handler: (data: unknown) => void) {
  // Keep the latest handler without re-subscribing on every render.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<WsEventDetail>).detail;
      if (detail?.type === type) handlerRef.current(detail.data);
    };
    window.addEventListener(WS_EVENT, listener);
    return () => window.removeEventListener(WS_EVENT, listener);
  }, [type]);
}
