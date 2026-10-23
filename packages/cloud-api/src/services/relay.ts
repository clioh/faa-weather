import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { query } from '../db/index.js';

interface MirrorConnection {
  ws: WebSocket;
  mirrorId: string;
  lastPing: number;
}

interface PendingCommand {
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

class RelayService {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, MirrorConnection> = new Map();
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws/relay' });

    this.wss.on('connection', (ws, req) => {
      console.log('New WebSocket connection');
      this.handleConnection(ws, req.url || '');
    });

    // Ping interval to detect dead connections
    this.pingInterval = setInterval(() => {
      this.pingConnections();
    }, 30000);

    console.log('WebSocket relay service initialized');
  }

  private async handleConnection(ws: WebSocket, url: string): Promise<void> {
    // Extract relay token from URL query params
    const urlParams = new URLSearchParams(url.split('?')[1] || '');
    const relayToken = urlParams.get('token');

    if (!relayToken) {
      ws.close(4001, 'Missing relay token');
      return;
    }

    // Validate token and get mirror info
    const { rows } = await query<{ id: string }>('SELECT id FROM mirrors WHERE relay_token = $1', [
      relayToken,
    ]);

    if (rows.length === 0) {
      ws.close(4002, 'Invalid relay token');
      return;
    }

    const mirrorId = rows[0].id;

    // Close existing connection for this mirror if any
    const existing = this.connections.get(mirrorId);
    if (existing) {
      existing.ws.close(4003, 'Replaced by new connection');
    }

    // Store connection
    this.connections.set(mirrorId, {
      ws,
      mirrorId,
      lastPing: Date.now(),
    });

    // Mark mirror as online
    await this.updateMirrorStatus(mirrorId, true);

    console.log(`Mirror ${mirrorId} connected`);

    ws.on('message', (data) => {
      this.handleMessage(mirrorId, data.toString());
    });

    ws.on('close', async () => {
      // Only clean up if this socket is still the registered connection.
      // When a mirror reconnects, the replaced socket's close event fires
      // after the new connection is stored; it must not evict the new entry
      // or mark the mirror offline.
      if (this.connections.get(mirrorId)?.ws !== ws) {
        console.log(`Mirror ${mirrorId} replaced connection closed`);
        return;
      }
      console.log(`Mirror ${mirrorId} disconnected`);
      this.connections.delete(mirrorId);
      await this.updateMirrorStatus(mirrorId, false);
    });

    ws.on('error', (error) => {
      console.error(`Mirror ${mirrorId} WebSocket error:`, error);
    });

    ws.on('pong', () => {
      const conn = this.connections.get(mirrorId);
      if (conn && conn.ws === ws) {
        conn.lastPing = Date.now();
      }
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', mirrorId }));
  }

  private handleMessage(_mirrorId: string, data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.type === 'response' && message.requestId) {
        // Handle command response
        const pending = this.pendingCommands.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCommands.delete(message.requestId);

          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.data);
          }
        }
      }
    } catch (error) {
      console.error('Error parsing message from mirror:', error);
    }
  }

  private async updateMirrorStatus(mirrorId: string, online: boolean): Promise<void> {
    try {
      await query('UPDATE mirrors SET online = $2, last_seen = NOW() WHERE id = $1', [
        mirrorId,
        online,
      ]);
    } catch (error) {
      console.error('Error updating mirror status:', error);
    }
  }

  private pingConnections(): void {
    const now = Date.now();
    const timeout = 60000; // 60 seconds

    for (const [mirrorId, conn] of this.connections) {
      if (now - conn.lastPing > timeout) {
        // Connection seems dead
        console.log(`Mirror ${mirrorId} timed out`);
        // Remove before terminate() so the close handler sees no matching
        // entry and doesn't double-report; status is updated here instead.
        this.connections.delete(mirrorId);
        conn.ws.terminate();
        this.updateMirrorStatus(mirrorId, false);
      } else if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.ping();
      }
    }
  }

  async sendCommand(mirrorId: string, command: string, payload?: unknown): Promise<unknown> {
    const conn = this.connections.get(mirrorId);
    if (!conn) {
      throw new Error('Mirror not connected');
    }

    if (conn.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Mirror connection not ready');
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error('Command timed out'));
      }, 30000);

      this.pendingCommands.set(requestId, { resolve, reject, timeout });

      conn.ws.send(
        JSON.stringify({
          type: 'command',
          requestId,
          command,
          payload,
        })
      );
    });
  }

  isMirrorConnected(mirrorId: string): boolean {
    const conn = this.connections.get(mirrorId);
    return conn !== undefined && conn.ws.readyState === WebSocket.OPEN;
  }

  getConnectedMirrors(): string[] {
    return Array.from(this.connections.keys());
  }

  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    for (const conn of this.connections.values()) {
      conn.ws.close(1001, 'Server shutting down');
    }

    this.connections.clear();

    if (this.wss) {
      this.wss.close();
    }
  }
}

export const relayService = new RelayService();
