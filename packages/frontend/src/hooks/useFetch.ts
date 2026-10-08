import { useState, useEffect, useCallback, useRef } from 'react';

interface UseFetchOptions<T> {
  /** Initial data before first fetch */
  initialData?: T;
  /** Refresh interval in milliseconds (0 to disable) */
  refreshInterval?: number;
  /** Maximum retry attempts on failure */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms) */
  retryDelay?: number;
  /** Whether to keep showing stale data during refresh */
  keepStaleData?: boolean;
  /** Skip initial fetch (useful for conditional fetching) */
  skip?: boolean;
}

interface UseFetchResult<T> {
  /** The fetched data */
  data: T | null;
  /** Whether the initial load is in progress */
  loading: boolean;
  /** Whether a background refresh is in progress */
  refreshing: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Timestamp of last successful fetch */
  lastUpdated: number | null;
  /** Current retry attempt number */
  retryCount: number;
  /** Whether data is stale (error during refresh but have old data) */
  isStale: boolean;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Manually trigger a retry after error */
  retry: () => Promise<void>;
}

/**
 * Custom hook for data fetching with retry logic, caching, and auto-refresh
 */
export function useFetch<T>(
  url: string | (() => string),
  options: UseFetchOptions<T> = {}
): UseFetchResult<T> {
  const {
    initialData,
    refreshInterval = 0,
    maxRetries = 3,
    retryDelay = 1000,
    keepStaleData = true,
    skip = false,
  } = options;

  const [data, setData] = useState<T | null>(initialData ?? null);
  const [loading, setLoading] = useState(!skip);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  // Get the actual URL (supports dynamic URLs)
  const getUrl = useCallback(() => {
    return typeof url === 'function' ? url() : url;
  }, [url]);

  // Core fetch function with retry logic
  const fetchData = useCallback(
    async (isRefresh = false, currentRetry = 0): Promise<void> => {
      if (fetchingRef.current || skip) return;
      fetchingRef.current = true;

      const actualUrl = getUrl();

      // Set loading state
      if (isRefresh && data !== null) {
        setRefreshing(true);
      } else if (!isRefresh) {
        setLoading(true);
      }

      try {
        const response = await fetch(actualUrl);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (mountedRef.current) {
          setData(result);
          setError(null);
          setLastUpdated(Date.now());
          setRetryCount(0);
        }
      } catch (err) {
        if (!mountedRef.current) return;

        const errorMessage =
          err instanceof Error ? err.message : 'Failed to fetch data';

        // If we have stale data and keepStaleData is true, keep showing it
        if (!keepStaleData || data === null) {
          setError(errorMessage);
        } else {
          // Mark as stale but keep the data
          setError(errorMessage);
        }

        // Retry with exponential backoff
        if (currentRetry < maxRetries) {
          const delay = retryDelay * Math.pow(2, currentRetry);
          console.log(
            `Fetch failed, retrying in ${delay}ms (attempt ${currentRetry + 1}/${maxRetries})`
          );

          setRetryCount(currentRetry + 1);

          retryTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              fetchingRef.current = false;
              fetchData(isRefresh, currentRetry + 1);
            }
          }, delay);

          return;
        } else {
          console.error(`Fetch failed after ${maxRetries} retries:`, errorMessage);
          setRetryCount(maxRetries);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
        fetchingRef.current = false;
      }
    },
    [getUrl, data, keepStaleData, maxRetries, retryDelay, skip]
  );

  // Manual refresh
  const refresh = useCallback(async (): Promise<void> => {
    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    setRetryCount(0);
    await fetchData(true);
  }, [fetchData]);

  // Manual retry (same as refresh but clears error state first)
  const retry = useCallback(async (): Promise<void> => {
    setError(null);
    await refresh();
  }, [refresh]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;

    if (!skip) {
      fetchData(false);
    }

    return () => {
      mountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [getUrl, skip]); // Re-fetch when URL changes

  // Auto-refresh interval
  useEffect(() => {
    if (refreshInterval > 0 && !skip) {
      refreshIntervalRef.current = setInterval(() => {
        if (mountedRef.current && !fetchingRef.current) {
          fetchData(true);
        }
      }, refreshInterval);

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
        }
      };
    }
  }, [refreshInterval, fetchData, skip]);

  // Computed stale state
  const isStale = error !== null && data !== null && keepStaleData;

  return {
    data,
    loading,
    refreshing,
    error,
    lastUpdated,
    retryCount,
    isStale,
    refresh,
    retry,
  };
}

/**
 * Format time ago string
 */
export function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) return 'Never';

  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
