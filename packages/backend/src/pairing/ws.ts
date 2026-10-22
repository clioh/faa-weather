/**
 * Authenticated WebSocket endpoint (docs/SECURITY.md).
 *
 * Upgrades are classified before the handshake completes:
 *   - local callers (kiosk) need nothing;
 *   - phones offer subprotocols ['skyglass', 'skyglass.token.<token>'];
 *     the server selects 'skyglass' and never echoes the token protocol;
 *   - anything else gets 401 (or 400 for an offer without 'skyglass') and
 *     the socket is destroyed without upgrading.
 *
 * The `pairing` event family only goes to local sockets (the mirror's own
 * screen). Revoked devices' sockets are closed.
 */

import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { classify, effectiveClientIp, type AuthInfo, type DeviceAuthenticator } from './trust.js';

export const WS_PROTOCOL = 'skyglass';
export const WS_TOKEN_PROTOCOL_PREFIX = 'skyglass.token.';
/** Close code sent to sockets of an unpaired (revoked) phone. */
export const WS_CLOSE_REVOKED = 4401;

/** Events only the mirror's own (local) sockets receive. */
export const LOCAL_ONLY_EVENTS = new Set(['pairing']);

function offeredProtocols(req: IncomingMessage): string[] {
  const header = req.headers['sec-websocket-protocol'];
  if (typeof header !== 'string') return [];
  return header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Pick the protocol to answer with: only ever 'skyglass'. */
export function selectProtocol(protocols: Set<string>): string | false {
  return protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false;
}

export type UpgradeDecision = { ok: true; auth: AuthInfo } | { ok: false; status: 400 | 401; reason: string };

export function authorizeUpgrade(req: IncomingMessage, authenticateDevice: DeviceAuthenticator): UpgradeDecision {
  const protocols = offeredProtocols(req);
  if (protocols.length > 0 && !protocols.includes(WS_PROTOCOL)) {
    return { ok: false, status: 400, reason: 'unsupported_protocol' };
  }
  const tokenProtocol = protocols.find((p) => p.startsWith(WS_TOKEN_PROTOCOL_PREFIX));
  const token = tokenProtocol ? tokenProtocol.slice(WS_TOKEN_PROTOCOL_PREFIX.length) : null;
  const auth = classify(
    {
      ip: effectiveClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']),
      headers: req.headers,
      token,
    },
    authenticateDevice
  );
  if (auth.kind === 'none') return { ok: false, status: 401, reason: 'pairing_required' };
  return { ok: true, auth };
}

function reject(socket: Duplex, status: 400 | 401, reason: string): void {
  const body = JSON.stringify(
    status === 401
      ? { error: 'pairing_required', message: "This phone isn't paired with this mirror." }
      : { error: reason, message: `Offer the "${WS_PROTOCOL}" WebSocket subprotocol.` }
  );
  const statusText = status === 401 ? 'Unauthorized' : 'Bad Request';
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      '\r\n' +
      body
  );
  socket.destroy();
}

export class WsHub {
  readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, AuthInfo>();

  constructor(private readonly authenticateDevice: DeviceAuthenticator) {
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => selectProtocol(protocols),
    });
    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, auth: AuthInfo) => {
      this.clients.set(ws, auth);
      console.log(`Client connected (${auth.kind}). Total clients:`, this.clients.size);
      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('Client disconnected. Total clients:', this.clients.size);
      });
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  /** Handle 'upgrade' on this HTTP server: authenticate, then hand to ws. */
  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let decision: UpgradeDecision;
      try {
        decision = authorizeUpgrade(req, this.authenticateDevice);
      } catch (error) {
        console.error('[WS] Upgrade check failed:', error);
        decision = { ok: false, status: 401, reason: 'pairing_required' };
      }
      if (!decision.ok) {
        reject(socket, decision.status, decision.reason);
        return;
      }
      const { auth } = decision;
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req, auth);
      });
    });
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Send an event to every authenticated socket; LOCAL_ONLY_EVENTS go to
   * local sockets only.
   */
  broadcast(type: string, data: unknown): void {
    const localOnly = LOCAL_ONLY_EVENTS.has(type);
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    for (const [client, auth] of this.clients) {
      if (localOnly && auth.kind !== 'local') continue;
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  }

  /** Close every socket of a revoked device. */
  closeDevice(deviceId: string): void {
    for (const [client, auth] of this.clients) {
      if (auth.kind === 'device' && auth.deviceId === deviceId) {
        client.close(WS_CLOSE_REVOKED, 'device_revoked');
        // Do not wait for the close handshake of a misbehaving client.
        setTimeout(() => client.terminate(), 1000).unref?.();
        this.clients.delete(client);
      }
    }
  }
}
