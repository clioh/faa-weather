/**
 * useModuleData — data fetching for widgets.
 *
 * A thin wrapper over useFetch with widget-friendly defaults: keeps stale
 * data on refresh errors, retries with backoff, and exposes the few fields a
 * widget needs to pick between loading / error / content.
 *
 *   const { data, loading, error, isStale, lastUpdated } =
 *     useModuleData<MetarResponse>(`/api/aviation/metar/${icao}`, { refreshMs: 5 * 60_000 });
 *
 * Pass `null` as the url to skip fetching (e.g. a required setting is empty).
 */

import { useFetch } from '../../hooks/useFetch';

interface Options {
  /** Auto-refresh period. 0 disables. */
  refreshMs?: number;
  maxRetries?: number;
}

export interface ModuleData<T> {
  data: T | null;
  /** First load in flight and nothing to show yet. */
  loading: boolean;
  /** Last fetch failed. `data` may still hold the previous result. */
  error: string | null;
  /** Error during a refresh while older data is still displayed. */
  isStale: boolean;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
}

export function useModuleData<T>(url: string | null, options: Options = {}): ModuleData<T> {
  const { refreshMs = 5 * 60_000, maxRetries = 3 } = options;
  const result = useFetch<T>(url ?? '', {
    refreshInterval: refreshMs,
    maxRetries,
    keepStaleData: true,
    skip: url === null,
  });
  return {
    data: result.data,
    loading: result.loading && result.data === null,
    error: result.error,
    isStale: result.isStale,
    lastUpdated: result.lastUpdated,
    refresh: result.refresh,
  };
}
