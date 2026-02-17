import { useState, useMemo, useCallback, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import type { Player, Slate, ProOptimizeResponse } from "@shared/schema";
import { getPlatformConfig, assignPlayersToSlots, getSlotDisplayName, type Platform } from "@shared/platform-config";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Lock, Unlock, X, Zap, Save, Search,
  ChevronDown, ChevronUp, ArrowUpDown, Loader2,
  Crown, TrendingUp, TrendingDown, AlertTriangle,
  ShieldAlert, Activity, SaveAll, Star, Flag, MapPin,
  Cloud, Sun, Wind, CloudRain, Droplets, Target,
  Trophy, Flame, Award, BarChart3, Users, Percent
} from "lucide-react";

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
  const [useBoosts, setUseBoosts] = useState(false);
  const [useInjuryAdjustments, setUseInjuryAdjustments] = useState(false);
  const [fadedIds, setFadedIds] = useState<number[]>([]);

  const { data: slates } = useQuery<Slate[]>({ queryKey: ["/api/slates"] });
  const slate = useMemo(() => slates?.find(s => s.id === slateId), [slates, slateId]);
  const platform = (slate?.platform || "draftkings") as Platform;
  const sport = slate?.sport || "NBA";

  const config = useMemo(() => {
    try { return getPlatformConfig(sport, platform); }
    catch { return getPlatformConfig("NBA", "draftkings"); }
  }, [sport, platform]);

  const mainSlates = useMemo(() => {
    if (!slates) return [];
    return slates.filter(s => s.isMain && s.sport === sport);
  }, [slates, sport]);

  const playerUrl = buildUrl("/api/slates/:id/players", { id: slateId });
  const { data: players, isLoading } = useQuery<PlayerWithOwnership[]>({
    queryKey: [playerUrl],
    enabled: !!slateId,
  });

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number; sportCounts: Record<string, number> }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const isGolf = sport === "GOLF";

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
    const tournamentParts = (players[0]?.gameInfo || "Tournament").split(" - ");
    return { favorites, valuePicks, tournamentName: tournamentParts[0] || "Tournament", courseName: tournamentParts[1] || "", fieldSize: players.length, avgSalary: Math.round(players.reduce((s, p) => s + p.salary, 0) / players.length) };
  }, [isGolf, players]);

  const isPro = subData?.tier === "pro" || subData?.tier === "premium";
  const isStar = subData?.tier === "star";
  const hasPaidAccess = isPro || isStar;
  const maxLineupSlider = isPro ? 20 : 5;

  useEffect(() => {
    if (isPro) {
      setUseBoosts(true);
      setUseInjuryAdjustments(true);
    }
  }, [isPro]);

  const optimizeMutation = useMutation<ProOptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize/pro", constraints);
      return res.json();
    },
  });

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
      toast({ title: "Lineup Saved!", description: "Added to your vault." });
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
        const boostedProj = useBoosts && boost !== 0 ? baseProj + boost : baseProj;
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

  const generatedLineups = optimizeMutation.data?.lineups || [];

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
    optimizeMutation.mutate({
      slateId,
      platform,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      playerProjections: Object.keys(projections).length > 0 ? projections : undefined,
      lineupCount,
      useBoosts,
      useInjuryAdjustments,
    });
  };

  const handleSaveLineup = (lineup: any, index: number) => {
    if (!user) return;
    const lineupPlayers = lineup.lineup || [];
    saveLineupMutation.mutate({
      userId: (user as any).id,
      slateId,
      sport,
      platform,
      totalSalary: lineup.totalSalary,
      totalProjectedPoints: String(lineup.totalProjectedPoints),
      playerIds: lineupPlayers.map((p: Player) => p.id),
      name: `Optimizer Pro #${index + 1} - ${sport} ${config.shortLabel}`,
    });
  };

  const handleSaveAll = async () => {
    if (!user || generatedLineups.length === 0) return;
    for (let i = 0; i < generatedLineups.length; i++) {
      handleSaveLineup(generatedLineups[i], i);
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
            Unlock the advanced optimizer to generate multiple unique lineups at once. Star gets up to 5 lineups, Pro gets up to 20 with AI boosts and injury adjustments.
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
      {/* Top Controls Bar - Single Clean Line */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2">
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
            onChange={e => handleSlateChange(e.target.value)}
            data-testid="pro-slate-selector"
          >
            {mainSlates.map(s => (
              <option key={s.id} value={s.id}>
                {s.platform === "fanduel" ? "FD" : "DK"} - {s.name}
              </option>
            ))}
          </select>

          <div className="h-4 w-px bg-slate-700 flex-shrink-0" />

          {isPro && (
            <>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-slate-400 uppercase">Boosts</label>
                <Switch checked={useBoosts} onCheckedChange={setUseBoosts} data-testid="toggle-boosts" className="scale-90" />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-slate-400 uppercase">Injuries</label>
                <Switch checked={useInjuryAdjustments} onCheckedChange={setUseInjuryAdjustments} data-testid="toggle-injuries" className="scale-90" />
              </div>
            </>
          )}

          <div className="h-4 w-px bg-slate-700 flex-shrink-0" />

          <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
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

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <Button
              onClick={handleOptimize}
              disabled={optimizeMutation.isPending}
              size="sm"
              className="bg-amber-500 text-black font-black shadow-lg shadow-amber-500/20 h-8 text-xs"
              data-testid="button-generate"
            >
              {optimizeMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 mr-1.5" />
              )}
              Generate {lineupCount}
            </Button>

            {generatedLineups.length > 0 && (
              <Button
                onClick={handleSaveAll}
                disabled={saveLineupMutation.isPending}
                variant="outline"
                size="sm"
                className="border-amber-500/30 text-amber-400 font-black h-8 text-xs"
                data-testid="button-save-all"
              >
                <SaveAll className="w-3.5 h-3.5 mr-1.5" />
                Save All
              </Button>
            )}

            <Button variant="ghost" size="sm" onClick={handleReset} className="text-slate-400 font-bold h-8 text-xs" data-testid="button-reset">
              Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row flex-1 overflow-hidden">
        {/* LEFT: Player Pool */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-800">
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

          {/* Player Table */}
          <div className="flex-1 overflow-auto">
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
                  {isPro && <SortHeader label="Own%" field="ownershipProjection" />}
                  {isPro && <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 text-center">Fade</th>}
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
                          <span className="font-bold text-sm text-white group-hover:text-amber-400 transition-colors" data-testid={`text-player-name-${player.id}`}>
                            {player.name}
                          </span>
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
                      {isPro && (
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
                      )}
                      {isPro && (
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
                            title={player.isFaded ? "Unfade player (restore projection)" : "Fade player (reduce projection by ownership %)"}
                          >
                            <Percent className="w-3.5 h-3.5" />
                          </button>
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
        <div className="w-full xl:w-[480px] flex flex-col bg-slate-900/30 overflow-hidden">
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
                      Low Ownership Gems
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
                              {isPro && (
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
                    return (
                      <Card key={idx} className="bg-slate-800/60 border-slate-700/50 p-3" data-testid={`lineup-card-${idx}`}>
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
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-amber-400 font-bold text-[11px]"
                            onClick={() => handleSaveLineup(lineupData, idx)}
                            disabled={saveLineupMutation.isPending}
                            data-testid={`button-save-lineup-${idx}`}
                          >
                            <Save className="w-3.5 h-3.5 mr-1" />
                            Save
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {config.slots.map(slot => {
                            const p = slots[slot];
                            return (
                              <div key={slot} className="flex items-center gap-2 text-[11px]" data-testid={`lineup-slot-${idx}-${slot}`}>
                                <span className="font-black text-amber-400/70 w-8 text-right">{getSlotDisplayName(slot)}</span>
                                {p ? (
                                  <>
                                    <span className={`font-bold flex-1 truncate ${fadedIds.includes(p.id) ? "text-purple-300" : "text-white"}`}>{p.name}</span>
                                    <PlayerStarRating stars={getPlayerStarCount(Number(p.projectedPoints))} />
                                    <span className="text-slate-400 font-mono">${p.salary.toLocaleString()}</span>
                                    {isPro && <span className="text-purple-400/70 font-mono text-[10px] w-10 text-right">{((p as any).ownershipProjection ?? 0).toFixed(0)}%</span>}
                                    <span className="text-emerald-400 font-mono font-bold">{Number(p.projectedPoints).toFixed(1)}</span>
                                  </>
                                ) : (
                                  <span className="text-slate-500 italic flex-1">—</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    );
                  })}
                </div>
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
