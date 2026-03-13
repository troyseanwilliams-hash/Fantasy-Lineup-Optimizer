import { useState, useMemo, useCallback, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import type { Player, Slate, ProOptimizeResponse } from "@shared/schema";
import { getPlatformConfig, assignPlayersToSlots, getSlotDisplayName, positionFitsSlot, type Platform } from "@shared/platform-config";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PlayerHistoryCard } from "@/components/PlayerHistoryCard";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Lock, Unlock, X, Zap, Save, Search, Download,
  ChevronDown, ChevronUp, ArrowUpDown, Loader2,
  Crown, TrendingUp, TrendingDown, AlertTriangle,
  ShieldAlert, Activity, SaveAll, Star, Flag, MapPin,
  Cloud, Sun, Wind, CloudRain, Droplets, Target,
  Trophy, Flame, Award, BarChart3, Users, Percent, ArrowLeftRight, Plus
} from "lucide-react";
import { gradeLineup, GRADE_COLORS } from "@/lib/lineup-grader";
import { PlayerInfoHoverCard } from "@/components/PlayerInfoHoverCard";

type SortKey = "name" | "position" | "team" | "salary" | "projectedPoints" | "boostedProj" | "ownershipProjection";
type SortDir = "asc" | "desc";

interface PlayerWithOwnership extends Player {
  ownershipProjection?: number;
}

const INJURY_COLORS: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/30",
  Doubtful: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Questionable: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Probable: "bg-green-500/20 text-green-400 border-green-500/30",
  "Day-to-Day": "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

function getPlayerStarCount(projectedPoints: number): number {
  if (projectedPoints >= 45) return 5;
  if (projectedPoints >= 35) return 4;
  if (projectedPoints >= 25) return 3;
  if (projectedPoints >= 15) return 2;
  return 1;
}

