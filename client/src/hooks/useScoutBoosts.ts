import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Player } from "@shared/schema";

interface ScoutSignal {
  player_name: string;
  signal_type: string;
  reason: string;
  beneficiary_names?: string[];
  ownership_delta?: number;
  confidence: number;
}

interface UseScoutBoostsOptions {
  sport: string;
  players?: Player[];
  autoApply?: boolean;
  minConfidence?: number;
}

interface UseScoutBoostsReturn {
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

const BOOST_WEIGHTS: Record<string, number> = {
  starter_out: 5.0,
  injury_opp: 4.0,
  lineup_promotion: 3.5,
  weather_boost: 2.0,
  matchup_upgrade: 2.0,
  confirmed_starter: 1.5,
  value_spike: 1.5,
  hot_streak: 1.0,
  negative_news: -3.0,
  out: -99.0,
};

export function useScoutBoosts({
  sport,
  players,
  autoApply = false,
  minConfidence = 0.7,
}: UseScoutBoostsOptions): UseScoutBoostsReturn {
  const queryClient = useQueryClient();
  const [scoutProjections, setScoutProjections] = useState<Record<string, number>>({});
  const [ownershipDeltas, setOwnershipDeltas] = useState<Record<string, number>>({});
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(3600);

  const { data, isLoading } = useQuery<{ signals: ScoutSignal[]; seconds_until_refresh: number }>({
    queryKey: ["/api/scout/signals", sport],
    queryFn: () => apiRequest("GET", `/api/scout/signals/${sport}`).then(r => r.json()),
    refetchInterval: 60_000,
    enabled: !!sport,
  });

  const signals: ScoutSignal[] = (data?.signals || []).filter(s => s.confidence >= minConfidence);

  useEffect(() => {
    if (data?.seconds_until_refresh !== undefined) {
      setSecondsUntilRefresh(data.seconds_until_refresh);
    }
  }, [data?.seconds_until_refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      setSecondsUntilRefresh(prev => {
        if (prev <= 1) {
          queryClient.invalidateQueries({ queryKey: ["/api/scout/signals", sport] });
          return 3600;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [sport, queryClient]);

  const computeProjections = useCallback((): {
    projections: Record<string, number>;
    ownership: Record<string, number>;
  } => {
    if (!players || signals.length === 0) return { projections: {}, ownership: {} };

    const nameMap: Record<string, Player> = {};
    players.forEach(p => { nameMap[p.name.toLowerCase()] = p; });

    const projections: Record<string, number> = {};
    const ownership: Record<string, number> = {};

    const applyBoost = (player: Player, boost: number, ownDelta: number) => {
      const pid = String(player.id);
      const base = projections[pid] ?? Number(player.projectedPoints) ?? 0;
      projections[pid] = Math.max(0, Math.round((base + boost) * 10) / 10);
      ownership[pid] = (ownership[pid] ?? 0) + ownDelta;
    };

    signals.forEach(sig => {
      const weight = (BOOST_WEIGHTS[sig.signal_type] || 0) * sig.confidence;
      const ownDelta = sig.ownership_delta ?? 0;

      const target = nameMap[sig.player_name.toLowerCase()];
      if (target && weight !== 0) {
        applyBoost(target, weight, ownDelta);
      }

      sig.beneficiary_names?.forEach(bname => {
        const bplayer = nameMap[bname.toLowerCase()];
        if (bplayer) {
          applyBoost(bplayer, BOOST_WEIGHTS["injury_opp"] * sig.confidence, Math.round(ownDelta * 0.5));
        }
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
    scoutProjections,
    hasScoutBoosts: Object.keys(scoutProjections).length > 0,
    boostedPlayerCount: Object.keys(scoutProjections).length,
    signals,
    applyScoutBoosts,
    resetScoutBoosts,
    secondsUntilRefresh,
    isLoading,
    ownershipDeltas,
  };
}
