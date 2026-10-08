/**
 * Cloud Relay Client
 *
 * Maintains a persistent WebSocket connection to the cloud relay service
 * for remote mirror access when not on the local network.
 */

import { WebSocket } from 'ws';
import { getDb, getMirrorId } from '../db/index.js';

// Types
interface RelayCommand {
  type: 'command';
  requestId: string;
  command: 'getLayout' | 'updateLayout' | 'getStatus' | 'displayOn' | 'displayOff';
  payload?: Record<string, unknown>;
}

interface CommandHandler {
  (payload?: Record<string, unknown>): Promise<unknown>;
}

class RelayClient {
  private ws: WebSocket | null = null;
  private relayUrl: string;
  private relayToken: string | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private commandHandlers: Map<string, CommandHandler> = new Map();

  constructor(relayUrl: string = 'wss://api.magicmirror.app/ws/relay') {
    this.relayUrl = relayUrl;
    this.setupDefaultHandlers();
  }

  private setupDefaultHandlers(): void {
    // Register default command handlers
    this.commandHandlers.set('getStatus', async () => {
      return {
        mirrorId: getMirrorId(),
        online: true,
        timestamp: new Date().toISOString(),
      };
    });
  }

  /**
   * Register a command handler
   */
  registerHandler(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command, handler);
  }

  /**
   * Get stored relay token from database
   */
  private getStoredToken(): string | null {
    try {
      const row = getDb()
        .prepare('SELECT value FROM mirror_settings WHERE key = ?')
        .get('relayToken') as { value: string } | undefined;
      return row?.value || null;
    } catch {
      return null;
    }
  }

  /**
   * Store relay token in database
   */
  storeToken(token: string): void {
    try {
      getDb()
        .prepare('INSERT OR REPLACE INTO mirror_settings (key, value) VALUES (?, ?)')
        .run('relayToken', token);
      this.relayToken = token;
      console.log('[RelayClient] Stored relay token');
    } catch (error) {
      console.error('[RelayClient] Failed to store relay token:', error);
    }
  }

  /**
   * Clear stored relay token
   */
  clearToken(): void {
    try {
      getDb().prepare('DELETE FROM mirror_settings WHERE key = ?').run('relayToken');
      this.relayToken = null;
      console.log('[RelayClient] Cleared relay token');
    } catch (error) {
      console.error('[RelayClient] Failed to clear relay token:', error);
    }
  }

  /**
   * Connect to the cloud relay service
   */
  connect(token?: string): void {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      console.log('[RelayClient] Already connected or connecting');
      return;
    }

    // Use provided token, or stored token
    const relayToken = token || this.relayToken || this.getStoredToken();
    if (!relayToken) {
      console.log('[RelayClient] No relay token available, not connecting');
      return;
    }

    this.relayToken = relayToken;
    this.isConnecting = true;

    const url = `${this.relayUrl}?token=${encodeURIComponent(relayToken)}`;
    console.log('[RelayClient] Connecting to relay service...');

    try {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        console.log('[RelayClient] Connected to relay service');
        this.isConnecting = false;
        this.startPing();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[RelayClient] Disconnected: ${code} - ${reason.toString()}`);
        this.cleanup();
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[RelayClient] WebSocket error:', error);
        this.isConnecting = false;
      });
    } catch (error) {
      console.error('[RelayClient] Failed to connect:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming message from relay
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      if (message.type === 'connected') {
        console.log('[RelayClient] Relay confirmed connection');
        return;
      }

      if (message.type === 'command') {
        await this.handleCommand(message as RelayCommand);
      }
    } catch (error) {
      console.error('[RelayClient] Error parsing message:', error);
    }
  }

  /**
   * Handle command from cloud
   */
  private async handleCommand(message: RelayCommand): Promise<void> {
    const { requestId, command, payload } = message;
    console.log(`[RelayClient] Received command: ${command}`);

    const handler = this.commandHandlers.get(command);
    if (!handler) {
      this.sendResponse(requestId, null, `Unknown command: ${command}`);
      return;
    }

    try {
      const result = await handler(payload);
      this.sendResponse(requestId, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Command failed';
      this.sendResponse(requestId, null, errorMessage);
    }
  }

  /**
   * Send response back to cloud
   */
  private sendResponse(requestId: string, data: unknown, error?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[RelayClient] Cannot send response: not connected');
      return;
    }

    const response = {
      type: 'response',
      requestId,
      data,
      error,
    };

    this.ws.send(JSON.stringify(response));
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    // Only reconnect if we have a token
    if (!this.relayToken && !this.getStoredToken()) {
      return;
    }

    console.log('[RelayClient] Scheduling reconnect in 10 seconds...');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 10000);
  }

  /**
   * Cleanup connection resources
   */
  private cleanup(): void {
    this.isConnecting = false;
    this.stopPing();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  /**
   * Disconnect from relay service
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.cleanup();
    }

    console.log('[RelayClient] Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; hasToken: boolean } {
    return {
      connected: this.isConnected(),
      hasToken: !!(this.relayToken || this.getStoredToken()),
    };
  }
}

// Create singleton instance
const relayUrl = process.env.CLOUD_RELAY_URL || 'wss://api.magicmirror.app/ws/relay';
export const relayClient = new RelayClient(relayUrl);
