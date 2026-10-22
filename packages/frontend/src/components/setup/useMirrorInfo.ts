import { useEffect, useState } from 'react';

export interface MirrorInfo {
  /** Mirror name (shown top right on setup screens). */
  name: string | null;
  /** Software version, without a leading "v". */
  version: string | null;
}

let cached: MirrorInfo | null = null;

/** Name and version from GET /api/discovery (public); fetched once per page load. */
export function useMirrorInfo(): MirrorInfo {
  const [info, setInfo] = useState<MirrorInfo>(cached ?? { name: null, version: null });
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    fetch('/api/discovery', { signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { name?: unknown; version?: unknown } | null) => {
        if (!data) return;
        cached = {
          name: typeof data.name === 'string' && data.name ? data.name : null,
          version: typeof data.version === 'string' && data.version ? data.version : null,
        };
        if (!cancelled) setInfo(cached);
      })
      .catch(() => {
        // Optional chrome; the screens work without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}
