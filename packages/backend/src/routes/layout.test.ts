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

// display.orientation as the route reads it from config.yaml.
const display = vi.hoisted(() => ({ orientation: 'landscape' as string }));
vi.mock('../config/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config/index.js')>();
  return {
    ...mod,
    loadConfig: () => {
      const c = mod.loadConfig();
      return { ...c, display: { ...c.display, orientation: display.orientation } };
    },
  };
});

const { default: layoutRoutes, defaultLayout } = await import('./layout.js');

// Same presets as packages/mobile/lib/modules.ts SIZE_DIMENSIONS (12x8 grid).
const SIZES: Record<string, { cols: number; rows: number }> = {
  small: { cols: 3, rows: 2 },
  medium: { cols: 4, rows: 3 },
  large: { cols: 6, rows: 4 },
  wide: { cols: 6, rows: 2 },
  tall: { cols: 3, rows: 4 },
  full: { cols: 12, rows: 4 },
};

/** Cells covered by each tile; throws on a tile off the grid or an overlap. */
function coveredCells(modules: { position: { x: number; y: number }; size: string; instanceId: string }[]): number {
  const taken = new Set<string>();
  for (const m of modules) {
    const { cols, rows } = SIZES[m.size];
    const { x, y } = m.position;
    expect(x >= 0 && y >= 0 && x + cols <= 12 && y + rows <= 8, `${m.instanceId} inside the grid`).toBe(true);
    for (let r = y; r < y + rows; r++) {
      for (let c = x; c < x + cols; c++) {
        expect(taken.has(`${c},${r}`), `${m.instanceId} overlaps at ${c},${r}`).toBe(false);
        taken.add(`${c},${r}`);
      }
    }
  }
  return taken.size;
}

describe('default layout', () => {
  it('pins no airport, so aviation widgets use the configured one', () => {
    for (const orientation of ['landscape', 'portrait-cw'] as const) {
      for (const m of defaultLayout(orientation).modules) {
        expect(m.config).not.toHaveProperty('icao');
        expect(m.config).not.toHaveProperty('showDecoded');
      }
    }
  });

  it('fits the grid without overlaps; portrait fills every row', () => {
    coveredCells(defaultLayout('landscape').modules);
    expect(coveredCells(defaultLayout('portrait-cw').modules)).toBe(12 * 8);
  });

  it('portrait keeps METAR large and TAF six columns wide', () => {
    const modules = defaultLayout('portrait-ccw').modules;
    expect(modules.find((m) => m.moduleId === 'metar')?.size).toBe('large');
    expect(SIZES[modules.find((m) => m.moduleId === 'taf')!.size].cols).toBeGreaterThanOrEqual(6);
  });

  it('hands out a fresh copy each time', () => {
    defaultLayout().modules[0].config.mutated = true;
    expect(defaultLayout().modules[0].config).not.toHaveProperty('mutated');
  });
});

describe('GET /api/layout with nothing saved', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    files.clear();
    const app = express();
    app.use('/api/layout', layoutRoutes);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    display.orientation = 'landscape';
  });

  it('serves the default for the mirror orientation', async () => {
    display.orientation = 'landscape';
    const landscape = (await (await fetch(`${base}/api/layout`)).json()) as { modules: unknown[] };
    expect(landscape.modules).toEqual(defaultLayout('landscape').modules);

    display.orientation = 'portrait-cw';
    const portrait = (await (await fetch(`${base}/api/layout`)).json()) as { modules: unknown[] };
    expect(portrait.modules).toEqual(defaultLayout('portrait-cw').modules);
    expect(portrait.modules).not.toEqual(landscape.modules);
  });
});

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
