import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';

const queryMock = vi.fn(async (sql: string, _params?: unknown[]) => {
  if (sql.startsWith('SELECT id FROM mirrors')) {
    return { rows: [{ id: 'mirror-1' }] };
  }
  return { rows: [] };
});

vi.mock('../db/index.js', () => ({
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
}));

const { relayService } = await import('./relay.js');

function connect(port: number): Promise<{ ws: WebSocket; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/relay?token=tok`);
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'connected') resolve({ ws, closed });
    });
    ws.on('error', reject);
  });
}

const offlineUpdates = () =>
  queryMock.mock.calls.filter(
    ([sql, params]) => sql.startsWith('UPDATE mirrors') && (params as unknown[])[1] === false
  ).length;

describe('RelayService reconnect', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    server = http.createServer();
    relayService.initialize(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    relayService.shutdown();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('keeps the new connection registered when the replaced socket closes', async () => {
    const first = await connect(port);
    expect(relayService.isMirrorConnected('mirror-1')).toBe(true);

    const second = await connect(port);
    // Old socket is closed by the server with the "replaced" code
    expect(await first.closed).toBe(4003);
    // Let the server-side close handler for the old socket run
    await new Promise((r) => setTimeout(r, 50));

    expect(relayService.getConnectedMirrors()).toEqual(['mirror-1']);
    expect(relayService.isMirrorConnected('mirror-1')).toBe(true);
    expect(offlineUpdates()).toBe(0);

    // Closing the current socket does remove it and mark offline
    second.ws.close();
    await second.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(relayService.getConnectedMirrors()).toEqual([]);
    expect(offlineUpdates()).toBe(1);
  });
});
