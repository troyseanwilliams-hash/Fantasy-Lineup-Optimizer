/**
 * EliteLineup.com — useScoutBoosts Hook
 *
 * PAYWALL
 * ───────
 * Scout signals require a Star or Pro subscription.
 * The hook skips the fetch entirely for free users and returns
 * { entitled: false } so callers can gate UI accordingly.
 *
 * The server enforces the same check (403 + requiresUpgrade: true), so
 * even if the client-side guard is bypassed the data is never served.
 *
 * REFRESH CADENCE
 * ───────────────
 * One Claude call per hour on the server covers all sports.
 * staleTime = refetchInterval = 1 hour here, so the frontend
 * never polls more than once per sport per hour.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Player } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoutSignal {
  player_name: string;
  signal_type: string;
  reason: string;
  beneficiary_names?: string[];
  ownership_delta?: number;
  confidence: number;
}

export interface UseScoutBoostsOptions {
  sport: string;
  players?: Player[];
  /** User's subscription tier — hook is a no-op for "free" / undefined */
  tier?: string;
  /** True if the user is an admin */
  isAdmin?: boolean;
  /** Auto-apply boosts when signals load. Default: false */
  autoApply?: boolean;
  /** Minimum confidence threshold. Default: 0.7 */
  minConfidence?: number;
}

export interface UseScoutBoostsReturn {
  /** Whether this user can access Scout at all */
  entitled: boolean;
  scoutProjections: Record<string, number>;
  hasScoutBoosts: boolean;
  boostedPlayerCount: number;
  signals: ScoutSignal[];
  applyScoutBoosts: () => void;
  resetScoutBoosts: () => void;
  secondsUntilRefresh: number;
  isLoading: boolean;
  ownershipDeltas: Record<string, number>;
}

// Mirror of BOOST_WEIGHTS in ai_scout.py
export const BOOST_WEIGHTS: Record<string, number> = {
  starter_out:       5.0,
  injury_opp:        4.0,
  lineup_promotion:  3.5,
  weather_boost:     2.0,
  matchup_upgrade:   2.0,
  confirmed_starter: 1.5,
  value_spike:       1.5,
  hot_streak:        1.0,
  negative_news:    -3.0,
  out:             -99.0,
};

const SERVER_INTERVAL_MS        = 3_600_000; // 1 hour
const NEAR_REFRESH_THRESHOLD_S  = 30;

function isEntitled(tier?: string, isAdmin?: boolean): boolean {
  return isAdmin === true || tier === "star" || tier === "pro";
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useScoutBoosts({
  sport,
  players,
  tier,
  isAdmin,
  autoApply    = false,
  minConfidence = 0.7,
}: UseScoutBoostsOptions): UseScoutBoostsReturn {
  const queryClient = useQueryClient();
  const entitled    = isEntitled(tier, isAdmin);

  const [scoutProjections, setScoutProjections] = useState<Record<string, number>>({});
  const [ownershipDeltas,  setOwnershipDeltas]  = useState<Record<string, number>>({});
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(SERVER_INTERVAL_MS / 1000);
  const nearRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch — skipped entirely for free users ────────────────────────────────
  const { data, isLoading } = useQuery<{
    signals: ScoutSignal[];
    seconds_until_refresh: number;
  }>({
    queryKey:  ["/api/scout/signals", sport],
    queryFn:   () =>
      apiRequest("GET", `/api/scout/signals/${sport}`).then(r => r.json()),
    enabled:          !!sport && entitled,  // ← no fetch for free users
    staleTime:        SERVER_INTERVAL_MS,
    refetchInterval:  SERVER_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: (failCount, error: any) => {
      // Don't retry 401/403 — user simply isn't entitled
      if (error?.status === 401 || error?.status === 403) return false;
      return failCount < 2;
    },
  });

  const signals: ScoutSignal[] = entitled
    ? (data?.signals || []).filter(s => s.confidence >= minConfidence)
    : [];

  // ── Sync countdown ─────────────────────────────────────────────────────────
  useEffect(() => {
    const secs = data?.seconds_until_refresh;
    if (secs === undefined) return;
    setSecondsUntilRefresh(secs);

    if (secs <= NEAR_REFRESH_THRESHOLD_S) {
      if (nearRefreshTimerRef.current) clearTimeout(nearRefreshTimerRef.current);
      nearRefreshTimerRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/scout/signals", sport] });
      }, (secs + 5) * 1000);
    }
    return () => {
      if (nearRefreshTimerRef.current) clearTimeout(nearRefreshTimerRef.current);
    };
  }, [data?.seconds_until_refresh, sport, queryClient]);

  useEffect(() => {
    const t = setInterval(() => setSecondsUntilRefresh(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Compute projection overrides ───────────────────────────────────────────
  const computeProjections = useCallback((): {
    projections: Record<string, number>;
    ownership: Record<string, number>;
  } => {
    if (!players || signals.length === 0) return { projections: {}, ownership: {} };

    const nameMap: Record<string, Player> = {};
    players.forEach(p => { nameMap[p.name.toLowerCase()] = p; });

    const projections: Record<string, number> = {};
    const ownership:   Record<string, number> = {};

    const applyBoost = (player: Player, boost: number, ownDelta: number) => {
      const pid  = String(player.id);
      const base = projections[pid] ?? Number(player.projectedPoints) ?? 0;
      projections[pid] = Math.max(0, Math.round((base + boost) * 10) / 10);
      ownership[pid]   = (ownership[pid] ?? 0) + ownDelta;
    };

    signals.forEach(sig => {
      const weight   = (BOOST_WEIGHTS[sig.signal_type] || 0) * sig.confidence;
      const ownDelta = sig.ownership_delta ?? 0;
      const target   = nameMap[sig.player_name.toLowerCase()];
      if (target && weight !== 0) applyBoost(target, weight, ownDelta);

      sig.beneficiary_names?.forEach(bname => {
        const bp = nameMap[bname.toLowerCase()];
        if (bp) applyBoost(bp, BOOST_WEIGHTS["injury_opp"] * sig.confidence, Math.round(ownDelta * 0.5));
      });
    });

    return { projections, ownership };
  }, [players, signals]);

  useEffect(() => {
    if (autoApply && signals.length > 0 && players?.length) {
      const { projections, ownership } = computeProjections();
      setScoutProjections(projections);
      setOwnershipDeltas(ownership);
    }
  }, [autoApply, signals, players, computeProjections]);

  const applyScoutBoosts = useCallback(() => {
    const { projections, ownership } = computeProjections();
    setScoutProjections(projections);
    setOwnershipDeltas(ownership);
  }, [computeProjections]);

  const resetScoutBoosts = useCallback(() => {
    setScoutProjections({});
    setOwnershipDeltas({});
  }, []);

  return {
    entitled,
    scoutProjections,
    hasScoutBoosts:     Object.keys(scoutProjections).length > 0,
    boostedPlayerCount: Object.keys(scoutProjections).length,
    signals,
    applyScoutBoosts,
    resetScoutBoosts,
    secondsUntilRefresh,
    isLoading: entitled ? isLoading : false,
    ownershipDeltas,
  };
}
