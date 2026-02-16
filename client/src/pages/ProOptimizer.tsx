import { useState, useMemo, useCallback } from "react";
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
  ShieldAlert, Activity, SaveAll
} from "lucide-react";

type SortKey = "name" | "position" | "team" | "salary" | "projectedPoints" | "boostedProj";
type SortDir = "asc" | "desc";

const INJURY_COLORS: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/30",
  Doubtful: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Questionable: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Probable: "bg-green-500/20 text-green-400 border-green-500/30",
  "Day-to-Day": "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

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
  const [useBoosts, setUseBoosts] = useState(true);
  const [useInjuryAdjustments, setUseInjuryAdjustments] = useState(true);

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
  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [playerUrl],
    enabled: !!slateId,
  });

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number; sportCounts: Record<string, number> }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const isPro = subData?.tier === "pro" || subData?.tier === "premium";

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
        return { ...p, baseProj, boostedProj, boost };
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
          default: aVal = a.boostedProj; bVal = b.boostedProj;
        }
        if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      });
  }, [players, search, posFilter, excludedIds, sortKey, sortDir, useBoosts]);

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
    optimizeMutation.mutate({
      slateId,
      platform,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      playerProjections: Object.keys(customProjections).length > 0 ? customProjections : undefined,
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

  if (!isPro && !isLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <Card className="max-w-md w-full p-8 bg-slate-900 border-amber-500/30 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-6">
            <Crown className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-3" data-testid="text-pro-locked-title">Optimizer Pro</h2>
          <p className="text-slate-400 mb-6 text-sm" data-testid="text-pro-locked-desc">
            Unlock Optimizer Pro to generate up to 20 unique lineups at once with AI-powered boosts and injury adjustments.
          </p>
          <Link href="/pricing">
            <Button className="bg-amber-500 text-black font-black w-full" data-testid="button-upgrade-pro">
              <Crown className="w-4 h-4 mr-2" />
              Upgrade to Pro
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

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <label className="text-[10px] font-black text-slate-400 uppercase">Boosts</label>
            <Switch checked={useBoosts} onCheckedChange={setUseBoosts} data-testid="toggle-boosts" className="scale-90" />
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <label className="text-[10px] font-black text-slate-400 uppercase">Injuries</label>
            <Switch checked={useInjuryAdjustments} onCheckedChange={setUseInjuryAdjustments} data-testid="toggle-injuries" className="scale-90" />
          </div>

          <div className="h-4 w-px bg-slate-700 flex-shrink-0" />

          <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
            <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Qty</span>
            <Slider
              value={[lineupCount]}
              onValueChange={(v) => setLineupCount(v[0])}
              min={1}
              max={20}
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
                      className={`group transition-colors hover:bg-slate-800/30 ${isLocked ? "bg-amber-500/5" : ""}`}
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
        </div>

        {/* RIGHT: Results & Summary Panels */}
        <div className="w-full xl:w-[480px] flex flex-col bg-slate-900/30 overflow-hidden">
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Slate Games */}
            {games.length > 0 && (
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
                            if (!p) return null;
                            return (
                              <div key={slot} className="flex items-center gap-2 text-[11px]" data-testid={`lineup-slot-${idx}-${slot}`}>
                                <span className="font-black text-amber-400/70 w-8 text-right">{getSlotDisplayName(slot)}</span>
                                <span className="font-bold text-white flex-1 truncate">{p.name}</span>
                                <span className="text-slate-400 font-mono">${p.salary.toLocaleString()}</span>
                                <span className="text-emerald-400 font-mono font-bold">{Number(p.projectedPoints).toFixed(1)}</span>
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
