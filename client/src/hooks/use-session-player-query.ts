import { useEffect, useMemo, useRef } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

/**
 * Player pools are shared by the standard, pro, and showdown optimizers.  They
 * are useful when navigating back to a slate, but they are also user-scoped
 * because player responses can contain user-specific projections/ownership.
 *
 * This is deliberately sessionStorage (rather than localStorage): a browser
 * session can reuse a pool after a reload, while a later session starts clean.
 */
export const PLAYER_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAYER_CACHE_PREFIX = "eliteLineup:player-pool:v3:";

interface PlayerCacheEntry<T> {
  timestamp: number;
  data: T;
}

export interface UseSessionPlayerQueryOptions<T> {
  /** The exact URL used to fetch this slate's player pool. */
  url: string;
  /** Only authenticated users are eligible for session caching. */
  userId: string | number | null | undefined;
  enabled?: boolean;
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // Access can throw in privacy modes, even when window exists.
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getPlayerCacheKey(url: string, userId: string | number): string {
  return `${PLAYER_CACHE_PREFIX}${encodeURIComponent(String(userId))}:${encodeURIComponent(url)}`;
}

function readPlayerCache<T>(key: string | null): PlayerCacheEntry<T> | null {
  if (!key) return null;
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Number.isFinite((parsed as PlayerCacheEntry<T>).timestamp) ||
      !("data" in parsed)
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed as PlayerCacheEntry<T>;
  } catch {
    // A blocked or full storage should never prevent the player page loading.
    return null;
  }
}

function writePlayerCache<T>(key: string | null, entry: PlayerCacheEntry<T>): void {
  if (!key) return;
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota/security errors are intentionally non-fatal. React Query remains
    // the in-memory cache for this mount.
  }
}

async function fetchPlayers<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) {
    const message = (await response.text()) || response.statusText;
    throw new Error(`${response.status}: ${message}`);
  }
  return response.json() as Promise<T>;
}

export type SessionPlayerQueryResult<T> = Omit<UseQueryResult<T, Error>, "data"> & {
  data: T | undefined;
  /** True when a stale player pool was retained after a refresh failed. */
  playerRefreshError: Error | null;
  /** Manually fetches a fresh pool without deleting the last good cache. */
  refreshPlayers: () => Promise<unknown>;
};

/**
 * Query a slate player pool with a user-scoped sessionStorage layer.
 *
 * initialDataUpdatedAt lets React Query make the important distinction between
 * a fresh session entry (no request) and a stale entry (render immediately,
 * then refresh in the background). `isFetchedAfterMount` prevents hydrating an
 * old entry from being written back with a new timestamp before a request has
 * succeeded.
 */
export function useSessionPlayerQuery<T>({
  url,
  userId,
  enabled = true,
}: UseSessionPlayerQueryOptions<T>): SessionPlayerQueryResult<T> {
  const cacheKey = useMemo(
    () => (userId != null && url ? getPlayerCacheKey(url, userId) : null),
    [url, userId],
  );
  const cached = useMemo(
    () => readPlayerCache<T>(cacheKey),
    [cacheKey],
  );
  const query = useQuery<T, Error>({
    // Include the user id in the query key as well as the storage key. This
    // prevents an account switch from briefly observing another user's data.
    // Keep the URL first so existing invalidateQueries({ queryKey: [url] })
    // calls still invalidate every user-scoped player query for this slate.
    queryKey: [url, "session-player-pool-v3", userId ?? "unauthenticated"],
    queryFn: ({ signal }) => fetchPlayers<T>(url, signal),
    // Anonymous pages can still load a player pool, but cacheKey remains null
    // so no unauthenticated data is persisted.
    enabled: enabled && !!url,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.timestamp,
    staleTime: PLAYER_CACHE_TTL_MS,
    gcTime: PLAYER_CACHE_TTL_MS,
    refetchInterval: PLAYER_CACHE_TTL_MS,
  });

  useEffect(() => {
    if (
      !cacheKey ||
      !query.data ||
      !query.isFetchedAfterMount ||
      !query.isSuccess
    ) {
      return;
    }
    writePlayerCache(cacheKey, {
      timestamp: query.dataUpdatedAt,
      data: query.data,
    });
  }, [
    cacheKey,
    query.data,
    query.dataUpdatedAt,
    query.isFetchedAfterMount,
    query.isSuccess,
  ]);

  // Never expose a prior account's result while auth is resolving or after
  // logout. The query key isolates accounts, and this guard covers the
  // transition render before React Query publishes the new observer result.
  const accountKey = userId == null ? "unauthenticated" : String(userId);
  const resourceKey = `${accountKey}:${url}`;
  const previousResourceKey = useRef(resourceKey);
  const resourceChanged = previousResourceKey.current !== resourceKey;
  if (resourceChanged) previousResourceKey.current = resourceKey;
  const safeData = resourceChanged ? undefined : query.data;
  const playerRefreshError =
    safeData !== undefined && query.error ? query.error : null;

  return {
    ...query,
    data: safeData,
    playerRefreshError,
    refreshPlayers: () => query.refetch({ cancelRefetch: true }),
  };
}
