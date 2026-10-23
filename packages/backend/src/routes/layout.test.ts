import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const broadcast = vi.fn();
vi.mock('../server.js', () => ({ broadcast }));

// Keep the route off the real data/layouts/current.json.
const files = new Map<string, string>();
const isLayoutFile = (p: unknown) => typeof p === 'string' && p.endsWith('current.json');
const realExists = fs.existsSync;
const realRead = fs.readFileSync;
const realWrite = fs.writeFileSync;
vi.spyOn(fs, 'existsSync').mockImplementation(((p: fs.PathLike) =>
  isLayoutFile(p) ? files.has(p as string) : realExists(p)) as typeof fs.existsSync);
vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, o?: unknown) =>
  isLayoutFile(p) ? files.get(p as string) : realRead(p, o as BufferEncoding)) as typeof fs.readFileSync);
vi.spyOn(fs, 'writeFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, d: string, o?: unknown) =>
  isLayoutFile(p) ? void files.set(p as string, d) : realWrite(p, d, o as BufferEncoding)) as typeof fs.writeFileSync);

const { default: layoutRoutes } = await import('./layout.js');

describe('PUT /api/layout', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/layout', layoutRoutes);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('persists the layout and broadcasts layout-update with { layout }', async () => {
    const modules = [
      { instanceId: 'clock-1', moduleId: 'digital-clock', position: { x: 0, y: 0 }, size: 'medium', config: {} },
    ];
    const res = await fetch(`${base}/api/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mine', name: 'Mine', modules }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { layout: { id: string; modules: unknown[] } };
    expect(body.layout.modules).toEqual(modules);

    expect(broadcast).toHaveBeenCalledTimes(1);
    const [type, data] = broadcast.mock.calls[0];
    expect(type).toBe('layout-update');
    expect(data).toEqual({ layout: body.layout });

    const stored = await (await fetch(`${base}/api/layout`)).json();
    expect(stored).toEqual(body.layout);
  });

  it('keeps the editor shelf with the layout', async () => {
    const tile = (id: string) => ({ instanceId: id, moduleId: 'metar', position: { x: 0, y: 0 }, size: 'medium', config: {} });
    const res = await fetch(`${base}/api/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: [tile('placed')], shelf: [tile('parked')] }),
    });
    expect(res.status).toBe(200);
    const stored = (await (await fetch(`${base}/api/layout`)).json()) as { modules: unknown[]; shelf: unknown[] };
    expect(stored.modules).toEqual([tile('placed')]);
    expect(stored.shelf).toEqual([tile('parked')]);
  });

  it('does not broadcast when validation fails', async () => {
    broadcast.mockClear();
    const res = await fetch(`${base}/api/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
