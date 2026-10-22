/**
 * Photos — a crossfading slideshow of photos uploaded from the phone.
 * Two stacked layers: the next photo is preloaded into the hidden one, then
 * the layers swap opacity, so a slow decode never shows a blank frame.
 */

import { useEffect, useRef, useState } from 'react';
import { ModuleProps } from './index';
import { ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { useWsEvent } from './useWsEvent';
import './PhotoFrameModule.css';

interface Photo {
  id: string;
  url: string;
  uploadedAt?: string;
  size?: number;
}

interface PhotosResponse {
  photos: Photo[];
}

interface Slides {
  layers: [string | null, string | null];
  front: 0 | 1;
}

export function PhotoFrameModule({ config }: ModuleProps) {
  const seconds = Number(config.interval);
  const intervalMs = (Number.isFinite(seconds) ? Math.min(600, Math.max(5, seconds)) : 30) * 1000;
  const fit = config.fit === 'contain' ? 'contain' : 'cover';

  const { data, loading, error, refresh } = useModuleData<PhotosResponse>('/api/photos', {
    refreshMs: 60_000,
  });
  useWsEvent('photos', () => {
    void refresh();
  });

  const urls = (data?.photos ?? []).map((p) => p.url);
  const urlKey = urls.join('|');

  const [slides, setSlides] = useState<Slides>({ layers: [null, null], front: 0 });
  const indexRef = useRef(0);

  // Load `url` off-screen, then fade it in over the current photo.
  const showRef = useRef((url: string) => {
    const img = new Image();
    img.onload = () => {
      setSlides((prev) => {
        if (prev.layers[prev.front] === url) return prev;
        const back = prev.front === 0 ? 1 : 0;
        const layers: Slides['layers'] = [...prev.layers];
        layers[back] = url;
        return { layers, front: back };
      });
    };
    img.src = url;
  });

  // The photo on screen, readable from effects without re-running them.
  const currentRef = useRef<string | null>(null);
  currentRef.current = slides.layers[slides.front];

  // Photo list changed: keep the current photo if it survived, else restart.
  useEffect(() => {
    const list = urlKey ? urlKey.split('|') : [];
    if (list.length === 0) {
      setSlides({ layers: [null, null], front: 0 });
      return;
    }
    const at = currentRef.current ? list.indexOf(currentRef.current) : -1;
    if (at >= 0) {
      indexRef.current = at;
    } else {
      indexRef.current = 0;
      showRef.current(list[0]);
    }
  }, [urlKey]);

  useEffect(() => {
    const list = urlKey ? urlKey.split('|') : [];
    if (list.length < 2) return;
    const timer = window.setInterval(() => {
      indexRef.current = (indexRef.current + 1) % list.length;
      showRef.current(list[indexRef.current]);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [urlKey, intervalMs]);

  if (loading) {
    return (
      <ModuleFrame title="Photos">
        <ModuleLoading />
      </ModuleFrame>
    );
  }
  if (!data && error) {
    return (
      <ModuleFrame title="Photos">
        <ModuleError title="Photos unavailable" hint="Will retry shortly" />
      </ModuleFrame>
    );
  }
  if (urls.length === 0) {
    return (
      <ModuleFrame title="Photos">
        <ModuleEmpty title="No photos yet" hint="Add photos from the app" />
      </ModuleFrame>
    );
  }

  return (
    <ModuleFrame flush className={`photo photo-${fit}`}>
      <div className="photo-stage">
        {slides.layers.map((src, i) =>
          src ? (
            <img
              key={i}
              src={src}
              alt=""
              className={`photo-layer${slides.front === i ? ' visible' : ''}`}
              draggable={false}
            />
          ) : null
        )}
      </div>
    </ModuleFrame>
  );
}
