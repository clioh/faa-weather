import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_EVENT } from '../components/modules/useWsEvent';

interface WSMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

interface UseWebSocketReturn {
  lastMessage: WSMessage | null;
  isConnected: boolean;
  send: (data: unknown) => void;
}

const RECONNECT_DELAY_MS = 3000;

export function useWebSocket(url: string): UseWebSocketReturn {
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Set when the owning component unmounts so a close event from the socket
  // we are tearing down does not schedule a reconnect.
  const disposedRef = useRef(false);

  const connect = useCallback(() => {
    if (disposedRef.current) return;

    const scheduleReconnect = () => {
      if (disposedRef.current) return;
      reconnectTimeoutRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (disposedRef.current) return;
      console.log('WebSocket disconnected');
      setIsConnected(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      // The browser logs the failure itself and always follows it with
      // onclose, which handles reconnecting. Nothing to report twice.
    };

    ws.onmessage = (event) => {
      let message: WSMessage;
      try {
        message = JSON.parse(event.data) as WSMessage;
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
        return;
      }
      setLastMessage(message);
      // Dispatched here rather than from App's lastMessage effect: React
      // batches state updates, so two messages in one tick would leave App
      // seeing only the second, and widgets (todos, photos) would miss one.
      window.dispatchEvent(new CustomEvent(WS_EVENT, { detail: message }));
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    disposedRef.current = false;
    connect();

    return () => {
      disposedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (!ws) return;
      if (ws.readyState === WebSocket.CONNECTING) {
        // Closing a socket that has not finished its handshake makes the
        // browser log "closed before the connection is established". Let it
        // open, then close it. React StrictMode hits this on every mount.
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { lastMessage, isConnected, send };
}
