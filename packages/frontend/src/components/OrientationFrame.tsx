import { useEffect, useState, type ReactNode } from 'react';
import { useWsEvent } from './modules/useWsEvent';
import { OrientationCheck } from './OrientationCheck';
import { parseOrientationState, uiRotation, type OrientationState } from '../orientation';

const RETRY_MS = 5000;

function outputIsLandscape(): boolean {
  return window.innerWidth >= window.innerHeight;
}

/**
 * Root of the mirror UI: turns everything inside it to match how the panel is
 * mounted, and shows the orientation check over every screen while the app's
 * Orientation step is previewing a value.
 *
 * Sets on <html>: data-rotate (-90 | 90, only while the UI is turned) and
 * data-orientation (landscape | portrait, the shape the UI is laid out in).
 * Screens style their portrait layout with html[data-orientation='portrait'],
 * since @media (orientation) sees the unturned output.
 */
export function OrientationFrame({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrientationState | null>(null);
  const [landscapeOutput, setLandscapeOutput] = useState(outputIsLandscape);

  // The WS sends the current state to every new socket and on each change;
  // this covers first paint (and a backend that isn't up yet).
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const res = await fetch('/api/setup/orientation', { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`GET /api/setup/orientation: ${res.status}`);
        const next = parseOrientationState(await res.json());
        if (!cancelled && next) setState((current) => current ?? next);
      } catch {
        if (!cancelled) timer = window.setTimeout(load, RETRY_MS);
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useWsEvent('orientation', (data) => {
    const next = parseOrientationState(data);
    if (next) setState(next);
  });

  useEffect(() => {
    const onResize = () => setLandscapeOutput(outputIsLandscape());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const shown = state?.preview ?? state?.orientation ?? 'landscape';
  const rotation = uiRotation(shown, landscapeOutput);
  const portrait = rotation !== 0 || !landscapeOutput;

  useEffect(() => {
    const root = document.documentElement;
    if (rotation) root.dataset.rotate = String(rotation);
    else delete root.dataset.rotate;
    root.dataset.orientation = portrait ? 'portrait' : 'landscape';
  }, [rotation, portrait]);

  return (
    <div className="orientation-frame">
      {children}
      {state?.preview && <OrientationCheck orientation={state.preview} />}
    </div>
  );
}