function PlayerStarRating({ stars }: { stars: number }) {
  return (
    <div className="flex items-center gap-px">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${
            i < stars
              ? stars >= 4
                ? "text-yellow-400 fill-yellow-400"
                : stars >= 3
                ? "text-orange-400 fill-orange-400"
                : "text-emerald-400 fill-emerald-400"
              : "text-slate-700"
          }`}
        />
      ))}
    </div>
  );
}

export default function ProOptimizer() {
  const [, params] = useRoute("/optimizer-pro/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  // Type-safe accessors — avoids repeated (user as any) casts throughout
  const userId = (user as any)?.id as string | undefined;
  const userIsAdmin = userIsAdmin;
  const { toast } = useToast();
  const slateId = Number(params?.id);

  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [lockedIds, setLockedIds] = useState<number[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [customProjections, setCustomProjections] = useState<Record<string, number>>({});
  const [sortKey, setSortKey] = useState<SortKey>("projectedPoints");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lineupCount, setLineupCount] = useState(5);
  // useBoosts: pro users get boosts on by default; they can still toggle it off.
  // We use a separate userOverride flag so a pro user's explicit "off" is respected
  // even after subData refetches — without this, the useEffect would flip it back on.
  const [useBoostsUserOverride, setUseBoostsUserOverride] = useState<boolean | null>(null);
  const useBoosts = useBoostsUserOverride !== null ? useBoostsUserOverride : (isPro ?? false);
  const setUseBoosts = (val: boolean) => setUseBoostsUserOverride(val);
  const [fadedIds, setFadedIds] = useState<number[]>([]);
  const [exposureLimits, setExposureLimits] = useState<Record<string, number>>({});
  const [globalMaxExposure, setGlobalMaxExposure] = useState<number | null>(null);
  const [leverageMode, setLeverageMode] = useState(false);
  const [projectionMode, setProjectionMode] = useState<"balanced" | "ceiling">("balanced");
  const [lineupSwaps, setLineupSwaps] = useState<Record<string, Record<string, Player>>>({});
  const [swappingTarget, setSwappingTarget] = useState<{ lineupIdx: number; slot: string } | null>(null);
  const [salaryRange, setSalaryRange] = useState<[number, number] | null>(null);
  const [mobileView, setMobileView] = useState<"players" | "lineup">("players");

  const { data: slates } = useQuery<Slate[]>({ queryKey: ["/api/slates"], refetchInterval: 300000 });
  const slate = useMemo(() => slates?.find(s => s.id === slateId), [slates, slateId]);
  const platform = (slate?.platform || "draftkings") as Platform;
  const sport = slate?.sport || "NBA";

  const config = useMemo(() => {
    try { return getPlatformConfig(sport, platform); }
    catch { return getPlatformConfig("NBA", "draftkings"); }
  }, [sport, platform]);

  const sportSlates = useMemo(() => {
    if (!slates) return [];
    return slates.filter(s => s.sport === sport);
  }, [slates, sport]);

  const playerUrl = buildUrl("/api/slates/:id/players", { id: slateId });
  const { data: players, isLoading } = useQuery<PlayerWithOwnership[]>({
    queryKey: [playerUrl],
    enabled: !!slateId,
    refetchInterval: 300000,
  });

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number; sportCounts: Record<string, number> }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const isGolf = sport === "GOLF";
  const slateHasStarted = slate ? new Date(slate.startTime) <= new Date() : false;

  const salaryBounds = useMemo(() => {
    if (!players || players.length === 0) return { min: 3000, max: 10000, step: 100 };
    const salaries = players.map(p => p.salary).filter(s => typeof s === "number" && !isNaN(s));
    if (salaries.length === 0) return { min: 3000, max: 10000, step: 100 };
    const min = Math.min(...salaries);
    const max = Math.max(...salaries);
    if (min === max) return { min, max: min + 100, step: 100 };
    return { min, max, step: 100 };
  }, [players]);

  const { data: golfAnalysis } = useQuery<any>({
    queryKey: ["/api/golf-analysis", slateId],
    queryFn: async () => {
      const res = await fetch(`/api/golf-analysis/${slateId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isGolf && !!slateId,
  });

  const golfTournamentCards = useMemo(() => {
    if (!isGolf || !players || players.length === 0) return null;
    const sorted = [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
    const topSalary = Math.max(...players.map(p => p.salary));
    const favorites = sorted.slice(0, 5).map(p => {
      const impliedProb = (p.salary / topSalary) * 0.45;
      const americanOdds = impliedProb >= 0.5
        ? Math.round(-100 * impliedProb / (1 - impliedProb))
        : Math.round(100 * (1 - impliedProb) / impliedProb);
      return { ...p, odds: americanOdds > 0 ? `+${americanOdds}` : `${americanOdds}`, impliedProb: (impliedProb * 100).toFixed(0) };
    });
    const valuePicks = [...players].map(p => ({ ...p, value: Number(p.projectedPoints) / (p.salary / 1000) })).sort((a, b) => b.value - a.value).slice(0, 4);
    const tournamentParts = (players.find(p => p.gameInfo)?.gameInfo || "Tournament").split(" - ");
    return { favorites, valuePicks, tournamentName: tournamentParts[0] || "Tournament", courseName: tournamentParts[1] || "", fieldSize: players.length, avgSalary: Math.round(players.reduce((s, p) => s + p.salary, 0) / players.length) };
  }, [isGolf, players]);

  const isPro = subData?.tier === "pro" || subData?.tier === "premium";
  const isStar = subData?.tier === "star";
  const hasPaidAccess = isPro || isStar;
  const isAdmin = user?.isAdmin === true;
  const maxLineupSlider = isAdmin ? 150 : isPro ? 20 : 5;

  const optimizeMutation = useMutation<ProOptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize/pro", constraints);
      return res.json();
    },
    onSuccess: (data) => {
      // Warn if server returned lineups that violate the requested exposure limits.
      // This can happen due to solver rounding or insufficient player pool diversity.
      if (data?.lineups && (Object.keys(exposureLimits).length > 0 || globalMaxExposure)) {
        const appearances: Record<number, number> = {};
        for (const ld of data.lineups) {
          for (const p of (ld.lineup || [])) {
            appearances[p.id] = (appearances[p.id] || 0) + 1;
          }
        }
        const violations = Object.entries(appearances).filter(([id, count]) => {
          const pct = (count / data.lineups.length) * 100;
          const playerLimit = exposureLimits[id];
          const effectiveLimit = playerLimit ?? (globalMaxExposure ?? undefined);
          return effectiveLimit !== undefined && pct > effectiveLimit;
        });
        if (violations.length > 0) {
          toast({
            title: "Exposure Limits Exceeded",
            description: `${violations.length} player(s) exceeded their set limits. Try reducing lineup count or tightening exposure settings.`,
            variant: "destructive",
          });
        }
      }
    },
  });

  useEffect(() => {
    // Call handleReset to ensure ALL state is cleared when slate changes.
    // Previously fadedIds, lockedIds, excludedIds, exposureLimits, globalMaxExposure,
    // and useBoostsUserOverride were not cleared — stale player IDs from one slate
    // could match different players on the new slate.
    handleReset();
  }, [slateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [savedIndices, setSavedIndices] = useState<Set<number>>(new Set());
  const [isSavingAll, setIsSavingAll] = useState(false);

  const saveLineupMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/lineups", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: Error) => {
      toast({ title: "Cannot Save", description: err.message, variant: "destructive" });
    },
  });

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }, [sortKey]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    return players
      .filter(p => {
        if (excludedIds.includes(p.id)) return false;
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase());
        const matchPos = posFilter === "ALL" || p.position.includes(posFilter);
        return matchSearch && matchPos;
      })
      .map(p => {
        const boost = p.boostScore ? Number(p.boostScore) : 0;
        const baseProj = Number(p.projectedPoints);
        // Normalize boostScore to a bounded % adjustment before adding to projection.
        // boostScore is an arbitrary optimizer weight (can reach ±10+), not a fantasy
        // point delta. Dividing by 10 and capping at ±30% keeps the display meaningful.
        const boostAdjPct = Math.max(-0.30, Math.min(0.30, boost / 10));
        const boostedProj = useBoosts && boost !== 0
          ? Math.round(baseProj * (1 + boostAdjPct) * 10) / 10
          : baseProj;
        const isFaded = fadedIds.includes(p.id);
        const own = (p as any).ownershipProjection ?? 0;
        return { ...p, baseProj, boostedProj, boost, isFaded, ownershipProjection: own as number };
      })
      .sort((a, b) => {
        let aVal: any, bVal: any;
        switch (sortKey) {
          case "name": aVal = a.name; bVal = b.name; break;
          case "position": aVal = a.position; bVal = b.position; break;
          case "team": aVal = a.team; bVal = b.team; break;
          case "salary": aVal = a.salary; bVal = b.salary; break;
          case "projectedPoints": aVal = a.baseProj; bVal = b.baseProj; break;
          case "boostedProj": aVal = a.boostedProj; bVal = b.boostedProj; break;
          case "ownershipProjection": aVal = a.ownershipProjection; bVal = b.ownershipProjection; break;
          default: aVal = a.boostedProj; bVal = b.boostedProj;
        }
        if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      });
  }, [players, search, posFilter, excludedIds, sortKey, sortDir, useBoosts, fadedIds]);

  const games = useMemo(() => {
    if (!players) return [];
    const gameMap = new Map<string, { away: string; home: string; time: string }>();
    players.forEach(p => {
      if (p.gameInfo) {
        const parts = p.gameInfo.split(" ");
        const time = parts[parts.length - 1] || "";
        const teams = p.gameInfo.replace(time, "").trim();
        let away: string, home: string;
        if (teams.includes("@")) {
          [away, home] = teams.split(" @ ").map(s => s.trim());
        } else if (teams.includes("vs")) {
          [home, away] = teams.split(" vs ").map(s => s.trim());
        } else {
          away = p.opponent || "";
          home = p.team;
        }
        const sortedKey = [away, home].sort().join("-");
        if (!gameMap.has(sortedKey)) {
          gameMap.set(sortedKey, { away, home, time });
        }
      }
    });
    return Array.from(gameMap.values());
  }, [players]);

  const excludedPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter(p => excludedIds.includes(p.id));
  }, [players, excludedIds]);

  const boostedPlayers = useMemo(() => {
    if (!optimizeMutation.data?.boostsSummary) {
      if (!players) return [];
      return players
        .filter(p => p.boostScore && Number(p.boostScore) !== 0)
        .map(p => ({ playerId: p.id, playerName: p.name, boostScore: Number(p.boostScore), boostReason: p.boostReason || "" }))
        .sort((a, b) => Math.abs(b.boostScore) - Math.abs(a.boostScore))
        .slice(0, 10);
    }
    return optimizeMutation.data.boostsSummary;
  }, [players, optimizeMutation.data]);

  const injuredPlayers = useMemo(() => {
    if (!optimizeMutation.data?.injurySummary) {
      if (!players) return [];
      return players
        .filter(p => p.injuryStatus && p.injuryStatus !== "Healthy")
        .map(p => ({ playerId: p.id, playerName: p.name, status: p.injuryStatus || "", detail: p.injuryDetail || "" }));
    }
    return optimizeMutation.data.injurySummary;
  }, [players, optimizeMutation.data]);

  const rawGeneratedLineups = optimizeMutation.data?.lineups || [];

  const generatedLineups = useMemo(() => {
    if (Object.keys(lineupSwaps).length === 0) return rawGeneratedLineups;
    return rawGeneratedLineups.map((lineupData, idx) => {
      const swaps = lineupSwaps[idx];
      if (!swaps || Object.keys(swaps).length === 0) return lineupData;
      const originalSlots = assignPlayersToSlots(lineupData.lineup, config.slots, sport);
      const removedIds = new Set<number>();
      for (const slotKey of Object.keys(swaps)) {
        const slotPlayer = originalSlots[slotKey];
        if (slotPlayer) removedIds.add(slotPlayer.id);
      }
      const keptPlayers = lineupData.lineup.filter(p => !removedIds.has(p.id));
      const newPlayers = [...keptPlayers, ...Object.values(swaps)];
      const newSalary = newPlayers.reduce((s, p) => s + p.salary, 0);
      const newProj = newPlayers.reduce((s, p) => s + Number(p.projectedPoints), 0);
      return { ...lineupData, lineup: newPlayers, totalSalary: newSalary, totalProjectedPoints: newProj };
    });
  }, [rawGeneratedLineups, lineupSwaps, config.slots, sport]);

  const handleProSwap = useCallback((lineupIdx: number, slot: string) => {
    if (swappingTarget?.lineupIdx === lineupIdx && swappingTarget?.slot === slot) {
      setSwappingTarget(null);
    } else {
      setSwappingTarget({ lineupIdx, slot });
    }
  }, [swappingTarget]);

  const handleProSwapSelect = useCallback((player: Player) => {
    if (!swappingTarget) return;
    setLineupSwaps(prev => ({
      ...prev,
      [swappingTarget.lineupIdx]: {
        ...(prev[swappingTarget.lineupIdx] || {}),
        [swappingTarget.slot]: player,
      },
    }));
    setSwappingTarget(null);
  }, [swappingTarget]);

  const proSwapEligiblePlayers = useMemo(() => {
    if (!swappingTarget || !players) return [];
    const lineupData = generatedLineups[swappingTarget.lineupIdx];
    if (!lineupData) return [];
    const lineupPlayers = lineupData.lineup || [];
    const lineupPlayerIds = new Set(lineupPlayers.map(p => p.id));
    const slots = assignPlayersToSlots(lineupPlayers, config.slots, sport);
    const currentPlayer = slots[swappingTarget.slot];
    // Single slot assignment call — previously called twice redundantly
    const currentPlayerSalary = slots[swappingTarget.slot]?.salary || 0;
    const lineupSalary = lineupPlayers.reduce((s, p) => s + p.salary, 0);
    const availableBudget = config.salaryCap - lineupSalary + currentPlayerSalary;
    return players.filter(p => {
      if (lineupPlayerIds.has(p.id)) return false;
      if (excludedIds.includes(p.id)) return false;
      if (!positionFitsSlot(p.position, swappingTarget.slot, sport)) return false;
      if (p.salary > availableBudget) return false;
      return true;
    });
  }, [swappingTarget, players, generatedLineups, config, sport, excludedIds]);

  const exposureTracking = useMemo(() => {
    if (generatedLineups.length === 0 || !players) return [];
    const appearances: Record<number, number> = {};
    for (const lineupData of generatedLineups) {
      const lineupPlayers = lineupData.lineup || [];
      for (const p of lineupPlayers) {
        appearances[p.id] = (appearances[p.id] || 0) + 1;
      }
    }
    return Object.entries(appearances)
      .map(([id, count]) => {
        const player = players.find(p => p.id === Number(id));
        const pct = (count / generatedLineups.length) * 100;
        const playerLimit = exposureLimits[id];
        const effectiveLimit = playerLimit ?? (globalMaxExposure ?? undefined);
        return {
          playerId: Number(id),
          playerName: player?.name || `Player #${id}`,
          position: player?.position || "",
          count,
          total: generatedLineups.length,
          pct,
          limit: effectiveLimit,
          overLimit: effectiveLimit !== undefined && pct > effectiveLimit,
          isPlayerSpecific: playerLimit !== undefined,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [generatedLineups, players, exposureLimits, globalMaxExposure]);

  const handleOptimize = () => {
    const projections: Record<string, number> = { ...customProjections };
    if (isPro && fadedIds.length > 0 && players) {
      for (const p of players) {
        if (fadedIds.includes(p.id)) {
          const own = (p as any).ownershipProjection ?? 10;
          const fadeMultiplier = Math.max(0.3, 1 - (own / 100));
          const base = projections[p.id.toString()] ?? Number(p.projectedPoints);
          projections[p.id.toString()] = Math.round(base * fadeMultiplier * 10) / 10;
        }
      }
    }
    const activeExposureLimits = Object.keys(exposureLimits).length > 0 ? exposureLimits : undefined;
    setSavedIndices(new Set());
    setLineupSwaps({});
    setSwappingTarget(null);
    optimizeMutation.mutate({
      slateId,
      platform,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      playerProjections: Object.keys(projections).length > 0 ? projections : undefined,
      playerMinSalary: salaryRange && salaryRange[0] > salaryBounds.min ? salaryRange[0] : undefined,
      playerMaxSalary: salaryRange && salaryRange[1] < salaryBounds.max ? salaryRange[1] : undefined,
      lineupCount,
      useBoosts,
      exposureLimits: activeExposureLimits,
      globalMaxExposure: globalMaxExposure ?? undefined,
      leverageMode,
      projectionMode,
    });
  };

  const handleSaveLineup = (lineup: any, index: number) => {
    if (!user || savedIndices.has(index)) return;
    const lineupPlayers = lineup.lineup || [];
    saveLineupMutation.mutate({
      userId: userId!,
      slateId,
      sport,
      platform,
      totalSalary: lineup.totalSalary,
      totalProjectedPoints: String(lineup.totalProjectedPoints),
      playerIds: lineupPlayers.map((p: Player) => p.id),
      name: `Optimizer Pro #${index + 1} - ${sport} ${config.shortLabel}`,
    }, {
      onSuccess: () => {
        setSavedIndices(prev => new Set(prev).add(index));
        toast({ title: "Lineup Saved!", description: `Lineup #${index + 1} added to your vault.` });
      },
    });
  };

  const handleSaveAll = async () => {
    if (!user || generatedLineups.length === 0) return;
    const unsavedLineups = generatedLineups
      .map((lineup, i) => ({ lineup, index: i }))
      .filter(({ index }) => !savedIndices.has(index));
    if (unsavedLineups.length === 0) {
      toast({ title: "Already Saved", description: "All lineups are already in your vault." });
      return;
    }
    setIsSavingAll(true);
    // Fire all saves in parallel — much faster than sequential awaits for 20 lineups.
    const saveResults = await Promise.allSettled(
      unsavedLineups.map(({ lineup, index }) => {
        const lineupPlayers = lineup.lineup || [];
        return apiRequest("POST", "/api/lineups", {
          userId: userId!,
          slateId,
          sport,
          platform,
          totalSalary: lineup.totalSalary,
          totalProjectedPoints: String(lineup.totalProjectedPoints),
          playerIds: lineupPlayers.map((p: Player) => p.id),
          name: `Optimizer Pro #${index + 1} - ${sport} ${config.shortLabel}`,
        }).then(async res => {
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || "Failed to save");
          }
          return { index };
        });
      })
    );
    let successCount = 0;
    let failCount = 0;
    let vaultLimitMsg: string | null = null;
    for (let i = 0; i < saveResults.length; i++) {
      const result = saveResults[i];
      if (result.status === "fulfilled") {
        successCount++;
        setSavedIndices(prev => new Set(prev).add(unsavedLineups[i].index));
      } else {
        failCount++;
        const msg = (result as PromiseRejectedResult).reason?.message || "";
        if ((msg.includes("limit") || msg.includes("maximum")) && !vaultLimitMsg) {
          vaultLimitMsg = msg;
        }
      }
    }
    if (vaultLimitMsg) {
      toast({ title: "Vault Limit Reached", description: vaultLimitMsg, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    setIsSavingAll(false);
    if (successCount > 0) {
      toast({
        title: `${successCount} Lineup${successCount > 1 ? "s" : ""} Saved!`,
        description: failCount > 0
          ? `${successCount} added to vault, ${failCount} failed.`
          : `All ${successCount} lineup${successCount > 1 ? "s" : ""} added to your vault.`,
      });
    } else if (failCount > 0) {
      toast({ title: "Save Failed", description: "Could not save lineups. Please try again.", variant: "destructive" });
    }
  };

  const handleExportCSV = () => {
    if (generatedLineups.length === 0) return;
    if (platform !== "draftkings") {
      toast({ title: "Export Unavailable", description: "CSV export is only available for DraftKings lineups.", variant: "destructive" });
      return;
    }
    // Use outer config (from useMemo) — no need to re-call getPlatformConfig here
    const headers = config.slots.map(slot => getSlotDisplayName(slot));
    let missingIdCount = 0;
    const rows = generatedLineups.map(lineupData => {
      const lineupPlayers = lineupData.lineup || [];
      const slotAssignments = assignPlayersToSlots(lineupPlayers, config.slots, sport);
      return config.slots.map(slot => {
        const p = slotAssignments[slot];
        if (!p) return "";
        const dkId = (p as any).draftKingsPlayerId;
        if (!dkId) missingIdCount++;
        return dkId ? `${p.name} (${dkId})` : p.name;
      });
    });
    const csv = [headers.join(","), ...rows.map(r => r.map(cell => `"${cell}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elitelineup_${sport}_${generatedLineups.length}_lineups.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (missingIdCount > 0) {
      toast({ title: "CSV Exported (Partial IDs)", description: `${missingIdCount} player(s) missing DraftKings IDs. These entries may need manual editing before upload.`, variant: "destructive" });
    } else {
      toast({ title: "CSV Exported", description: `${generatedLineups.length} lineup${generatedLineups.length > 1 ? "s" : ""} exported for DraftKings upload.` });
    }
  };

  const handleSlateChange = (newSlateId: string) => {
    setLocation(`/optimizer-pro/${newSlateId}`);
    handleReset();
  };

  const handleReset = () => {
    setLockedIds([]);
    setExcludedIds([]);
    setFadedIds([]);
    setCustomProjections({});
    setExposureLimits({});
    setGlobalMaxExposure(null);
    setSavedIndices(new Set());
    setSalaryRange(null);
    setLineupSwaps({});
    setSwappingTarget(null);
    setUseBoostsUserOverride(null); // reset to subscription-derived default
    optimizeMutation.reset();
  };

  const positions = ["ALL", ...(config.positionFilters || ["PG", "SG", "SF", "PF", "C"])];

  const SortHeader = ({ label, field, className = "" }: { label: string; field: SortKey; className?: string }) => (
    <th
      className={`px-3 py-3 text-[11px] font-black uppercase tracking-widest cursor-pointer select-none hover:text-slate-300 transition-colors ${className}`}
      onClick={() => toggleSort(field)}
      data-testid={`sort-${field}`}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === field ? (
          sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </div>
    </th>
  );

  if (!hasPaidAccess && !isLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <Card className="max-w-md w-full p-8 bg-slate-900 border-amber-500/30 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-6">
            <Crown className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-3" data-testid="text-pro-locked-title">Advanced Optimizer</h2>
          <p className="text-slate-400 mb-6 text-sm" data-testid="text-pro-locked-desc">
            Unlock the advanced optimizer to generate multiple unique lineups at once. Sharpshooter gets up to 5 lineups, Champion gets up to 20 with AI boosts and injury adjustments.
          </p>
          <Link href="/pricing">
            <Button className="bg-amber-500 text-black font-black w-full" data-testid="button-upgrade-pro">
              <Crown className="w-4 h-4 mr-2" />
              View Plans
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-[80vh] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden" data-testid="pro-optimizer-page">
      {/* Top Controls Bar */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2">
        <div className="flex flex-col gap-2 md:gap-0">
          {/* Row 1: Slate info + selector */}
          <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
            <Badge className={`text-[11px] font-black flex-shrink-0 ${platform === "fanduel" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}`} data-testid="badge-platform">
              {config.shortLabel} {sport}
            </Badge>

            {slate && (
              <span className="text-xs font-black text-amber-400/70 flex-shrink-0" data-testid="pro-slate-date">
                {new Date(slate.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </span>
            )}

            <div className="h-4 w-px bg-slate-700 flex-shrink-0" />

            <select
              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1 font-bold flex-shrink-0"
              value={slateId}
              onChange={e => {
                const selectedSlate = sportSlates.find(s => String(s.id) === e.target.value);
                const userTier = subData?.tier || "free";
                if (selectedSlate && !selectedSlate.isMain && userTier !== "pro" && !userIsAdmin) {
                  toast({ title: "Champion Feature", description: "Additional slates require a Champion subscription. Visit the Pricing page to upgrade.", variant: "destructive" });
                  return;
                }
                handleSlateChange(e.target.value);
              }}
              data-testid="pro-slate-selector"
            >
              {sportSlates.map(s => {
                const locked = new Date(s.startTime) <= new Date();
                const userTier = subData?.tier || "free";
                const isGated = !s.isMain && userTier !== "pro" && !userIsAdmin;
                return (
                  <option key={s.id} value={s.id} disabled={isGated}>
                    {s.isMain ? "★ " : ""}{locked ? "🔒 " : ""}{s.platform === "fanduel" ? "FD" : "DK"} - {s.name}{locked ? " (Locked)" : ""}{isGated ? " (CHAMPION)" : ""}
                  </option>
                );
              })}
            </select>

            {isPro && (
              <>
                <div className="h-4 w-px bg-slate-700 flex-shrink-0 hidden md:block" />
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <label className="text-[10px] font-black text-slate-400 uppercase">Boosts</label>
                  <Switch checked={useBoosts} onCheckedChange={setUseBoosts} data-testid="toggle-boosts" className="scale-90" />
                </div>
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <label className="text-[10px] font-black text-amber-400 uppercase">Leverage</label>
                  <Switch checked={leverageMode} onCheckedChange={setLeverageMode} data-testid="toggle-leverage" className="scale-90" />
                </div>
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <label className="text-[10px] font-black text-purple-400 uppercase">Mode</label>
                  <button
                    onClick={() => setProjectionMode(projectionMode === "balanced" ? "ceiling" : "balanced")}
                    className={`text-[10px] font-black px-2 py-0.5 rounded ${
                      projectionMode === "ceiling"
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                        : "bg-slate-700/50 text-slate-400 border border-slate-600/30"
                    }`}
                    data-testid="button-projection-mode"
                  >
                    {projectionMode === "ceiling" ? "CEILING" : "BALANCED"}
                  </button>
                </div>
              </>
            )}

            <div className="h-4 w-px bg-slate-700 flex-shrink-0 hidden md:block" />

            <div className="hidden md:flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Qty</span>
              <Slider
                value={[lineupCount]}
                onValueChange={(v) => setLineupCount(Math.min(v[0], maxLineupSlider))}
                min={1}
                max={maxLineupSlider}
                step={1}
                className="w-20"
                data-testid="slider-lineup-count"
              />
              <span className="text-xs font-black text-amber-400 min-w-[18px] text-center" data-testid="text-lineup-count">{lineupCount}</span>
            </div>

          </div>

          {/* Row 2 (Desktop): Max Exposure + Salary Range */}
          {(isPro && lineupCount > 1 || (players && players.length > 0)) && (
            <div className="hidden md:flex items-center gap-3 overflow-x-auto scrollbar-hide">
              {isPro && lineupCount > 1 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className="text-[10px] font-black text-cyan-400 uppercase whitespace-nowrap">Max Exp</span>
                  <Slider
                    value={[globalMaxExposure ?? 100]}
                    onValueChange={(v) => setGlobalMaxExposure(v[0] === 100 ? null : v[0])}
                    min={10}
                    max={100}
                    step={5}
                    className="w-24"
                    data-testid="slider-global-exposure"
                  />
                  <span className={`text-xs font-black min-w-[28px] text-center ${globalMaxExposure ? "text-cyan-400" : "text-slate-500"}`} data-testid="text-global-exposure">
                    {globalMaxExposure ? `${globalMaxExposure}%` : "Off"}
                  </span>
                </div>
              )}
              {players && players.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className="text-[10px] font-black text-emerald-400 uppercase whitespace-nowrap">Salary</span>
                  <Slider
                    value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                    onValueChange={(v) => setSalaryRange([v[0], v[1]])}
                    min={salaryBounds.min}
                    max={salaryBounds.max}
                    step={salaryBounds.step}
                    className="w-32"
                    data-testid="slider-salary-range"
                  />
                  <span className={`text-[10px] font-black min-w-[70px] text-center tabular-nums ${salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) ? "text-emerald-400" : "text-slate-500"}`} data-testid="text-salary-range">
                    {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max)
                      ? `$${(salaryRange[0] / 1000).toFixed(1)}k-$${(salaryRange[1] / 1000).toFixed(1)}k`
                      : "All"}
                  </span>
                  {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) && (
                    <button onClick={() => setSalaryRange(null)} className="text-slate-500 hover:text-white cursor-pointer" data-testid="button-reset-salary">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Row 2 (Mobile only): Toggles + settings */}
          {isPro && (
            <div className="flex md:hidden items-center gap-3 overflow-x-auto scrollbar-hide">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-slate-400 uppercase">Boosts</label>
                <Switch checked={useBoosts} onCheckedChange={setUseBoosts} data-testid="toggle-boosts-mobile" className="scale-90" />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-amber-400 uppercase">Leverage</label>
                <Switch checked={leverageMode} onCheckedChange={setLeverageMode} data-testid="toggle-leverage-mobile" className="scale-90" />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-purple-400 uppercase">Mode</label>
                <button
                  onClick={() => setProjectionMode(projectionMode === "balanced" ? "ceiling" : "balanced")}
                  className={`text-[10px] font-black px-2 py-0.5 rounded ${
                    projectionMode === "ceiling"
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                      : "bg-slate-700/50 text-slate-400 border border-slate-600/30"
                  }`}
                  data-testid="button-projection-mode-mobile"
                >
                  {projectionMode === "ceiling" ? "CEILING" : "BALANCED"}
                </button>
              </div>
              <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Qty</span>
                <Slider
                  value={[lineupCount]}
                  onValueChange={(v) => setLineupCount(Math.min(v[0], maxLineupSlider))}
                  min={1}
                  max={maxLineupSlider}
                  step={1}
                  className="w-20"
                  data-testid="slider-lineup-count-mobile"
                />
                <span className="text-xs font-black text-amber-400 min-w-[18px] text-center">{lineupCount}</span>
              </div>
              {lineupCount > 1 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Max Exp</span>
                  <Slider
                    value={[globalMaxExposure ?? 100]}
                    onValueChange={(v) => setGlobalMaxExposure(v[0] === 100 ? null : v[0])}
                    min={10}
                    max={100}
                    step={5}
                    className="w-20"
                    data-testid="slider-global-exposure-mobile"
                  />
                  <span className={`text-xs font-black min-w-[28px] text-center ${globalMaxExposure ? "text-cyan-400" : "text-slate-500"}`}>
                    {globalMaxExposure ? `${globalMaxExposure}%` : "Off"}
                  </span>
                </div>
              )}
              {players && players.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className="text-[10px] font-black text-emerald-400 uppercase whitespace-nowrap">Salary</span>
                  <Slider
                    value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                    onValueChange={(v) => setSalaryRange([v[0], v[1]])}
                    min={salaryBounds.min}
                    max={salaryBounds.max}
                    step={salaryBounds.step}
                    className="w-24"
                    data-testid="slider-salary-range-mobile"
                  />
                  <span className={`text-[10px] font-black min-w-[60px] text-center tabular-nums ${salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) ? "text-emerald-400" : "text-slate-500"}`}>
                    {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max)
                      ? `$${(salaryRange[0] / 1000).toFixed(1)}k-$${(salaryRange[1] / 1000).toFixed(1)}k`
                      : "All"}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Row 3 (Mobile only for non-Pro): Qty slider */}
          {!isPro && (
            <div className="flex md:hidden items-center gap-2">
              <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Qty</span>
                <Slider
                  value={[lineupCount]}
                  onValueChange={(v) => setLineupCount(Math.min(v[0], maxLineupSlider))}
                  min={1}
                  max={maxLineupSlider}
                  step={1}
                  className="w-20"
                  data-testid="slider-lineup-count-basic-mobile"
                />
                <span className="text-xs font-black text-amber-400 min-w-[18px] text-center">{lineupCount}</span>
              </div>
              {players && players.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className="text-[10px] font-black text-emerald-400 uppercase whitespace-nowrap">Salary</span>
                  <Slider
                    value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                    onValueChange={(v) => setSalaryRange([v[0], v[1]])}
                    min={salaryBounds.min}
                    max={salaryBounds.max}
                    step={salaryBounds.step}
                    className="w-24"
                    data-testid="slider-salary-range-basic-mobile"
                  />
                  <span className={`text-[10px] font-black min-w-[60px] text-center tabular-nums ${salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) ? "text-emerald-400" : "text-slate-500"}`}>
                    {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max)
                      ? `$${(salaryRange[0] / 1000).toFixed(1)}k-$${(salaryRange[1] / 1000).toFixed(1)}k`
                      : "All"}
                  </span>
                </div>
              )}
            </div>
          )}

          {slateHasStarted && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center" data-testid="slate-locked-msg">
              <p className="text-red-400 text-xs font-bold">This slate has locked — games have already started.</p>
              <p className="text-slate-400 text-[10px] mt-0.5">Switch to another sport with upcoming games to build lineups.</p>
            </div>
          )}
          {/* Action Buttons Row */}
          <div className="flex flex-wrap items-center gap-2 pt-1 md:pt-0">
            <Button
              onClick={handleOptimize}
              disabled={optimizeMutation.isPending || slateHasStarted}
              size="sm"
              className="bg-amber-500 text-black font-black shadow-lg shadow-amber-500/20 text-xs flex-1 md:flex-none"
              data-testid="button-generate"
            >
              {optimizeMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 mr-1.5" />
              )}
              {slateHasStarted ? "SLATE LOCKED" : `Generate ${lineupCount}`}
            </Button>

            {generatedLineups.length > 0 && (
              <>
                <Button
                  onClick={handleSaveAll}
                  disabled={isSavingAll || saveLineupMutation.isPending || savedIndices.size === generatedLineups.length}
                  variant="outline"
                  size="sm"
                  className={`font-black text-xs flex-1 md:flex-none ${savedIndices.size === generatedLineups.length ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400"}`}
                  data-testid="button-save-all"
                >
                  {isSavingAll ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : savedIndices.size === generatedLineups.length ? (
                    <Trophy className="w-3.5 h-3.5 mr-1.5" />
                  ) : (
                    <SaveAll className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  <span className="hidden sm:inline">
                    {savedIndices.size === generatedLineups.length
                      ? "All Saved"
                      : isSavingAll
                        ? `Saving ${savedIndices.size}/${generatedLineups.length}...`
                        : savedIndices.size > 0
                          ? `Save (${generatedLineups.length - savedIndices.size})`
                          : `Save All (${generatedLineups.length})`}
                  </span>
                  <span className="sm:hidden">
                    {savedIndices.size === generatedLineups.length
                      ? "Saved"
                      : isSavingAll
                        ? `${savedIndices.size}/${generatedLineups.length}`
                        : `Save ${savedIndices.size > 0 ? generatedLineups.length - savedIndices.size : "All"}`}
                  </span>
                </Button>
                <Button
                  onClick={handleExportCSV}
                  variant="outline"
                  size="sm"
                  className="font-black text-xs border-cyan-500/30 text-cyan-400 flex-1 md:flex-none"
                  data-testid="button-export-csv"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  <span className="hidden sm:inline">Export CSV</span>
                  <span className="sm:hidden">CSV</span>
                </Button>
              </>
            )}

            <Button variant="ghost" size="sm" onClick={handleReset} className="text-slate-400 font-bold text-xs" data-testid="button-reset">
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Tab Toggle */}
      <div className="xl:hidden flex border-b border-slate-800 bg-slate-900/80">
        <button
          onClick={() => setMobileView("players")}
          data-testid="pro-mobile-tab-players"
          className={`flex-1 px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all ${
            mobileView === "players"
              ? "text-amber-400 border-b-2 border-amber-400 bg-slate-800/50"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          Players {filteredPlayers.length > 0 && `(${filteredPlayers.length})`}
        </button>
        <button
          onClick={() => setMobileView("lineup")}
          data-testid="pro-mobile-tab-lineup"
          className={`flex-1 px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all ${
            mobileView === "lineup"
              ? "text-amber-400 border-b-2 border-amber-400 bg-slate-800/50"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          Lineups {optimizeMutation.data ? `(${optimizeMutation.data.lineups?.length || 0})` : ""}
        </button>
      </div>

      <div className="flex flex-col xl:flex-row flex-1 overflow-hidden">
        {/* LEFT: Player Pool */}
        <div className={`flex-1 flex flex-col overflow-hidden border-r border-slate-800 ${mobileView !== "players" ? "hidden xl:flex" : ""}`}>
          {/* Filter Bar */}
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/20 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search players..."
                className="bg-slate-900 border-slate-700 pl-10 h-9 text-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-player-search"
              />
            </div>
            <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800 flex-wrap">
              {positions.map(pos => (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos)}
                  data-testid={`filter-pos-${pos}`}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-black transition-all ${
                    posFilter === pos
                      ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                      : "text-slate-400 hover:text-slate-300"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-400 font-bold ml-auto" data-testid="text-player-count">
              {filteredPlayers.length} players
            </div>
          </div>

          {/* Golf Tournament Cards */}
          {isGolf && golfTournamentCards && (
            <div className="px-4 pb-3 pt-3 border-b border-lime-500/20">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-lime-400" />
                <span className="text-xs font-black text-white uppercase tracking-widest">Tournament Center</span>
                <Badge className="text-[10px] font-black bg-lime-500/20 text-lime-300 border-lime-500/30">LIVE</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pb-2">
                <div className="rounded-xl overflow-hidden bg-gradient-to-br from-lime-500/10 via-emerald-500/10 to-slate-900 border border-lime-500/25" data-testid="pro-tournament-info-card">
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Flag className="w-4 h-4 text-lime-400" />
                      <span className="text-sm font-black text-white">{golfTournamentCards.tournamentName}</span>
                    </div>
                    {golfTournamentCards.courseName && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        <span className="text-xs text-slate-300 font-medium">{golfTournamentCards.courseName}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3 text-slate-400" />
                        <span className="text-[11px] font-bold text-slate-300">{golfTournamentCards.fieldSize} Golfers</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-bold text-slate-300">Avg ${golfTournamentCards.avgSalary.toLocaleString()}</span>
                      </div>
                    </div>
                    {slate && (
                      <div className="mt-2 text-[10px] font-bold text-lime-400/70 uppercase tracking-wider">
                        {new Date(slate.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-xl overflow-hidden bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-900 border border-amber-500/20" data-testid="pro-favorites-card">
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Flame className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-black text-white uppercase tracking-widest">Top Favorites</span>
                    </div>
                    <div className="space-y-1.5">
                      {golfTournamentCards.favorites.map((p: any, i: number) => (
                        <div key={p.id} className="flex items-center justify-between group" data-testid={`pro-favorite-${i}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black w-4 text-center ${i === 0 ? "text-amber-400" : i === 1 ? "text-slate-300" : "text-slate-500"}`}>{i + 1}</span>
                            <span className="text-xs font-bold text-white group-hover:text-lime-400 transition-colors">{p.name}</span>
                            <span className="text-[10px] text-slate-500 font-medium">{p.team}</span>
                          </div>
                          <span className="text-[11px] font-black text-amber-400 font-mono">{p.odds}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl overflow-hidden bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-900 border border-cyan-500/20" data-testid="pro-value-picks-card">
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Award className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-black text-white uppercase tracking-widest">Value Picks</span>
                    </div>
                    <div className="space-y-1.5">
                      {golfTournamentCards.valuePicks.map((p: any, i: number) => (
                        <div key={p.id} className="flex items-center justify-between group" data-testid={`pro-value-pick-${i}`}>
                          <div className="flex items-center gap-2">
                            <Star className={`w-3 h-3 ${i === 0 ? "text-cyan-400 fill-cyan-400" : "text-cyan-400/40"}`} />
                            <span className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors">{p.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-mono">${p.salary.toLocaleString()}</span>
                            <span className="text-[11px] font-black text-cyan-400 font-mono">{p.value.toFixed(1)}x</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Player Table - Desktop */}
          <div className="flex-1 overflow-auto hidden md:block">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
                <tr className="text-slate-400">
                  <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Lock</th>
                  <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Excl</th>
                  <SortHeader label="Pos" field="position" />
                  <SortHeader label="Player" field="name" />
                  <SortHeader label="Team" field="team" />
                  <SortHeader label="Salary" field="salary" />
                  <SortHeader label="Base Proj" field="projectedPoints" />
                  <SortHeader label="Boosted Proj" field="boostedProj" />
                  {hasPaidAccess ? (
                    <SortHeader label="Proj. Own%" field="ownershipProjection" />
                  ) : (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-center">
                      <div className="flex items-center justify-center gap-1 text-amber-500/70">
                        <Lock className="w-3 h-3" />
                        <span>Own%</span>
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[8px] px-1 py-0 font-black">STAR+</Badge>
                      </div>
                    </th>
                  )}
                  {isPro ? (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 text-center">Fade</th>
                  ) : (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-center">
                      <div className="flex items-center justify-center gap-1 text-amber-500/70">
                        <Lock className="w-3 h-3" />
                        <span>Fade</span>
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[8px] px-1 py-0 font-black">PRO</Badge>
                      </div>
                    </th>
                  )}
                  {isPro ? (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 text-center">Exp%</th>
                  ) : (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-center">
                      <div className="flex items-center justify-center gap-1 text-amber-500/70">
                        <Lock className="w-3 h-3" />
                        <span>Exp%</span>
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[8px] px-1 py-0 font-black">PRO</Badge>
                      </div>
                    </th>
                  )}
                  <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredPlayers.map(player => {
                  const isLocked = lockedIds.includes(player.id);
                  const hasInjury = player.injuryStatus && player.injuryStatus !== "Healthy";
                  const injuryColor = hasInjury ? (INJURY_COLORS[player.injuryStatus!] || INJURY_COLORS["Day-to-Day"]) : "";

                  return (
                    <tr
                      key={player.id}
                      className={`group transition-colors hover:bg-slate-800/30 ${isLocked ? "bg-amber-500/5" : ""} ${player.isFaded ? "bg-purple-500/5" : ""}`}
                      data-testid={`player-row-${player.id}`}
                    >
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => {
                            setLockedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                            setExcludedIds(prev => prev.filter(i => i !== player.id));
                          }}
                          data-testid={`lock-${player.id}`}
                          className={`p-1.5 rounded-md transition-all ${
                            isLocked
                              ? "bg-amber-500 text-black shadow-md"
                              : "text-slate-400 hover:text-amber-400 hover:bg-slate-800"
                          }`}
                        >
                          {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => {
                            setExcludedIds(prev => [...prev, player.id]);
                            setLockedIds(prev => prev.filter(i => i !== player.id));
                          }}
                          data-testid={`exclude-${player.id}`}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[11px] font-bold text-amber-400/80">{player.position}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <PlayerHistoryCard playerName={player.name} sport={sport}>
                            <span className="font-bold text-sm text-white group-hover:text-amber-400 transition-colors cursor-default" data-testid={`text-player-name-${player.id}`}>
                              {player.name}
                            </span>
                          </PlayerHistoryCard>
                          {player.isConfirmedStarter && (
                            <Badge variant="outline" className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/30" data-testid={`badge-starter-${player.id}`}>
                              STARTER
                            </Badge>
                          )}
                          {hasInjury && (
                            <Badge variant="outline" className={`text-[11px] font-bold ${injuryColor}`} data-testid={`badge-injury-${player.id}`}>
                              {player.injuryStatus}
                            </Badge>
                          )}
                          {isPro && player.isFaded && (
                            <Badge variant="outline" className="text-[10px] font-bold bg-purple-500/10 text-purple-400 border-purple-500/30" data-testid={`badge-faded-${player.id}`}>
                              FADED
                            </Badge>
                          )}
                        </div>
                        {player.gameInfo && (
                          <div className="text-[11px] text-slate-400 font-medium">{player.gameInfo}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase" data-testid={`text-team-${player.id}`}>{player.team}</td>
                      <td className="px-3 py-2 font-mono text-sm font-bold text-white" data-testid={`text-salary-${player.id}`}>${player.salary.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-sm text-slate-400" data-testid={`text-base-proj-${player.id}`}>
                        {player.baseProj.toFixed(1)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1" data-testid={`text-boosted-proj-${player.id}`}>
                          <span className={`font-mono text-sm font-bold ${player.boost > 0 ? "text-emerald-400" : player.boost < 0 ? "text-red-400" : "text-slate-400"}`}>
                            {player.boostedProj.toFixed(1)}
                          </span>
                          {player.boost !== 0 && (
                            <span className={`flex items-center text-[11px] font-bold ${player.boost > 0 ? "text-emerald-400" : "text-red-400"}`} data-testid={`boost-indicator-${player.id}`}>
                              {player.boost > 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                              {player.boost > 0 ? "+" : ""}{player.boost.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </td>
                      {hasPaidAccess ? (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1" data-testid={`text-own-${player.id}`}>
                            <Users className="w-3 h-3 text-slate-500" />
                            <span className={`font-mono text-[11px] font-bold ${
                              player.ownershipProjection >= 25 ? "text-red-400" :
                              player.ownershipProjection >= 15 ? "text-amber-400" :
                              player.ownershipProjection >= 8 ? "text-slate-300" :
                              "text-emerald-400"
                            }`}>
                              {player.ownershipProjection.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      ) : (
                        <td className="px-3 py-2 text-center">
                          <span className="font-mono text-[11px] font-bold text-slate-600 blur-[3px] select-none">
                            {(Math.sin(player.id * 31) * 15 + 15).toFixed(1)}%
                          </span>
                        </td>
                      )}
                      {isPro ? (
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => {
                              setFadedIds(prev => prev.includes(player.id)
                                ? prev.filter(i => i !== player.id)
                                : [...prev, player.id]
                              );
                            }}
                            data-testid={`fade-${player.id}`}
                            className={`p-1.5 rounded-md transition-all ${
                              player.isFaded
                                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30 shadow-sm"
                                : "text-slate-500 hover:text-purple-400 hover:bg-purple-500/10"
                            }`}
                            title={player.isFaded ? "Unfade player (restore projection)" : "Fade player (reduce projection by projected ownership %)"}
                          >
                            <Percent className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      ) : (
                        <td className="px-3 py-2 text-center">
                          <div className="p-1.5 text-slate-700 cursor-not-allowed" title="Upgrade to Champion to fade players">
                            <Lock className="w-3.5 h-3.5" />
                          </div>
                        </td>
                      )}
                      {isPro ? (
                        <td className="px-3 py-2 text-center">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            placeholder="—"
                            value={exposureLimits[player.id.toString()] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setExposureLimits(prev => {
                                const next = { ...prev };
                                if (val === "" || val === undefined) {
                                  delete next[player.id.toString()];
                                } else {
                                  next[player.id.toString()] = Math.min(100, Math.max(0, Number(val)));
                                }
                                return next;
                              });
                            }}
                            className="w-16 h-7 text-center text-[11px] font-bold bg-slate-800 border-slate-700 px-1"
                            data-testid={`input-exposure-${player.id}`}
                          />
                        </td>
                      ) : (
                        <td className="px-3 py-2 text-center">
                          <div className="p-1.5 text-slate-700 cursor-not-allowed" title="Upgrade to Champion for exposure limits">
                            <Lock className="w-3.5 h-3.5" />
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-2" data-testid={`star-rating-${player.id}`}>
                        <PlayerStarRating stars={getPlayerStarCount(player.boostedProj)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Player Cards - Mobile */}
          <div className="flex-1 overflow-auto md:hidden p-2 space-y-1.5">
            {filteredPlayers.map(player => {
              const isLocked = lockedIds.includes(player.id);
              const isExcluded = excludedIds.includes(player.id);
              const isFaded = fadedIds.includes(player.id);
              const ownershipPct = (player as PlayerWithOwnership).ownershipProjection;
              const isSwapEligible = swappingTarget ? (() => {
                const lineupIdx = swappingTarget.lineupIdx;
                const slot = swappingTarget.slot;
                const lineup = generatedLineups[lineupIdx];
                if (!lineup) return false;
                const slotPos = slot.replace(/\d+/g, '');
                if (!positionFitsSlot(player.position, slotPos, sport)) return false;
                const currentPlayer = lineup.find((_, i) => `${lineup[i].position}${i}` === slot || getSlotDisplayName(config.rosterSlots[i], i, config.rosterSlots) === slot);
                if (currentPlayer && player.id === currentPlayer.id) return false;
                return true;
              })() : false;
              const isSwapIneligible = swappingTarget && !isSwapEligible;
              return (
                <div
                  key={player.id}
                  data-testid={`mobile-pro-player-card-${player.id}`}
                  className={`rounded-lg border p-2.5 transition-all ${
                    isSwapIneligible ? "opacity-30 border-slate-800 bg-slate-900/30" :
                    isSwapEligible ? "border-emerald-500/30 bg-emerald-500/5 cursor-pointer" :
                    isExcluded ? "border-red-500/30 bg-red-500/5 opacity-50" :
                    isLocked ? "border-amber-500/30 bg-amber-500/5" :
                    isFaded ? "border-slate-700 bg-slate-900/30 opacity-60" :
                    "border-slate-800 bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{player.position}</span>
                        <span className="text-sm font-bold text-white truncate">{player.name}</span>
                        {player.isConfirmedStarter && (
                          <Badge variant="outline" className="text-[8px] font-bold py-0 px-1 border-emerald-500/50 text-emerald-400 bg-emerald-500/10">STARTER</Badge>
                        )}
                        {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                          <Badge variant="outline" className={`text-[8px] font-bold py-0 px-1 ${INJURY_COLORS[player.injuryStatus] || INJURY_COLORS["Day-to-Day"]}`}>
                            {player.injuryStatus}
                          </Badge>
                        )}
                        {isFaded && <Badge className="text-[8px] py-0 px-1 bg-slate-700 text-slate-400 border-slate-600">FADED</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span className="font-bold">{player.team}</span>
                        {player.opponent && <span>vs {player.opponent}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-sm font-mono font-bold text-white">${player.salary.toLocaleString()}</span>
                        <span className="text-sm font-mono font-bold text-amber-400">{Number(player.projectedPoints).toFixed(1)} pts</span>
                        {player.effectiveProj && Number(player.effectiveProj) !== Number(player.projectedPoints) && (
                          <span className="text-xs font-mono font-bold text-emerald-400">{Number(player.effectiveProj).toFixed(1)}</span>
                        )}
                        {hasPaidAccess && ownershipPct != null && (
                          <span className="text-xs font-mono text-cyan-400">{ownershipPct.toFixed(1)}%</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          setLockedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                          setExcludedIds(prev => prev.filter(i => i !== player.id));
                          setFadedIds(prev => prev.filter(i => i !== player.id));
                        }}
                        data-testid={`mobile-pro-lock-${player.id}`}
                        className={`p-1.5 rounded-md transition-all ${
                          isLocked ? "bg-amber-500 text-white" : "text-slate-600 hover:text-amber-400"
                        }`}
                      >
                        {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => {
                          setFadedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                          setLockedIds(prev => prev.filter(i => i !== player.id));
                        }}
                        data-testid={`mobile-pro-fade-${player.id}`}
                        className={`p-1.5 rounded-md transition-all ${
                          isFaded ? "bg-slate-600 text-white" : "text-slate-600 hover:text-slate-300"
                        }`}
                      >
                        <TrendingDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setExcludedIds(prev => [...prev, player.id]);
                          setLockedIds(prev => prev.filter(i => i !== player.id));
                        }}
                        data-testid={`mobile-pro-exclude-${player.id}`}
                        className="p-1.5 rounded-md text-slate-600 hover:text-red-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Excluded Players Bar */}
          {excludedPlayers.length > 0 && (
            <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-black text-red-400 uppercase tracking-widest">Excluded:</span>
              {excludedPlayers.map(p => (
                <Badge
                  key={p.id}
                  variant="outline"
                  className="border-red-500/30 text-red-400 text-[11px] font-bold cursor-pointer"
                  onClick={() => setExcludedIds(prev => prev.filter(i => i !== p.id))}
                  data-testid={`excluded-badge-${p.id}`}
                >
                  {p.name} <X className="w-3 h-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}

          {!hasPaidAccess && (
            <div className="border-t border-amber-500/20 bg-gradient-to-r from-amber-500/5 via-amber-500/10 to-amber-500/5 px-4 py-3" data-testid="pro-upgrade-banner">
              <Link href="/pricing">
                <div className="flex items-center justify-between cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <Crown className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-amber-400 uppercase tracking-wider">Unlock Sharpshooter Features</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Projected ownership, player fading, and contrarian lineup building</p>
                    </div>
                  </div>
                  <Badge className="bg-amber-500 text-black font-black text-[10px] px-2 py-1 group-hover:bg-amber-400 transition-colors flex-shrink-0">
                    Upgrade
                  </Badge>
                </div>
              </Link>
            </div>
          )}

          {/* Faded Players Bar (Pro only) */}
          {isPro && fadedIds.length > 0 && players && (
            <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-2 flex items-center gap-2 flex-wrap" data-testid="faded-players-bar">
              <span className="text-[11px] font-black text-purple-400 uppercase tracking-widest">Faded:</span>
              {players.filter(p => fadedIds.includes(p.id)).map(p => (
                <Badge
                  key={p.id}
                  variant="outline"
                  className="border-purple-500/30 text-purple-400 text-[11px] font-bold cursor-pointer"
                  onClick={() => setFadedIds(prev => prev.filter(i => i !== p.id))}
                  data-testid={`faded-badge-${p.id}`}
                >
                  {p.name} ({((p as any).ownershipProjection ?? 0).toFixed(0)}%) <X className="w-3 h-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Results & Summary Panels */}
        <div className={`w-full xl:w-[480px] flex flex-col bg-slate-900/30 overflow-hidden ${mobileView !== "lineup" ? "hidden xl:flex" : ""}`}>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* GOLF Tournament Analysis */}
            {isGolf && golfAnalysis && (
              <>
                {/* Tournament Header */}
                <div data-testid="golf-tournament-header">
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy className="w-4 h-4 text-lime-400" />
                    <span className="text-sm font-black text-white uppercase tracking-widest">Tournament Analysis</span>
                    <Badge className="text-[10px] font-black bg-lime-500/20 text-lime-300 border-lime-500/30">AI</Badge>
                  </div>
                  <Card className="bg-gradient-to-br from-lime-500/10 via-emerald-500/5 to-slate-900 border-lime-500/20 p-4" data-testid="tournament-overview-card">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Flag className="w-4 h-4 text-lime-400" />
                          <span className="text-base font-black text-white">{golfAnalysis.tournament.name}</span>
                        </div>
                        {golfAnalysis.tournament.course && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            <span className="text-xs text-slate-300">{golfAnalysis.tournament.course}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 bg-slate-800/80 rounded-lg px-2.5 py-1 border border-slate-700/50">
                        <Users className="w-3 h-3 text-slate-400" />
                        <span className="text-xs font-bold text-slate-300">{golfAnalysis.tournament.fieldSize}</span>
                      </div>
                    </div>
                    {golfAnalysis.courseProfile && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {golfAnalysis.courseProfile.traits.map((trait: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] font-bold border-lime-500/20 text-lime-300/80 bg-lime-500/5">
                            {trait}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>

                {/* Weather & Course Conditions */}
                <div data-testid="golf-weather-panel">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    {golfAnalysis.weather.icon === "sun" ? <Sun className="w-4 h-4 text-amber-400" /> :
                     golfAnalysis.weather.icon === "wind" ? <Wind className="w-4 h-4 text-cyan-400" /> :
                     golfAnalysis.weather.icon === "cloud-rain" ? <CloudRain className="w-4 h-4 text-blue-400" /> :
                     <Cloud className="w-4 h-4 text-slate-400" />}
                    Course Conditions
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Weather</div>
                        <div className="text-sm font-bold text-white">{golfAnalysis.weather.condition}</div>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Temperature</div>
                        <div className="text-sm font-bold text-amber-400">{golfAnalysis.weather.temp}</div>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Wind</div>
                        <div className="text-sm font-bold text-cyan-400">{golfAnalysis.weather.wind}</div>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Humidity</div>
                        <div className="text-sm font-bold text-blue-400">{golfAnalysis.weather.humidity}</div>
                      </div>
                    </div>
                    {golfAnalysis.courseProfile?.keyStats && (
                      <div className="border-t border-slate-700/50 pt-2.5">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Key Stats for This Course</div>
                        <div className="flex flex-wrap gap-1.5">
                          {golfAnalysis.courseProfile.keyStats.map((stat: string, i: number) => (
                            <Badge key={i} className="text-[10px] font-bold bg-amber-500/10 text-amber-300 border-amber-500/20">
                              <BarChart3 className="w-2.5 h-2.5 mr-1" />
                              {stat}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                </div>

                {/* Algorithm Top Picks */}
                <div data-testid="golf-algo-picks">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Flame className="w-4 h-4 text-amber-400" />
                    Algorithm Top Picks
                    <Badge className="text-[10px] font-black bg-amber-500/15 text-amber-300 border-amber-500/20">TOP 6</Badge>
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="space-y-2">
                      {golfAnalysis.topAlgoPicks?.map((p: any, i: number) => (
                        <div key={p.playerId} className="flex items-center gap-2 group" data-testid={`algo-pick-${i}`}>
                          <span className={`text-[11px] font-black w-5 text-center rounded-full ${
                            i === 0 ? "bg-amber-500/20 text-amber-400" :
                            i === 1 ? "bg-slate-500/20 text-slate-300" :
                            i === 2 ? "bg-orange-500/20 text-orange-400" :
                            "text-slate-500"
                          }`}>
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-white group-hover:text-lime-400 transition-colors truncate block">{p.name}</span>
                            <span className="text-[10px] text-slate-500">{p.team}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-right">
                              <div className="text-[10px] text-slate-500 font-bold">Course Fit</div>
                              <div className={`text-[11px] font-black ${p.courseFitScore >= 80 ? "text-lime-400" : p.courseFitScore >= 65 ? "text-amber-400" : "text-slate-400"}`}>
                                {p.courseFitScore}%
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] text-slate-500 font-bold">Algo</div>
                              <div className="text-[11px] font-black text-amber-400">{p.algoScore}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* Value Plays */}
                <div data-testid="golf-value-plays">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Award className="w-4 h-4 text-cyan-400" />
                    Value Plays
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="space-y-2">
                      {golfAnalysis.valuePlays?.map((p: any, i: number) => (
                        <div key={p.playerId} className="flex items-center gap-2 group" data-testid={`value-play-${i}`}>
                          <Target className="w-3 h-3 text-cyan-400/60 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors truncate block">{p.name}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">${p.salary.toLocaleString()}</span>
                          <span className={`text-[11px] font-black flex-shrink-0 ${p.courseFitScore >= 75 ? "text-lime-400" : "text-amber-400"}`}>
                            {p.courseFitScore}% fit
                          </span>
                          <span className="text-[11px] font-black text-cyan-400 flex-shrink-0">{p.algoScore}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* Contrarian Picks */}
                {golfAnalysis.contrarianPicks?.length > 0 && (
                  <div data-testid="golf-contrarian-picks">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                      <Percent className="w-4 h-4 text-purple-400" />
                      Low Proj. Ownership Gems
                    </h3>
                    <Card className="bg-gradient-to-br from-purple-500/10 via-slate-900 to-slate-900 border-purple-500/20 p-3">
                      <div className="space-y-2">
                        {golfAnalysis.contrarianPicks.map((p: any, i: number) => (
                          <div key={p.playerId} className="flex items-center gap-2 group" data-testid={`contrarian-pick-${i}`}>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-bold text-white group-hover:text-purple-400 transition-colors truncate block">{p.name}</span>
                              <span className="text-[10px] text-slate-500">{p.team} · ${p.salary.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {hasPaidAccess && (
                                <div className="text-right">
                                  <div className="text-[10px] text-slate-500 font-bold">Own%</div>
                                  <div className="text-[11px] font-black text-purple-400">{p.ownershipProjection}%</div>
                                </div>
                              )}
                              <div className="text-right">
                                <div className="text-[10px] text-slate-500 font-bold">Score</div>
                                <div className="text-[11px] font-black text-amber-400">{p.algoScore}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </div>
                )}

                {/* Strokes Gained Leaders */}
                {golfAnalysis.topAlgoPicks && (
                  <div data-testid="golf-sg-leaders">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                      <BarChart3 className="w-4 h-4 text-emerald-400" />
                      Strokes Gained Leaders
                    </h3>
                    <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className="text-[10px] font-black text-slate-400 uppercase text-center">SG: Approach</div>
                        <div className="text-[10px] font-black text-slate-400 uppercase text-center">SG: Putting</div>
                        <div className="text-[10px] font-black text-slate-400 uppercase text-center">SG: Off-Tee</div>
                      </div>
                      {golfAnalysis.playerAnalysis?.slice(0, 5).map((p: any) => (
                        <div key={p.playerId} className="grid grid-cols-3 gap-2 py-1 border-t border-slate-700/30">
                          <div className="text-center">
                            <div className="text-[10px] text-slate-500 truncate">{p.name.split(' ').pop()}</div>
                            <div className={`text-[11px] font-black ${p.sgApproach > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.sgApproach > 0 ? "+" : ""}{p.sgApproach.toFixed(2)}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-slate-500 truncate">{p.name.split(' ').pop()}</div>
                            <div className={`text-[11px] font-black ${p.sgPutting > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.sgPutting > 0 ? "+" : ""}{p.sgPutting.toFixed(2)}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-slate-500 truncate">{p.name.split(' ').pop()}</div>
                            <div className={`text-[11px] font-black ${p.sgOffTee > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.sgOffTee > 0 ? "+" : ""}{p.sgOffTee.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </Card>
                  </div>
                )}

                {/* Round-by-Round Forecast */}
                <div data-testid="golf-rounds-forecast">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-amber-400" />
                    Round Schedule
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="space-y-2">
                      {golfAnalysis.rounds?.map((r: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-slate-700/30 last:border-0" data-testid={`round-${i}`}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] font-black border-amber-500/20 text-amber-300 bg-amber-500/5 w-10 justify-center">
                              R{i + 1}
                            </Badge>
                            <div>
                              <span className="text-xs font-bold text-white">{r.day}</span>
                              <span className="text-[10px] text-slate-500 ml-2">{r.time}</span>
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-slate-400">{r.conditions}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </>
            )}

            {/* Slate Games (non-golf) */}
            {!isGolf && games.length > 0 && (
              <div data-testid="pro-games-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-amber-400" />
                  Scheduled Games ({games.length})
                </h3>
                <div className="flex flex-wrap gap-2 justify-center">
                  {games.map((game, i) => (
                    <div
                      key={i}
                      className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 min-w-[100px] transition-colors cursor-default hover:border-amber-500/30"
                      data-testid={`pro-game-card-${i}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="text-xs font-black text-white">{game.away}</span>
                        <span className="text-xs font-bold text-slate-500">0</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-black text-white">{game.home}</span>
                        <span className="text-xs font-bold text-slate-500">0</span>
                      </div>
                      <div className="text-[11px] font-bold mt-1.5 pt-1.5 border-t border-slate-700/50 text-center text-amber-400/60">
                        {game.time}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Lineups */}
            {generatedLineups.length > 0 && (
              <div data-testid="generated-lineups-section">
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                    <Crown className="w-4 h-4 text-amber-400" />
                    Generated Lineups ({generatedLineups.length})
                  </h3>
                </div>
                <div className="space-y-3">
                  {generatedLineups.map((lineupData, idx) => {
                    const lineupPlayers = lineupData.lineup || [];
                    const slots = assignPlayersToSlots(lineupPlayers, config.slots, sport);
                    const lineupGrade = lineupPlayers.length > 0
                      ? gradeLineup(lineupPlayers, sport, platform, lineupData.totalSalary || 0, lineupData.totalProjectedPoints || 0)
                      : null;
                    return (
                      <Card key={idx} className={`border-slate-700/50 p-3 ${swappingTarget?.lineupIdx === idx ? "bg-slate-800/80 border-amber-500/30 ring-1 ring-amber-500/10" : "bg-slate-800/60"}`} data-testid={`lineup-card-${idx}`}>
                        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                          <div className="flex items-center gap-3">
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px] font-black">
                              #{idx + 1}
                            </Badge>
                            <div className="flex items-center gap-1.5 bg-emerald-500/10 rounded px-2 py-0.5 border border-emerald-500/20" data-testid={`text-lineup-proj-${idx}`}>
                              <span className="text-[10px] font-bold text-emerald-500/70 uppercase">FP</span>
                              <span className="text-sm font-black text-emerald-400 tabular-nums">{lineupData.totalProjectedPoints?.toFixed(1)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-700/50 rounded px-2 py-0.5 border border-slate-600/30" data-testid={`text-lineup-salary-${idx}`}>
                              <span className="text-sm font-black text-white tabular-nums">${lineupData.totalSalary?.toLocaleString()}</span>
                            </div>
                            {lineupGrade && (
                              <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-black ${GRADE_COLORS[lineupGrade.grade]?.bg || ""} ${GRADE_COLORS[lineupGrade.grade]?.text || "text-slate-400"} ${GRADE_COLORS[lineupGrade.grade]?.border || ""}`} data-testid={`lineup-grade-${idx}`}>
                                {lineupGrade.grade === "S" && <Star className="w-3 h-3 fill-current" />}
                                {lineupGrade.grade}
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={`font-bold text-[11px] ${savedIndices.has(idx) ? "text-emerald-400" : "text-amber-400"}`}
                            onClick={() => handleSaveLineup(lineupData, idx)}
                            disabled={saveLineupMutation.isPending || isSavingAll || savedIndices.has(idx)}
                            data-testid={`button-save-lineup-${idx}`}
                          >
                            {savedIndices.has(idx) ? (
                              <><Trophy className="w-3.5 h-3.5 mr-1" /> Saved</>
                            ) : (
                              <><Save className="w-3.5 h-3.5 mr-1" /> Save</>
                            )}
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {config.slots.map(slot => {
                            const p = slots[slot];
                            const isSwapping = swappingTarget?.lineupIdx === idx && swappingTarget?.slot === slot;
                            return (
                              <div key={slot} className={`flex items-center gap-2 text-[11px] rounded px-1 py-0.5 transition-all ${isSwapping ? "bg-amber-500/10 ring-1 ring-amber-500/30" : ""}`} data-testid={`lineup-slot-${idx}-${slot}`}>
                                <span className={`font-black w-8 text-right ${isSwapping ? "text-amber-400" : "text-amber-400/70"}`}>{getSlotDisplayName(slot)}</span>
                                {p ? (
                                  <>
                                    <PlayerInfoHoverCard player={p} platform={platform}>
                                      <span className={`font-bold flex-1 truncate cursor-pointer hover:underline decoration-dotted underline-offset-2 ${fadedIds.includes(p.id) ? "text-purple-300" : "text-white"}`}>{p.name}</span>
                                    </PlayerInfoHoverCard>
                                    <PlayerStarRating stars={getPlayerStarCount(Number(p.projectedPoints))} />
                                    <span className="text-slate-400 font-mono">${p.salary.toLocaleString()}</span>
                                    {hasPaidAccess && <span className="text-purple-400/70 font-mono text-[10px] w-10 text-right">{((p as any).ownershipProjection ?? 0).toFixed(0)}%</span>}
                                    <span className="text-emerald-400 font-mono font-bold">{Number(p.projectedPoints).toFixed(1)}</span>
                                    <button
                                      onClick={() => handleProSwap(idx, slot)}
                                      className={`p-0.5 rounded transition-all ${
                                        isSwapping
                                          ? "bg-amber-500 text-white shadow-md"
                                          : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"
                                      }`}
                                      data-testid={`pro-swap-${idx}-${slot}`}
                                      title="Swap player"
                                    >
                                      <ArrowLeftRight className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-slate-500 italic flex-1">—</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {swappingTarget?.lineupIdx === idx && (
                          <div className="mt-2 pt-2 border-t border-amber-500/20" data-testid={`swap-panel-${idx}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
                                <span className="text-[11px] font-black text-amber-400">
                                  Swap {slots[swappingTarget.slot]?.name} — {proSwapEligiblePlayers.length} eligible
                                </span>
                              </div>
                              <button
                                onClick={() => setSwappingTarget(null)}
                                className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-700 transition-all"
                                data-testid={`cancel-pro-swap-${idx}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="max-h-40 overflow-auto space-y-0.5">
                              {proSwapEligiblePlayers.slice(0, 30).map(ep => (
                                <button
                                  key={ep.id}
                                  onClick={() => handleProSwapSelect(ep)}
                                  className="w-full flex items-center gap-2 text-[11px] px-1.5 py-1 rounded hover:bg-amber-500/10 transition-all group"
                                  data-testid={`pro-swap-pick-${idx}-${ep.id}`}
                                >
                                  <Plus className="w-3 h-3 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  <span className="font-bold text-white flex-1 truncate text-left">{ep.name}</span>
                                  <span className="text-slate-500 font-mono">{ep.position}</span>
                                  <span className="text-slate-400 font-mono">${ep.salary.toLocaleString()}</span>
                                  <span className="text-emerald-400 font-mono font-bold">{Number(ep.projectedPoints).toFixed(1)}</span>
                                </button>
                              ))}
                              {proSwapEligiblePlayers.length === 0 && (
                                <div className="text-[11px] text-slate-500 text-center py-2">No eligible replacements within salary cap</div>
                              )}
                            {proSwapEligiblePlayers.length > 30 && (
                              <div className="text-[10px] text-slate-500 text-center py-1">
                                Showing 30 of {proSwapEligiblePlayers.length} eligible players
                              </div>
                            )}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Exposure Tracking */}
            {isPro && exposureTracking.length > 0 && (
              <div data-testid="exposure-tracking-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-cyan-400" />
                  Player Exposure ({generatedLineups.length} lineups)
                  {globalMaxExposure && (
                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[9px] font-black ml-1" data-testid="badge-global-exposure">
                      Max {globalMaxExposure}%
                    </Badge>
                  )}
                </h3>
                <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                  <div className="space-y-1.5">
                    {exposureTracking.slice(0, 20).map((ep) => (
                      <div key={ep.playerId} className="flex items-center gap-2" data-testid={`exposure-row-${ep.playerId}`}>
                        <span className="text-[10px] font-bold text-amber-400/70 w-8 text-right">{ep.position}</span>
                        <span className="text-xs font-bold text-white flex-1 truncate">{ep.playerName}</span>
                        <span className="text-[11px] font-mono text-slate-400">{ep.count}/{ep.total}</span>
                        <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${ep.overLimit ? "bg-red-400" : "bg-cyan-400"}`}
                            style={{ width: `${Math.min(ep.pct, 100)}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-black min-w-[36px] text-right ${ep.overLimit ? "text-red-400" : "text-cyan-400"}`} data-testid={`text-exposure-pct-${ep.playerId}`}>
                          {ep.pct.toFixed(0)}%
                        </span>
                        {ep.limit !== undefined && (
                          <span className={`text-[10px] font-bold ${ep.overLimit ? "text-red-400" : "text-slate-500"}`} data-testid={`text-exposure-limit-${ep.playerId}`}>
                            /{ep.limit}%{ep.isPlayerSpecific ? "" : " g"}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* AI Boosts Summary */}
            {boostedPlayers.length > 0 && (
              <div data-testid="boosts-summary-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  AI Boosts
                </h3>
                <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                  <div className="space-y-2">
                    {boostedPlayers.map((bp) => (
                      <div key={bp.playerId} className="flex items-center gap-2" data-testid={`boost-row-${bp.playerId}`}>
                        <span className={`text-[11px] font-black ${bp.boostScore > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {bp.boostScore > 0 ? "+" : ""}{bp.boostScore.toFixed(1)}
                        </span>
                        <span className="text-sm font-bold text-white flex-1 truncate">{bp.playerName}</span>
                        <span className="text-[11px] text-slate-400 truncate max-w-[180px]">{bp.boostReason}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* Injury Report Summary */}
            {injuredPlayers.length > 0 && (
              <div data-testid="injury-summary-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  Injury Report
                </h3>
                <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                  <div className="space-y-2">
                    {injuredPlayers.map((ip) => {
                      const color = INJURY_COLORS[ip.status] || INJURY_COLORS["Day-to-Day"];
                      return (
                        <div key={ip.playerId} className="flex items-center gap-2" data-testid={`injury-row-${ip.playerId}`}>
                          <Badge variant="outline" className={`text-[11px] font-bold ${color}`}>
                            {ip.status}
                          </Badge>
                          <span className="text-sm font-bold text-white flex-1 truncate">{ip.playerName}</span>
                          <span className="text-[11px] text-slate-400 truncate max-w-[180px]">{ip.detail}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {/* Empty State */}
            {generatedLineups.length === 0 && !optimizeMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
                <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
                  <Crown className="w-8 h-8 text-amber-400" />
                </div>
                <h3 className="text-lg font-black text-white mb-2">Ready to Optimize</h3>
                <p className="text-sm text-slate-400 max-w-xs">
                  Configure your settings and click Generate to create {lineupCount} optimized lineup{lineupCount > 1 ? "s" : ""}.
                </p>
              </div>
            )}

            {optimizeMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-16" data-testid="loading-state">
                <Loader2 className="w-10 h-10 text-amber-400 animate-spin mb-4" />
                <p className="text-sm font-bold text-slate-400">Generating {lineupCount} lineup{lineupCount > 1 ? "s" : ""}...</p>
              </div>
            )}

            {optimizeMutation.isError && (
              <Card className="bg-red-500/10 border-red-500/30 p-4" data-testid="error-state">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <span className="text-sm font-bold text-red-400">{optimizeMutation.error?.message || "Optimization failed"}</span>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
