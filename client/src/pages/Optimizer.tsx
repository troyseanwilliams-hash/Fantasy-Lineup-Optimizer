import { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import type { Player, Slate, OptimizeResponse } from "@shared/schema";
import { getPlatformConfig, assignPlayersToSlots, getSlotDisplayName, positionFitsSlot, type Platform } from "@shared/platform-config";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Lock, Unlock, X, Zap, RefreshCw, Save, Search,
  ChevronDown, ChevronUp, ArrowUpDown, Heart, Loader2,
  DollarSign, Target, TrendingUp, RotateCcw, Crown, Plus, UserPlus, Activity, Flag,
  Trophy, Star, MapPin, Users, Flame, Award, Rocket
} from "lucide-react";

type SortKey = "name" | "position" | "team" | "salary" | "projectedPoints" | "fppg" | "value";
type SortDir = "asc" | "desc";

const INJURY_COLORS: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/30",
  Doubtful: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Questionable: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Probable: "bg-green-500/20 text-green-400 border-green-500/30",
  "Day-to-Day": "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function Optimizer() {
  const [, params] = useRoute("/optimizer/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const slateId = Number(params?.id);

  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [lockedIds, setLockedIds] = useState<number[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [customProjections, setCustomProjections] = useState<Record<string, number>>({});
  const [boosts, setBoosts] = useState<Record<number, number>>({});
  const [sortKey, setSortKey] = useState<SortKey>("projectedPoints");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lineupName, setLineupName] = useState("");
  const [removedSlots, setRemovedSlots] = useState<Set<string>>(new Set());
  const [replacingSlot, setReplacingSlot] = useState<string | null>(null);
  const [manualReplacements, setManualReplacements] = useState<Record<string, Player>>({});

  const { data: slates } = useQuery<Slate[]>({ queryKey: ["/api/slates"], refetchInterval: 300000 });
  const slate = useMemo(() => slates?.find(s => s.id === slateId), [slates, slateId]);
  const platform = (slate?.platform || "draftkings") as Platform;
  const sport = slate?.sport || "NBA";
  const slateHasStarted = slate ? new Date(slate.startTime) <= new Date() : false;

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
    refetchInterval: 300000,
  });

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number; sportCounts: Record<string, number> }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const optimizeMutation = useMutation<OptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize", constraints);
      return res.json();
    },
    onSuccess: () => {
      setRemovedSlots(new Set());
      setReplacingSlot(null);
      setManualReplacements({});
    }
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

  const isGolf = sport === "GOLF";

  const games = useMemo(() => {
    if (!players) return [];
    if (isGolf) {
      const tournamentName = players[0]?.gameInfo || "Tournament";
      return [{ away: tournamentName, home: "", time: `${players.length} Golfers` }];
    }
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
  }, [players, isGolf]);

  const golfAnalysis = useMemo(() => {
    if (!isGolf || !players || players.length === 0) return null;
    const sorted = [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
    const topSalary = Math.max(...players.map(p => p.salary));

    const favorites = sorted.slice(0, 5).map(p => {
      const impliedProb = (p.salary / topSalary) * 0.45;
      const americanOdds = impliedProb >= 0.5
        ? Math.round(-100 * impliedProb / (1 - impliedProb))
        : Math.round(100 * (1 - impliedProb) / impliedProb);
      return {
        ...p,
        odds: americanOdds > 0 ? `+${americanOdds}` : `${americanOdds}`,
        impliedProb: (impliedProb * 100).toFixed(0),
      };
    });

    const valuePicks = [...players]
      .map(p => ({ ...p, value: Number(p.projectedPoints) / (p.salary / 1000) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);

    const tournamentParts = (players[0]?.gameInfo || "Tournament").split(" - ");
    const tournamentName = tournamentParts[0] || "Tournament";
    const courseName = tournamentParts[1] || "";

    return { favorites, valuePicks, tournamentName, courseName, fieldSize: players.length, avgSalary: Math.round(players.reduce((s, p) => s + p.salary, 0) / players.length) };
  }, [isGolf, players]);

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
      .map(p => ({
        ...p,
        value: Number(p.projectedPoints) / (p.salary / 1000),
        effectiveProj: (() => {
          const base = customProjections[p.id] ?? Number(p.projectedPoints);
          const boostPct = boosts[p.id] || 0;
          return boostPct > 0 ? Math.round((base * (1 + boostPct / 100)) * 10) / 10 : base;
        })(),
      }))
      .sort((a, b) => {
        let aVal: any, bVal: any;
        switch (sortKey) {
          case "name": aVal = a.name; bVal = b.name; break;
          case "position": aVal = a.position; bVal = b.position; break;
          case "team": aVal = a.team; bVal = b.team; break;
          case "salary": aVal = a.salary; bVal = b.salary; break;
          case "projectedPoints": aVal = a.effectiveProj; bVal = b.effectiveProj; break;
          case "fppg": aVal = Number(a.fppg); bVal = Number(b.fppg); break;
          case "value": aVal = a.value; bVal = b.value; break;
          default: aVal = a.effectiveProj; bVal = b.effectiveProj;
        }
        if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      });
  }, [players, search, posFilter, excludedIds, customProjections, boosts, sortKey, sortDir]);

  const excludedPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter(p => excludedIds.includes(p.id));
  }, [players, excludedIds]);

  const currentLineup = optimizeMutation.data;
  const lineupSlots = useMemo(() => {
    if (!currentLineup?.lineup) return null;
    const activePlayers = currentLineup.lineup.filter(p => {
      const assignedSlots = config.slots;
      return true;
    });
    const assigned = assignPlayersToSlots(activePlayers, config.slots, sport);
    removedSlots.forEach(slot => {
      if (assigned[slot]) assigned[slot] = null;
    });
    Object.entries(manualReplacements).forEach(([slot, player]) => {
      assigned[slot] = player;
    });
    return assigned;
  }, [currentLineup, config.slots, removedSlots, manualReplacements]);

  const activeLineupPlayers = useMemo(() => {
    if (!lineupSlots) return [];
    return Object.values(lineupSlots).filter(Boolean) as Player[];
  }, [lineupSlots]);

  const totalSalary = activeLineupPlayers.reduce((s, p) => s + p.salary, 0);
  const totalProj = activeLineupPlayers.reduce((s, p) => {
    const base = customProjections[p.id] ?? Number(p.projectedPoints);
    const boostPct = boosts[p.id] || 0;
    return s + (boostPct > 0 ? Math.round((base * (1 + boostPct / 100)) * 10) / 10 : base);
  }, 0);

  const lockedSalary = useMemo(() => {
    if (!players) return 0;
    return players.filter(p => lockedIds.includes(p.id)).reduce((s, p) => s + p.salary, 0);
  }, [players, lockedIds]);

  const handleOptimize = () => {
    const mergedProjections: Record<string, number> = { ...customProjections };
    if (players) {
      for (const p of players) {
        const boostPct = boosts[p.id] || 0;
        if (boostPct > 0) {
          const base = customProjections[p.id] ?? Number(p.projectedPoints);
          mergedProjections[p.id] = Math.round((base * (1 + boostPct / 100)) * 10) / 10;
        }
      }
    }
    optimizeMutation.mutate({
      slateId,
      platform,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      maxSalary: config.salaryCap,
      playerProjections: Object.keys(mergedProjections).length > 0 ? mergedProjections : undefined,
    });
  };

  const handleSave = () => {
    if (!currentLineup?.lineup || !user) return;
    saveLineupMutation.mutate({
      userId: (user as any).id,
      slateId,
      sport,
      platform,
      totalSalary,
      totalProjectedPoints: totalProj.toString(),
      playerIds: activeLineupPlayers.map(p => p.id),
      name: lineupName || `${config.shortLabel} Lineup ${new Date().toLocaleTimeString()}`,
    });
  };

  const handleReset = () => {
    setLockedIds([]);
    setExcludedIds([]);
    setCustomProjections({});
    setRemovedSlots(new Set());
    setReplacingSlot(null);
    setManualReplacements({});
    optimizeMutation.reset();
    setLineupName("");
  };

  const handleRemoveFromSlot = (slot: string) => {
    setRemovedSlots(prev => new Set(prev).add(slot));
    setManualReplacements(prev => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const handleSelectReplacement = (player: Player) => {
    if (!replacingSlot) return;
    setManualReplacements(prev => ({ ...prev, [replacingSlot]: player }));
    setRemovedSlots(prev => {
      const next = new Set(prev);
      next.delete(replacingSlot);
      return next;
    });
    setReplacingSlot(null);
  };

  const remainingSalary = useMemo(() => {
    return config.salaryCap - totalSalary;
  }, [config.salaryCap, totalSalary]);

  const replacementEligiblePlayers = useMemo(() => {
    if (!replacingSlot || !players) return [];
    const lineupPlayerIds = new Set(activeLineupPlayers.map(p => p.id));
    return players.filter(p => {
      if (lineupPlayerIds.has(p.id)) return false;
      if (excludedIds.includes(p.id)) return false;
      if (!positionFitsSlot(p.position, replacingSlot, sport)) return false;
      if (p.salary > remainingSalary) return false;
      return true;
    });
  }, [replacingSlot, players, activeLineupPlayers, excludedIds, sport, remainingSalary]);

  const handleSlateChange = (newSlateId: string) => {
    handleReset();
    setLocation(`/optimizer/${newSlateId}`);
  };

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

  if (isLoading) {
    return (
      <div className="h-[80vh] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const positions = ["ALL", ...(config.positionFilters || ["PG", "SG", "SF", "PF", "C"])];
  const platformColor = platform === "fanduel" ? "blue" : "emerald";

  const sportImages: Record<string, string> = {
    NBA: "/images/sport-nba.png", NHL: "/images/sport-nhl.png",
    MLB: "/images/sport-mlb.png", NFL: "/images/sport-nfl.png",
    GOLF: "/images/sport-golf.png",
  };

  return (
    <div className="flex flex-col xl:flex-row h-[calc(100vh-80px)] overflow-hidden">
      {/* LEFT: Player Pool */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-800">
        {/* Top Bar */}
        <div className="relative border-b border-slate-800 overflow-hidden">
          <div className="absolute inset-0">
            <img
              src={sportImages[sport] || sportImages.NBA}
              alt=""
              className="w-full h-full object-cover opacity-15"
            />
            <div className={`absolute inset-0 bg-gradient-to-r ${platform === "fanduel" ? "from-blue-950/90 via-slate-900/95 to-slate-900" : "from-emerald-950/90 via-slate-900/95 to-slate-900"}`} />
          </div>
          <div className="relative px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Zap className={`w-5 h-5 fill-current ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`} />
              <span className="text-lg font-black text-white tracking-tight">{sport} OPTIMIZER</span>
              <Badge className={`text-[11px] font-black ${platform === "fanduel" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}`} data-testid="platform-badge">
                {config.shortLabel}
              </Badge>
            </div>
            {slate && (
              <div className="flex items-center gap-2" data-testid="slate-date">
                <span className={`text-xs font-black ${platform === "fanduel" ? "text-blue-400/70" : "text-emerald-400/70"}`}>
                  {new Date(slate.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Slate:</span>
              <select
                className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-1.5 font-bold"
                value={slateId}
                onChange={e => handleSlateChange(e.target.value)}
                data-testid="slate-selector"
              >
                {mainSlates.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.platform === "fanduel" ? "FD" : "DK"} - {s.name} — {new Date(s.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Game Scoreboard Cards / Golf Tournament Cards */}
          <div className={`relative z-10 px-4 pb-3 pt-3 border-b bg-slate-950 ${platform === "fanduel" ? "border-blue-500/20" : "border-emerald-500/20"}`}>
            {isGolf && golfAnalysis ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Trophy className="w-4 h-4 text-white" />
                  <span className="text-sm font-black text-white uppercase tracking-widest" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>Tournament Center</span>
                  <Badge className="text-[10px] font-black bg-lime-500/20 text-white border-lime-500/30">LIVE</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pb-2">
                  {/* Tournament Info Card */}
                  <div className="rounded-xl overflow-hidden bg-slate-900 border border-lime-500/30 shadow-lg" data-testid="tournament-info-card">
                    <div className="px-4 py-3 bg-gradient-to-br from-lime-500/20 to-transparent">
                      <div className="flex items-center gap-2 mb-2">
                        <Flag className="w-4 h-4 text-lime-400" />
                        <span className="text-sm font-black text-white drop-shadow-md" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>{golfAnalysis.tournamentName}</span>
                      </div>
                      {golfAnalysis.courseName && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <MapPin className="w-3 h-3 text-lime-400" />
                          <span className="text-xs text-white font-bold" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{golfAnalysis.courseName}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-lime-400" />
                          <span className="text-[11px] font-bold text-white" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{golfAnalysis.fieldSize} Golfers</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3 text-lime-400" />
                          <span className="text-[11px] font-bold text-white" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>Avg ${golfAnalysis.avgSalary.toLocaleString()}</span>
                        </div>
                      </div>
                      {slate && (
                        <div className="mt-2 text-[10px] font-bold text-lime-400 uppercase tracking-wider">
                          {new Date(slate.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top Favorites Card */}
                  <div className="rounded-xl overflow-hidden bg-slate-900 border border-amber-500/30 shadow-lg" data-testid="favorites-card">
                    <div className="px-4 py-3 bg-gradient-to-br from-amber-500/20 to-transparent">
                      <div className="flex items-center gap-2 mb-2.5">
                        <Flame className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-black text-white uppercase tracking-widest" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>Top Favorites</span>
                      </div>
                      <div className="space-y-1.5">
                        {golfAnalysis.favorites.map((p, i) => (
                          <div key={p.id} className="flex items-center justify-between group" data-testid={`favorite-${i}`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black w-4 text-center ${i === 0 ? "text-amber-400" : i === 1 ? "text-white" : "text-slate-300"}`}>
                                {i + 1}
                              </span>
                              <span className="text-xs font-bold text-white group-hover:text-lime-400 transition-colors" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{p.name}</span>
                              <span className="text-[10px] text-slate-300 font-bold">{p.team}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-black text-amber-400 font-mono">{p.odds}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Top Value Picks Card */}
                  <div className="rounded-xl overflow-hidden bg-slate-900 border border-cyan-500/30 shadow-lg" data-testid="value-picks-card">
                    <div className="px-4 py-3 bg-gradient-to-br from-cyan-500/20 to-transparent">
                      <div className="flex items-center gap-2 mb-2.5">
                        <Award className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-black text-white uppercase tracking-widest" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>Value Picks</span>
                      </div>
                      <div className="space-y-1.5">
                        {golfAnalysis.valuePicks.map((p, i) => (
                          <div key={p.id} className="flex items-center justify-between group" data-testid={`value-pick-${i}`}>
                            <div className="flex items-center gap-2">
                              <Star className={`w-3 h-3 ${i === 0 ? "text-cyan-400 fill-cyan-400" : "text-cyan-400/40"}`} />
                              <span className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{p.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-white font-mono" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>${p.salary.toLocaleString()}</span>
                              <span className="text-[11px] font-black text-cyan-400 font-mono">{p.value.toFixed(1)}x</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Activity className={`w-4 h-4 ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`} />
                  <span className="text-xs font-black text-white uppercase tracking-widest">Slate Games</span>
                  <Badge className={`text-[10px] font-black ${platform === "fanduel" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}`}>
                    {games.length}
                  </Badge>
                </div>
                <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-2">
                  {games.map((game, i) => (
                    <div
                      key={i}
                      className={`flex-shrink-0 rounded-xl min-w-[110px] overflow-hidden shadow-lg ${
                        platform === "fanduel"
                          ? "bg-gradient-to-b from-blue-600/25 to-blue-900/40 border border-blue-400/30 shadow-blue-500/10"
                          : "bg-gradient-to-b from-emerald-600/25 to-emerald-900/40 border border-emerald-400/30 shadow-emerald-500/10"
                      }`}
                      data-testid={`game-card-${i}`}
                    >
                      <div className="flex flex-col items-center px-4 py-2.5 gap-1">
                        <span className="text-sm font-black text-white drop-shadow-sm">{game.away}</span>
                        <span className={`text-[10px] font-black ${platform === "fanduel" ? "text-blue-300" : "text-emerald-300"}`}>VS</span>
                        <span className="text-sm font-black text-white drop-shadow-sm">{game.home}</span>
                      </div>
                      <div className={`text-[11px] font-black py-1.5 text-center ${
                        platform === "fanduel"
                          ? "bg-blue-500/30 text-blue-100 border-t border-blue-400/20"
                          : "bg-emerald-500/30 text-emerald-100 border-t border-emerald-400/20"
                      }`}>
                        {game.time}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/20 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search players..."
              className="bg-slate-900 border-slate-700 pl-10 h-9 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="player-search"
            />
          </div>
          <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            {positions.map(pos => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                data-testid={`filter-${pos}`}
                className={`px-3 py-1.5 rounded-md text-[11px] font-black transition-all ${
                  posFilter === pos
                    ? `${platform === "fanduel" ? "bg-blue-500 shadow-blue-500/20" : "bg-emerald-500 shadow-emerald-500/20"} text-white shadow-lg`
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500 font-bold ml-auto">
            {filteredPlayers.length} players
          </div>
        </div>

        {/* Replacement Mode Banner */}
        {replacingSlot && (
          <div className={`px-4 py-2.5 border-b flex items-center justify-between ${
            platform === "fanduel" ? "bg-blue-500/10 border-blue-500/30" : "bg-emerald-500/10 border-emerald-500/30"
          }`} data-testid="replacement-banner">
            <div className="flex items-center gap-2">
              <UserPlus className={`w-4 h-4 ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`} />
              <span className="text-sm font-bold text-white">
                Select a <span className={platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}>{getSlotDisplayName(replacingSlot)}</span> replacement
              </span>
              <Badge className={`text-[11px] font-black ${platform === "fanduel" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}`}>
                Budget: ${remainingSalary.toLocaleString()}
              </Badge>
              <span className="text-[11px] font-bold text-slate-400">
                {replacementEligiblePlayers.length} eligible
              </span>
            </div>
            <button
              onClick={() => setReplacingSlot(null)}
              className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-all"
              data-testid="cancel-replacement"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Player Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
              <tr className="text-slate-400">
                {replacingSlot ? (
                  <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Pick</th>
                ) : (
                  <>
                    <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Lock</th>
                    <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Excl</th>
                  </>
                )}
                <SortHeader label="Pos" field="position" />
                <SortHeader label="Player" field="name" />
                <SortHeader label="Team" field="team" />
                <SortHeader label="Opp" field="team" className="hidden lg:table-cell" />
                <SortHeader label="Salary" field="salary" />
                <SortHeader label="FPPG" field="fppg" />
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">My Proj</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-amber-400 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Rocket className="w-3 h-3" />
                    Boost
                  </div>
                </th>
                <SortHeader label="Value" field="value" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredPlayers.map(player => {
                const isLocked = lockedIds.includes(player.id);
                const isInLineup = activeLineupPlayers.some(p => p.id === player.id);
                const isEligibleReplacement = replacingSlot ? replacementEligiblePlayers.some(p => p.id === player.id) : false;
                const isIneligible = replacingSlot && !isEligibleReplacement && !isInLineup;
                return (
                  <tr
                    key={player.id}
                    className={`group transition-colors ${
                      isIneligible ? "opacity-30" :
                      isEligibleReplacement ? `${platform === "fanduel" ? "hover:bg-blue-500/10 bg-blue-500/5" : "hover:bg-emerald-500/10 bg-emerald-500/5"} cursor-pointer` :
                      `hover:bg-slate-800/30 ${isLocked ? `${platform === "fanduel" ? "bg-blue-500/5" : "bg-emerald-500/5"}` : ""} ${isInLineup ? "bg-slate-800/20" : ""}`
                    }`}
                    data-testid={`player-row-${player.id}`}
                    onClick={isEligibleReplacement ? () => handleSelectReplacement(player) : undefined}
                  >
                    {replacingSlot ? (
                      <td className="px-3 py-2 text-center">
                        {isEligibleReplacement ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectReplacement(player); }}
                            data-testid={`select-replacement-${player.id}`}
                            className={`p-1.5 rounded-md transition-all ${
                              platform === "fanduel"
                                ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white"
                                : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white"
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        ) : isInLineup ? (
                          <span className={`text-[11px] font-black ${platform === "fanduel" ? "text-blue-500" : "text-emerald-500"}`}>IN</span>
                        ) : (
                          <span className="text-slate-600 text-[11px]">--</span>
                        )}
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => {
                              setLockedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                              setExcludedIds(prev => prev.filter(i => i !== player.id));
                            }}
                            data-testid={`lock-${player.id}`}
                            className={`p-1.5 rounded-md transition-all ${
                              isLocked
                                ? `${platform === "fanduel" ? "bg-blue-500" : "bg-emerald-500"} text-white shadow-md`
                                : `text-slate-400 ${platform === "fanduel" ? "hover:text-blue-400" : "hover:text-emerald-400"} hover:bg-slate-800`
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
                      </>
                    )}
                    <td className="px-3 py-2">
                      <span className={`font-mono text-[11px] font-bold ${platform === "fanduel" ? "text-blue-400/80" : "text-emerald-400/80"}`}>{player.position}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className={`font-bold text-sm text-white transition-colors ${platform === "fanduel" ? "group-hover:text-blue-400" : "group-hover:text-emerald-400"}`}>
                        {player.name}
                        {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                          <Badge variant="outline" className={`ml-2 text-[9px] font-bold py-0 px-1.5 ${INJURY_COLORS[player.injuryStatus] || INJURY_COLORS["Day-to-Day"]}`} data-testid={`injury-badge-${player.id}`}>
                            {player.injuryStatus}
                          </Badge>
                        )}
                        {isInLineup && <span className={`ml-2 text-[11px] font-black ${platform === "fanduel" ? "text-blue-500" : "text-emerald-500"}`}>IN LINEUP</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 font-medium">{player.gameInfo}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-400 uppercase">{player.team}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 uppercase hidden lg:table-cell">{player.opponent}</td>
                    <td className="px-3 py-2 font-mono text-sm font-bold text-white">
                      ${player.salary.toLocaleString()}
                      {isEligibleReplacement && (
                        <span className={`block text-[11px] ${platform === "fanduel" ? "text-blue-400/60" : "text-emerald-400/60"}`}>
                          fits budget
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{player.fppg}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-0.5">
                        <Input
                          type="number"
                          step="0.1"
                          className={`w-16 h-7 bg-slate-950 border-slate-800 text-right font-mono font-bold text-xs px-1 ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}
                          defaultValue={player.projectedPoints?.toString()}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) setCustomProjections(prev => ({ ...prev, [player.id]: v }));
                          }}
                          data-testid={`proj-${player.id}`}
                        />
                        {(boosts[player.id] || 0) > 0 && (
                          <span className="text-[10px] font-bold text-amber-400 font-mono" data-testid={`boosted-proj-${player.id}`}>
                            {player.effectiveProj.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {(() => {
                        const boostLevels = [0, 5, 10, 15, 20];
                        const currentBoost = boosts[player.id] || 0;
                        const nextBoost = boostLevels[(boostLevels.indexOf(currentBoost) + 1) % boostLevels.length];
                        return (
                          <button
                            onClick={() => setBoosts(prev => {
                              const updated = { ...prev };
                              if (nextBoost === 0) { delete updated[player.id]; } else { updated[player.id] = nextBoost; }
                              return updated;
                            })}
                            data-testid={`boost-${player.id}`}
                            className={`relative p-1.5 rounded-md transition-all ${
                              currentBoost > 0
                                ? "bg-amber-500/20 text-amber-400 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/30"
                                : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"
                            }`}
                            title={currentBoost > 0 ? `Boosted +${currentBoost}% — click to ${nextBoost > 0 ? `change to +${nextBoost}%` : "remove"}` : "Boost player projection"}
                          >
                            <Rocket className={`w-3.5 h-3.5 ${currentBoost > 0 ? "fill-amber-400" : ""}`} />
                            {currentBoost > 0 && (
                              <span className="absolute -top-1.5 -right-2 text-[9px] font-black text-amber-300 bg-amber-950 rounded px-0.5">
                                +{currentBoost}%
                              </span>
                            )}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-blue-400">
                      {player.value.toFixed(1)}x
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
                className="border-red-500/30 text-red-400 text-[11px] font-bold cursor-pointer hover:bg-red-500/10"
                onClick={() => setExcludedIds(prev => prev.filter(i => i !== p.id))}
                data-testid={`excluded-badge-${p.id}`}
              >
                {p.name} <X className="w-3 h-3 ml-1" />
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: Lineup Builder */}
      <div className="w-full xl:w-[420px] flex flex-col bg-slate-900/30 border-l border-slate-800 overflow-hidden">
        {/* Salary & Projection Bar */}
        <div className="p-4 bg-slate-900/60 border-b border-slate-800">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-800/80 rounded-lg p-3 text-center border border-slate-700/50">
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">Salary Rem.</p>
              <p data-testid="salary-remaining" className={`text-lg font-black ${
                currentLineup ? (config.salaryCap - totalSalary < 0 ? "text-red-400" : "text-white") : "text-slate-400"
              }`}>
                ${currentLineup ? (config.salaryCap - totalSalary).toLocaleString() : config.salaryCap.toLocaleString()}
              </p>
            </div>
            <div className="bg-slate-800/80 rounded-lg p-3 text-center border border-slate-700/50">
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">FP Proj.</p>
              <p data-testid="total-projection" className={`text-lg font-black ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}>
                {currentLineup ? totalProj.toFixed(1) : "0.0"}
              </p>
            </div>
            <div className="bg-slate-800/80 rounded-lg p-3 text-center border border-slate-700/50">
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">Value</p>
              <p data-testid="value-metric" className="text-lg font-black text-blue-400">
                {totalSalary > 0 ? (totalProj / (totalSalary / 1000)).toFixed(1) + "x" : "0.0x"}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleOptimize}
              disabled={optimizeMutation.isPending || slateHasStarted}
              className={`flex-1 h-11 text-white font-black text-sm shadow-lg ${
                platform === "fanduel"
                  ? "bg-blue-500 hover:bg-blue-600 shadow-blue-500/20"
                  : "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20"
              }`}
              data-testid="optimize-btn"
            >
              {optimizeMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Zap className="w-5 h-5 mr-2 fill-current" />
              )}
              OPTIMIZE
            </Button>
            <Button
              onClick={handleReset}
              variant="outline"
              className="h-11 border-slate-700 text-slate-400 hover:text-white"
              data-testid="reset-btn"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Locked/cap info */}
        <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-400">
          <span>${lockedSalary.toLocaleString()} Locked</span>
          <span>{lockedIds.length} / {config.rosterSize} Locked</span>
        </div>

        {/* Subscription badge */}
        {user && subData && (
          <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {subData.tier === "pro" ? (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px] font-black">
                  <Crown className="w-3 h-3 mr-1" /> PRO
                </Badge>
              ) : (
                <Badge variant="outline" className="border-slate-700 text-slate-400 text-[11px] font-black">BASIC</Badge>
              )}
              <span className="text-[11px] text-slate-400 font-bold">
                {subData.tier === "pro" 
                  ? `${subData.lineupCount}/20 lineups saved`
                  : `${subData.sportCounts?.[sport] || 0}/1 ${sport} lineup saved`
                }
              </span>
            </div>
            {subData.tier === "free" && (
              <Link href="/pricing">
                <span className="text-[11px] font-bold text-amber-400 hover:text-amber-300 cursor-pointer" data-testid="upgrade-link">
                  Upgrade
                </span>
              </Link>
            )}
          </div>
        )}

        {/* Lineup Slots */}
        <div className="flex-1 overflow-auto p-4 space-y-2" data-testid="lineup-slots">
          {config.slots.map(slot => {
            const player = lineupSlots?.[slot] || null;
            const displaySlot = getSlotDisplayName(slot);
            return (
              <div
                key={slot}
                className={`flex items-center rounded-lg border transition-all ${
                  player
                    ? `bg-slate-800/60 border-slate-700 ${platform === "fanduel" ? "hover:border-blue-500/30" : "hover:border-emerald-500/30"}`
                    : "bg-slate-900/40 border-slate-800 border-dashed"
                }`}
                data-testid={`slot-${slot}`}
              >
                <div className={`w-12 h-12 flex items-center justify-center font-black text-xs rounded-l-lg ${
                  player
                    ? `${platform === "fanduel" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`
                    : "bg-slate-800/50 text-slate-600"
                }`}>
                  {displaySlot}
                </div>
                {player ? (
                  <div className="flex-1 flex items-center justify-between px-3 py-2">
                    <div>
                      <div className="text-sm font-bold text-white">{player.name}</div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-bold uppercase">
                        <span>{player.team}</span>
                        <span>vs {player.opponent}</span>
                        <span className={`${platform === "fanduel" ? "text-blue-400/60" : "text-emerald-400/60"}`}>{player.position}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className={`text-sm font-black ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}>{Number(player.projectedPoints).toFixed(1)}</div>
                        <div className="text-[11px] font-mono text-slate-400 font-bold">${player.salary.toLocaleString()}</div>
                      </div>
                      <button
                        onClick={() => handleRemoveFromSlot(slot)}
                        className="p-1 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        data-testid={`remove-slot-${slot}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={`flex-1 px-3 py-3 text-left flex items-center gap-2 transition-all rounded-r-lg ${
                      currentLineup?.lineup
                        ? `cursor-pointer ${
                            replacingSlot === slot
                              ? `${platform === "fanduel" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`
                              : `text-slate-400 hover:text-white ${platform === "fanduel" ? "hover:bg-blue-500/5" : "hover:bg-emerald-500/5"}`
                          }`
                        : "cursor-default text-slate-400"
                    }`}
                    onClick={() => {
                      if (currentLineup?.lineup) {
                        setReplacingSlot(replacingSlot === slot ? null : slot);
                      }
                    }}
                    data-testid={`pick-slot-${slot}`}
                  >
                    <Plus className={`w-4 h-4 ${replacingSlot === slot ? (platform === "fanduel" ? "text-blue-400" : "text-emerald-400") : "text-slate-600"}`} />
                    <span className="text-sm font-bold">
                      {replacingSlot === slot ? "Selecting..." : "Make a Pick"}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 space-y-3">
          {currentLineup?.lineup && (
            <>
              {(() => {
                const maxPerSport = subData?.tier === "pro" ? 150 : subData?.tier === "star" ? 20 : 1;
                const sportCount = subData?.sportCounts?.[sport] || 0;
                const atLimit = sportCount >= maxPerSport;
                if (atLimit) {
                  return (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 space-y-2" data-testid="basic-limit-notice">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-sm font-bold text-amber-300">Vault Limit Reached</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {subData?.tier === "free" ? (
                          <>Contender accounts can save 1 team per sport. Upgrade to <span className="font-black text-emerald-400">Sharpshooter ($19.99/mo)</span> for 20 teams or <span className="font-black text-amber-400">Champion ($49.99/mo)</span> for 150 teams per sport, plus CSV export to DraftKings.</>
                        ) : subData?.tier === "star" ? (
                          <>Sharpshooter accounts can save 20 teams per sport. Upgrade to <span className="font-black text-amber-400">Champion ($49.99/mo)</span> for 150 teams per sport with AI boost analysis.</>
                        ) : (
                          <>You've reached the maximum of 150 saved teams for {sport}.</>
                        )}
                      </p>
                      {subData?.tier !== "pro" && (
                        <Link href="/pricing">
                          <Button className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-black font-bold text-sm mt-1" data-testid="upgrade-from-save">
                            <Crown className="w-4 h-4 mr-2" />
                            View Plans
                          </Button>
                        </Link>
                      )}
                    </div>
                  );
                }
                return (
                  <>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Lineup name (optional)"
                        className="bg-slate-800 border-slate-700 text-sm h-9"
                        value={lineupName}
                        onChange={e => setLineupName(e.target.value)}
                        data-testid="lineup-name-input"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSave}
                        disabled={saveLineupMutation.isPending || !user}
                        className={`flex-1 h-10 text-white font-bold text-sm ${
                          platform === "fanduel"
                            ? "bg-blue-600 hover:bg-blue-700"
                            : "bg-blue-600 hover:bg-blue-700"
                        }`}
                        data-testid="save-lineup-btn"
                      >
                        {saveLineupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Heart className="w-4 h-4 mr-2" />}
                        Save Lineup
                      </Button>
                    </div>
                  </>
                );
              })()}
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-lg p-3 ${totalSalary > config.salaryCap ? "bg-red-500/10 border border-red-500/30" : "bg-slate-800/80 border border-slate-700/50"}`}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Salary</div>
              <div className={`text-lg font-black tabular-nums ${totalSalary > config.salaryCap ? "text-red-400" : "text-white"}`}>
                ${totalSalary.toLocaleString()}
              </div>
              <div className="w-full bg-slate-700/50 rounded-full h-1.5 mt-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${totalSalary > config.salaryCap ? "bg-red-500" : platform === "fanduel" ? "bg-blue-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min((totalSalary / config.salaryCap) * 100, 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-500 font-bold mt-1">${config.salaryCap.toLocaleString()} cap</div>
            </div>
            <div className="rounded-lg bg-slate-800/80 border border-slate-700/50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Projected</div>
              <div className={`text-lg font-black tabular-nums ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}>
                {totalProj.toFixed(1)}
              </div>
              <div className="text-[10px] text-slate-500 font-bold mt-2.5">Fantasy Points</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
