/**
 * Radar — RainViewer precipitation over a dark basemap, edge to edge.
 *
 * Tiles are composited on a canvas centred on the exact location (not the
 * containing tile), with a location dot, a frame timestamp, and a soft mask
 * at the edges so the map floats on the black glass.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleProps, resolveLocation } from './index';
import { ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { formatLocalTime } from './aviationFormat';
import './RadarModule.css';

interface RainViewerMaps {
  host: string;
  radar: {
    past: Array<{ time: number; path: string }>;
    nowcast?: Array<{ time: number; path: string }>;
  };
}

interface Frame {
  time: number;
  path: string;
  forecast: boolean;
}

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
// Retina radar tiles drawn at 256 CSS px keep precipitation crisp on a 4K panel.
const TILE_PX = 512;
// Esri's dark canvas needs no API key; note its {z}/{y}/{x} order.
const BASEMAP = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
const RADAR_TILE = (host: string, path: string, z: number, x: number, y: number) =>
  `${host}${path}/${TILE_PX}/${z}/${x}/${y}/2/1_1.png`;
const FRAME_MS = 600;
const HOLD_LAST_MS = 1800;

/** Fractional tile coordinates (Web Mercator). */
function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latRad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

export function RadarModule({ config, latitude, longitude, timezone }: ModuleProps) {
  const location = resolveLocation(config, { latitude, longitude, timezone });
  const zoom = Math.min(7, Math.max(3, Number(config.zoom) || 6));
  const animated = config.animated !== false;

  const { data, loading, error } = useModuleData<RainViewerMaps>(location ? RAINVIEWER_API : null, {
    refreshMs: 5 * 60_000,
  });

  const frames = useMemo<Frame[]>(() => {
    if (!data?.radar?.past) return [];
    return [
      ...data.radar.past.map((f) => ({ ...f, forecast: false })),
      ...(data.radar.nowcast ?? []).map((f) => ({ ...f, forecast: true })),
    ];
  }, [data]);

  const latestPast = Math.max(0, (data?.radar?.past?.length ?? 1) - 1);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(latestPast);
  }, [latestPast, frames]);

  useEffect(() => {
    if (!animated || frames.length < 2) return;
    const last = frames.length - 1;
    const id = window.setTimeout(
      () => setIndex((i) => (i >= last ? 0 : i + 1)),
      index === latestPast || index === last ? HOLD_LAST_MS : FRAME_MS
    );
    return () => window.clearTimeout(id);
  }, [animated, frames.length, index, latestPast]);

  const frame = frames[Math.min(index, frames.length - 1)];

  let content;
  if (!location) {
    content = <ModuleEmpty title="No location set" hint="Set a location in the app" />;
  } else if (loading) {
    content = <ModuleLoading />;
  } else if (!data || frames.length === 0) {
    content = <ModuleError title="Radar unavailable" hint={error ? 'Retrying automatically' : 'No radar frames'} />;
  } else {
    content = (
      <div className="radar">
        <RadarCanvas
          lat={location.latitude}
          lon={location.longitude}
          zoom={zoom}
          host={data.host}
          frames={frames}
          frame={frame}
        />
        {frame && (
          <span className="radar-time mono">
            {frame.forecast && <span className="radar-fcst">FCST</span>}
            {formatLocalTime(frame.time * 1000, location.timezone)}
          </span>
        )}
        <span className="radar-credit">Esri · RainViewer</span>
      </div>
    );
  }

  return (
    <ModuleFrame flush className="radar-frame">
      {content}
    </ModuleFrame>
  );
}

interface CanvasProps {
  lat: number;
  lon: number;
  zoom: number;
  host: string;
  frames: Frame[];
  frame: Frame | undefined;
}

function RadarCanvas({ lat, lon, zoom, host, frames, frame }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<string, HTMLImageElement>());
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Bumped when a tile finishes loading so the current frame repaints.
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const image = useCallback((url: string) => {
    let img = cache.current.get(url);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.onload = () => setLoaded((n) => n + 1);
      img.src = url;
      cache.current.set(url, img);
    }
    return img;
  }, []);

  // Which tiles cover the canvas, and where the centre sits in CSS px.
  const layout = useMemo(() => {
    if (!size.w || !size.h) return null;
    // Scale tiles up a little on big tiles so a city-level view is legible.
    const tile = 256 * Math.min(2, Math.max(1, Math.min(size.w, size.h) / 420));
    const c = project(lat, lon, zoom);
    const originX = size.w / 2 - c.x * tile;
    const originY = size.h / 2 - c.y * tile;
    const n = 2 ** zoom;
    const tiles: Array<{ x: number; y: number; px: number; py: number }> = [];
    for (let ty = Math.floor(-originY / tile); ty * tile + originY < size.h; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(-originX / tile); tx * tile + originX < size.w; tx++) {
        tiles.push({ x: ((tx % n) + n) % n, y: ty, px: tx * tile + originX, py: ty * tile + originY });
      }
    }
    return { tile, tiles };
  }, [size, lat, lon, zoom]);

  // Warm the cache for every frame so animation does not flicker.
  useEffect(() => {
    if (!layout) return;
    for (const t of layout.tiles) {
      image(BASEMAP(zoom, t.x, t.y));
      for (const f of frames) image(RADAR_TILE(host, f.path, zoom, t.x, t.y));
    }
  }, [layout, frames, host, zoom, image]);

  // Drop images for frames RainViewer no longer lists.
  useEffect(() => {
    const live = new Set(frames.map((f) => f.path));
    for (const url of cache.current.keys()) {
      const path = url.startsWith(host) ? url.slice(host.length).split(`/${TILE_PX}/`)[0] : null;
      if (path && !live.has(path)) cache.current.delete(url);
    }
  }, [frames, host]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout || !frame) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr)) canvas.width = Math.round(size.w * dpr);
    if (canvas.height !== Math.round(size.h * dpr)) canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // A failed tile has no pixels and is skipped, leaving black glass.
    const draw = (img: HTMLImageElement, px: number, py: number) => {
      if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, px, py, layout.tile, layout.tile);
    };
    for (const t of layout.tiles) draw(image(BASEMAP(zoom, t.x, t.y)), t.px, t.py);
    ctx.globalAlpha = 0.8;
    for (const t of layout.tiles) draw(image(RADAR_TILE(host, frame.path, zoom, t.x, t.y)), t.px, t.py);
    ctx.globalAlpha = 1;

    const cx = size.w / 2;
    const cy = size.h / 2;
    const r = Math.max(3, Math.min(size.w, size.h) * 0.012);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }, [layout, frame, size, host, zoom, image, loaded]);

  return <canvas ref={canvasRef} className="radar-canvas" aria-label="Precipitation radar" />;
}
