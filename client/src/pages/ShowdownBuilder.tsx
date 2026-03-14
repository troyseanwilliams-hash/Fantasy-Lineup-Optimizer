import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Swords, Crown, Lock, X, Search, Download, Save, ChevronLeft, ChevronRight, RefreshCw, Zap, Target, Sliders, ChevronDown, ChevronUp, DollarSign, BarChart3, Shuffle } from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { Slate, Player } from "@shared/schema";

function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

type ShowdownPlayer = Player & { effectiveSalary?: number; effectiveProjection?: number; isCaptain?: boolean };

interface ShowdownLineup {
  captain: ShowdownPlayer;
  flexPlayers: ShowdownPlayer[];
  totalSalary: number;
  totalProjectedPoints: number;
  key: string;
}

interface ShowdownConfig {
  captainLabel: string;
  flexLabel: string;
  captainMultiplier: number;
  salaryCap: number;
  rosterSize: number;
}

const SHOWDOWN_SPORTS = ["NBA", "NFL"];

export default function ShowdownBuilder() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [sport, setSport] = useState("NBA");
  const [platform] = useState<"draftkings" | "fanduel">("draftkings");
  const [selectedSlateId, setSelectedSlateId] = useState<number | null>(null);
  const [gameFilter, setGameFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");

  const [captainId, setCaptainId] = useState<number | null>(null);
  const [lockedFlexIds, setLockedFlexIds] = useState<number[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [lineupCount, setLineupCount] = useState(1);

  const [generatedLineups, setGeneratedLineups] = useState<ShowdownLineup[]>([]);
  const [showdownConfig, setShowdownConfig] = useState<ShowdownConfig | null>(null);
  const [activeLineupIdx, setActiveLineupIdx] = useState(0);
  const [savedLineupIndices, setSavedLineupIndices] = useState<Set<number>>(new Set());

  // ── Config options ────────────────────────────────────────────────────────
  const [projectionMode, setProjectionMode] = useState<"balanced" | "ceiling">("balanced");
  const [leverageMode, setLeverageMode] = useState(false);
  const [useBoosts, setUseBoosts] = useState(false);
  const [globalMaxExposure, setGlobalMaxExposure] = useState<number | null>(null);
  const [salaryRange, setSalaryRange] = useState<[number, number] | null>(null);
  const [customProjections, setCustomProjections] = useState<Record<string, number>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [sortKey, setSortKey] = useState<"proj" | "salary" | "value" | "name">("proj");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: subscription } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });
  const userIsAdmin = (user as any)?.isAdmin === true;
  const tier = subscription?.tier || "free";
  const maxLineups = userIsAdmin ? 20 : tier === "pro" ? 20 : tier === "star" ? 5 : 1;
  const isPaidUser = userIsAdmin || tier === "pro" || tier === "star";

  const { data: slates, isLoading: slatesLoading } = useQuery<Slate[]>({
    queryKey: ["/api/showdown/slates", sport],
    queryFn: async () => {
      const res = await fetch(`/api/showdown/slates?sport=${sport}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch slates");
      const data = await res.json();
      if (data.length > 0 && !selectedSlateId) {
        const main = data.find((s: Slate) => s.isMain) || data[data.length - 1];
        setSelectedSlateId(main.id);
      }
      return data;
    },
  });

  const { data: playerData, isLoading: playersLoading } = useQuery<{ slate: any; games: Record<string, Player[]>; players: Player[] }>({
    queryKey: ["/api/showdown/players", selectedSlateId],
    queryFn: async () => {
      const res = await fetch(`/api/showdown/players/${selectedSlateId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch players");
      return res.json();
    },
    enabled: !!selectedSlateId,
  });

  const optimizeMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/showdown/optimize", {
        slateId: selectedSlateId,
        platform,
        sport,
        lockedCaptainId: captainId || undefined,
        lockedFlexIds,
        excludedPlayerIds: excludedIds,
        lineupCount: Math.min(lineupCount, maxLineups),
        gameFilter: gameFilter || undefined,
        projectionMode,
        leverageMode,
        useBoosts,
        globalMaxExposure: globalMaxExposure ?? undefined,
        playerProjections: Object.keys(customProjections).length > 0 ? customProjections : undefined,
        playerMinSalary: salaryRange?.[0] ?? undefined,
        playerMaxSalary: salaryRange?.[1] ?? undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedLineups(data.lineups);
      setShowdownConfig(data.config);
      setActiveLineupIdx(0);
      setSavedLineupIndices(new Set());
      toast({ title: `${data.lineups.length} lineup${data.lineups.length > 1 ? "s" : ""} generated!` });
    },
    onError: (err: any) => {
      toast({ title: "Optimization failed", description: err.message || "Could not generate lineups", variant: "destructive" });
    },
  });

  const saveMut = useMutation({
    mutationFn: async (lineup: ShowdownLineup) => {
      const snapshot = [
        { ...lineup.captain, slot: showdownConfig?.captainLabel || "CPT" },
        ...lineup.flexPlayers.map((p, i) => ({ ...p, slot: `${showdownConfig?.flexLabel || "FLEX"}${i + 1}` })),
      ];
      const res = await apiRequest("POST", "/api/showdown/save", {
        slateId: selectedSlateId,
        sport,
        platform,
        captainId: lineup.captain.id,
        flexIds: lineup.flexPlayers.map(p => p.id),
        totalSalary: lineup.totalSalary,
        totalProjectedPoints: lineup.totalProjectedPoints,
        playerSnapshot: snapshot,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
      setSavedLineupIndices(prev => new Set(prev).add(activeLineupIdx));
      toast({ title: "Lineup saved to vault!" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message || "Could not save lineup", variant: "destructive" });
    },
  });

  const players = playerData?.players || [];
  const games = playerData?.games || {};
  const gameKeys = Object.keys(games);

  const salaryBounds = useMemo(() => {
    const pool = gameFilter ? players.filter(p => p.gameInfo === gameFilter) : players;
    if (pool.length === 0) return { min: 3000, max: 11000, step: 100 };
    const sals = pool.map(p => p.salary).filter(s => !isNaN(s));
    return { min: Math.min(...sals), max: Math.max(...sals), step: 100 };
  }, [players, gameFilter]);

  useEffect(() => { setSalaryRange(null); }, [selectedSlateId, gameFilter]);

  const teams = useMemo(() => {
    const t = new Set(players.map(p => p.team));
    return ["ALL", ...Array.from(t).sort()];
  }, [players]);

  const positions = useMemo(() => {
    const p = new Set(players.flatMap(p => p.position.split("/")));
    return ["ALL", ...Array.from(p).sort()];
  }, [players]);

  const filteredPlayers = useMemo(() => {
    let pool = players;
    if (gameFilter) pool = pool.filter(p => p.gameInfo === gameFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      pool = pool.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
    }
    if (posFilter !== "ALL") pool = pool.filter(p => p.position.split("/").includes(posFilter));
    if (teamFilter !== "ALL") pool = pool.filter(p => p.team === teamFilter);
    if (salaryRange) pool = pool.filter(p => p.salary >= salaryRange[0] && p.salary <= salaryRange[1]);
    return pool
      .map(p => ({
        ...p,
        _effProj: customProjections[p.id] ?? toNum(p.projectedPoints),
        _value: (customProjections[p.id] ?? toNum(p.projectedPoints)) / Math.max(p.salary / 1000, 0.1),
      }))
      .sort((a, b) => {
        if (sortKey === "salary") return sortDir === "asc" ? a.salary - b.salary : b.salary - a.salary;
        if (sortKey === "value")  return sortDir === "asc" ? a._value - b._value : b._value - a._value;
        if (sortKey === "name")   return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        return sortDir === "asc" ? a._effProj - b._effProj : b._effProj - a._effProj;
      });
  }, [players, gameFilter, searchTerm, posFilter, teamFilter, salaryRange, customProjections, sortKey, sortDir]);

  const captainMultiplier = showdownConfig?.captainMultiplier || (platform === "fanduel" ? 2.0 : 1.5);
  const salaryMultiplier = platform === "fanduel" ? 1.0 : 1.5;
  const captainLabel = showdownConfig?.captainLabel || (platform === "fanduel" ? "MVP" : "CPT");
  const flexLabel = showdownConfig?.flexLabel || "FLEX";

  const activeLineup = generatedLineups[activeLineupIdx];

  function toggleCaptain(playerId: number) {
    if (captainId === playerId) {
      setCaptainId(null);
    } else {
      setCaptainId(playerId);
      setLockedFlexIds(prev => prev.filter(id => id !== playerId));
    }
  }

  function toggleFlex(playerId: number) {
    if (lockedFlexIds.includes(playerId)) {
      setLockedFlexIds(prev => prev.filter(id => id !== playerId));
    } else {
      if (captainId === playerId) setCaptainId(null);
      setLockedFlexIds(prev => [...prev, playerId]);
    }
  }

  function toggleExclude(playerId: number) {
    if (excludedIds.includes(playerId)) {
      setExcludedIds(prev => prev.filter(id => id !== playerId));
    } else {
      setExcludedIds(prev => [...prev, playerId]);
      if (captainId === playerId) setCaptainId(null);
      setLockedFlexIds(prev => prev.filter(id => id !== playerId));
    }
  }

  function exportCSV() {
    if (!activeLineup) return;
    const header = [captainLabel, ...Array.from({ length: activeLineup.flexPlayers.length }, (_, i) => `${flexLabel}`)].join(",");
    const row = [activeLineup.captain.name, ...activeLineup.flexPlayers.map(p => p.name)].join(",");
    const csv = `${header}\n${row}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `showdown_${sport}_lineup.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="showdown-login-required">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <Swords className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sign In Required</h2>
            <p className="text-slate-400">Log in to access the Showdown Builder.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2" data-testid="showdown-title">
              <Swords className="w-6 h-6 text-amber-500" />
              Showdown Builder
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">{captainLabel} scores {captainMultiplier}x &middot; Single-game lineups</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {SHOWDOWN_SPORTS.map(s => (
              <Button
                key={s}
                variant={sport === s ? "default" : "outline"}
                size="sm"
                onClick={() => { setSport(s); setSelectedSlateId(null); setGeneratedLineups([]); setCaptainId(null); setLockedFlexIds([]); setExcludedIds([]); setGameFilter(""); }}
                className={sport === s ? "bg-amber-600 hover:bg-amber-700 h-8" : "border-slate-600 text-slate-300 h-8"}
                data-testid={`showdown-sport-${s.toLowerCase()}`}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <Select
            value={selectedSlateId?.toString() || ""}
            onValueChange={(v) => { setSelectedSlateId(Number(v)); setGeneratedLineups([]); setCaptainId(null); setLockedFlexIds([]); setExcludedIds([]); setGameFilter(""); }}
          >
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white sm:max-w-xs" data-testid="select-slate">
              <SelectValue placeholder={slatesLoading ? "Loading slates..." : "Select a slate"} />
            </SelectTrigger>
            <SelectContent>
              {(slates || []).map(s => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  {s.sport} - {new Date(s.startTime).toLocaleDateString()} {new Date(s.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {gameKeys.length > 0 && (
            <Select value={gameFilter || "all"} onValueChange={v => setGameFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white sm:max-w-xs" data-testid="select-game">
                <SelectValue placeholder="All games" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Games</SelectItem>
                {gameKeys.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={lineupCount.toString()} onValueChange={v => setLineupCount(Number(v))}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-28" data-testid="select-lineup-count">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 3, 5, 10, 20].map(n => (
                <SelectItem key={n} value={n.toString()}>{n} lineup{n > 1 ? "s" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!selectedSlateId ? (
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-12 text-center" data-testid="showdown-select-slate">
              <Swords className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Select a Slate</h3>
              <p className="text-slate-400">Choose a {sport} slate above to start building showdown lineups.</p>
            </CardContent>
          </Card>
        ) : playersLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <Card className="bg-slate-900 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white text-base">Player Pool ({filteredPlayers.length})</CardTitle>
                    <div className="flex gap-1.5">
                      <div className="flex items-center gap-1 text-[10px] text-amber-400"><Crown className="w-3 h-3" /> {captainLabel}</div>
                      <div className="flex items-center gap-1 text-[10px] text-blue-400"><Lock className="w-3 h-3" /> {flexLabel}</div>
                      <div className="flex items-center gap-1 text-[10px] text-red-400"><X className="w-3 h-3" /> Exclude</div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <div className="relative flex-1 min-w-[140px]">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                      <Input
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="bg-slate-800 border-slate-600 text-white pl-8 h-8 text-xs"
                        data-testid="search-players"
                      />
                    </div>
                    <Select value={posFilter} onValueChange={setPosFilter}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-20 h-8 text-xs" data-testid="filter-position">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {positions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={teamFilter} onValueChange={setTeamFilter}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-20 h-8 text-xs" data-testid="filter-team">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {teams.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[55vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-800 z-10">
                        <tr className="text-slate-400 uppercase text-[10px]">
                          <th className="text-left px-2 py-2 w-8"></th>
                          <th onClick={() => { setSortKey("name"); setSortDir(d => d === "asc" ? "desc" : "asc"); }} className="text-left px-1 py-2 cursor-pointer hover:text-white select-none">
                            Player {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th className="text-left px-1 py-2">Pos</th>
                          <th className="text-left px-1 py-2 hidden sm:table-cell">Team</th>
                          <th onClick={() => { setSortKey("salary"); setSortDir(d => d === "asc" ? "desc" : "asc"); }} className="text-right px-1 py-2 cursor-pointer hover:text-white select-none">
                            Sal {sortKey === "salary" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th className="text-right px-1 py-2 text-amber-400">{captainLabel} $</th>
                          <th onClick={() => { setSortKey("proj"); setSortDir(d => d === "asc" ? "desc" : "asc"); }} className="text-right px-1 py-2 cursor-pointer hover:text-white select-none">
                            Proj {sortKey === "proj" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th className="text-right px-1 py-2 text-amber-400">{captainLabel}</th>
                          <th onClick={() => { setSortKey("value"); setSortDir(d => d === "asc" ? "desc" : "asc"); }} className="text-right px-1 py-2 cursor-pointer hover:text-white select-none hidden sm:table-cell" title="Pts/$1K">
                            Val {sortKey === "value" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th className="text-center px-1 py-2 w-20">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPlayers.map(player => {
                          const isCpt = captainId === player.id;
                          const isFlex = lockedFlexIds.includes(player.id);
                          const isExcl = excludedIds.includes(player.id);
                          const cptSal = Math.round(player.salary * salaryMultiplier);
                          const cptProj = Math.round(toNum(player.projectedPoints) * captainMultiplier * 100) / 100;

                          return (
                            <tr
                              key={player.id}
                              className={`border-t border-slate-800 transition-colors ${
                                isExcl ? "opacity-40" : isCpt ? "bg-amber-500/10" : isFlex ? "bg-blue-500/10" : "hover:bg-slate-800/50"
                              }`}
                              data-testid={`player-row-${player.id}`}
                            >
                              <td className="px-2 py-1.5">
                                {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                                  <Badge variant="outline" className="border-red-500/30 text-red-400 text-[9px] px-1">
                                    {player.injuryStatus === "Probable" ? "P" : player.injuryStatus === "Questionable" ? "Q" : player.injuryStatus === "Doubtful" ? "D" : "O"}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-1 py-1.5 text-white font-medium truncate max-w-[120px] sm:max-w-[160px]">{player.name}</td>
                              <td className="px-1 py-1.5 text-slate-400">{player.position}</td>
                              <td className="px-1 py-1.5 text-slate-400 hidden sm:table-cell">{player.team}</td>
                              <td className="px-1 py-1.5 text-slate-300 text-right">${player.salary.toLocaleString()}</td>
                              <td className="px-1 py-1.5 text-amber-400 text-right font-medium">${cptSal.toLocaleString()}</td>
                              <td className="px-1 py-1.5 text-right">
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={customProjections[player.id] !== undefined ? customProjections[player.id] : toNum(player.projectedPoints).toFixed(1)}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val) && val >= 0) setCustomProjections(prev => ({ ...prev, [player.id]: val }));
                                    else if (e.target.value === "") setCustomProjections(prev => { const n = { ...prev }; delete n[player.id]; return n; });
                                  }}
                                  className={`w-12 text-right bg-transparent border-0 focus:outline-none focus:bg-slate-700/60 focus:rounded px-0.5 text-xs tabular-nums ${customProjections[player.id] !== undefined ? "text-purple-400 font-bold" : "text-slate-300"}`}
                                  title="Click to override projection"
                                  data-testid={`custom-proj-${player.id}`}
                                />
                              </td>
                              <td className="px-1 py-1.5 text-amber-400 text-right font-bold">{cptProj.toFixed(1)}</td>
                              <td className="px-1 py-1.5 text-right hidden sm:table-cell">
                                <span className={`text-[10px] font-bold tabular-nums ${(player as any)._value >= 5 ? "text-emerald-400" : (player as any)._value >= 3.5 ? "text-slate-300" : "text-slate-500"}`}>
                                  {((player as any)._value ?? 0).toFixed(1)}x
                                </span>
                              </td>
                              <td className="px-1 py-1.5">
                                <div className="flex items-center justify-center gap-0.5">
                                  <button
                                    onClick={() => toggleCaptain(player.id)}
                                    className={`p-1 rounded transition-colors ${isCpt ? "bg-amber-500/30 text-amber-400" : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"}`}
                                    title={`Lock as ${captainLabel}`}
                                    data-testid={`lock-captain-${player.id}`}
                                  >
                                    <Crown className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => toggleFlex(player.id)}
                                    className={`p-1 rounded transition-colors ${isFlex ? "bg-blue-500/30 text-blue-400" : "text-slate-500 hover:text-blue-400 hover:bg-blue-500/10"}`}
                                    title={`Lock as ${flexLabel}`}
                                    data-testid={`lock-flex-${player.id}`}
                                  >
                                    <Lock className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => toggleExclude(player.id)}
                                    className={`p-1 rounded transition-colors ${isExcl ? "bg-red-500/30 text-red-400" : "text-slate-500 hover:text-red-400 hover:bg-red-500/10"}`}
                                    title="Exclude"
                                    data-testid={`exclude-${player.id}`}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* ── Optimizer Config Panel ── */}
              <Card className="bg-slate-900/60 border-slate-700/50 mt-3">
                <CardContent className="p-3">
                  {/* Collapsible header */}
                  <button
                    onClick={() => setShowConfig(c => !c)}
                    className="w-full flex items-center justify-between text-sm font-bold text-slate-300 hover:text-white transition-colors"
                    data-testid="toggle-config"
                  >
                    <div className="flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-amber-400/70" />
                      <span className="text-xs">Optimizer Settings</span>
                      {(projectionMode !== "balanced" || leverageMode || useBoosts || globalMaxExposure || salaryRange || Object.keys(customProjections).length > 0) && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      )}
                    </div>
                    {showConfig ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                  </button>

                  {showConfig && (
                    <div className="space-y-4 mt-3 pt-3 border-t border-slate-800/60">

                      {/* Projection Mode */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <BarChart3 className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Projection Mode</span>
                        </div>
                        <div className="flex gap-1.5">
                          {(["balanced", "ceiling"] as const).map(mode => (
                            <button
                              key={mode}
                              onClick={() => setProjectionMode(mode)}
                              data-testid={`projection-mode-${mode}`}
                              className={`flex-1 py-1.5 rounded-lg text-[11px] font-black transition-all border ${
                                projectionMode === mode
                                  ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                  : "bg-slate-800/60 text-slate-400 border-slate-700/40 hover:text-white"
                              }`}
                            >
                              {mode === "balanced" ? "⚖️ Balanced" : "🚀 Ceiling"}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                          {projectionMode === "ceiling" ? "High-upside GPP — targets boom-or-bust plays" : "Safer floor — better for cash games"}
                        </p>
                      </div>

                      {/* Toggles */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between bg-slate-800/40 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Target className="w-3.5 h-3.5 text-amber-400" />
                            <div>
                              <p className="text-xs font-bold text-white">Leverage Mode</p>
                              <p className="text-[10px] text-slate-500">Down-weights chalk, boosts low-ownership plays</p>
                            </div>
                          </div>
                          <Switch checked={leverageMode} onCheckedChange={setLeverageMode} data-testid="toggle-leverage" />
                        </div>

                        <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${isPaidUser ? "bg-slate-800/40" : "bg-slate-800/20 opacity-60"}`}>
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-emerald-400" />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-bold text-white">AI Boosts</p>
                                {!isPaidUser && <span className="text-[9px] font-black text-amber-400/80 bg-amber-500/10 px-1 py-0.5 rounded">PRO</span>}
                              </div>
                              <p className="text-[10px] text-slate-500">Historical pattern adjustments on projections</p>
                            </div>
                          </div>
                          <Switch checked={useBoosts} onCheckedChange={isPaidUser ? setUseBoosts : undefined} disabled={!isPaidUser} data-testid="toggle-boosts" />
                        </div>
                      </div>

                      {/* Salary Range */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <DollarSign className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Player Salary Range</span>
                          </div>
                          {salaryRange && (
                            <button onClick={() => setSalaryRange(null)} className="text-[10px] text-slate-500 hover:text-slate-300" data-testid="reset-salary-range">
                              Reset
                            </button>
                          )}
                        </div>
                        <Slider
                          value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                          onValueChange={v => setSalaryRange([v[0], v[1]])}
                          min={salaryBounds.min}
                          max={salaryBounds.max}
                          step={salaryBounds.step}
                          data-testid="salary-range-slider"
                        />
                        <div className="flex justify-between mt-1 text-[10px] font-bold">
                          <span className={salaryRange ? "text-emerald-400" : "text-slate-500"}>${((salaryRange?.[0] ?? salaryBounds.min) / 1000).toFixed(1)}K</span>
                          <span className={salaryRange ? "text-emerald-400" : "text-slate-500"}>${((salaryRange?.[1] ?? salaryBounds.max) / 1000).toFixed(1)}K</span>
                        </div>
                      </div>

                      {/* Max Exposure — only visible for multi-lineup */}
                      {lineupCount > 1 && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Shuffle className="w-3.5 h-3.5 text-slate-500" />
                              <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Max Player Exposure</span>
                            </div>
                            <span className={`text-[11px] font-black ${globalMaxExposure ? "text-cyan-400" : "text-slate-500"}`}>
                              {globalMaxExposure ? `${globalMaxExposure}%` : "Off"}
                            </span>
                          </div>
                          <Slider
                            value={[globalMaxExposure ?? 100]}
                            onValueChange={v => setGlobalMaxExposure(v[0] === 100 ? null : v[0])}
                            min={10} max={100} step={5}
                            data-testid="exposure-slider"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            {globalMaxExposure ? `No player appears in more than ${globalMaxExposure}% of lineups` : "Drag left to cap player frequency across lineups"}
                          </p>
                        </div>
                      )}

                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Active config chips */}
              {(projectionMode !== "balanced" || leverageMode || useBoosts || globalMaxExposure || salaryRange || Object.keys(customProjections).length > 0) && (
                <div className="flex flex-wrap gap-1.5 mt-2" data-testid="active-config-chips">
                  {projectionMode === "ceiling" && <span className="text-[10px] font-black bg-purple-500/15 border border-purple-500/25 text-purple-300 px-2 py-1 rounded-lg">🚀 Ceiling</span>}
                  {leverageMode && <span className="text-[10px] font-black bg-amber-500/15 border border-amber-500/25 text-amber-300 px-2 py-1 rounded-lg flex items-center gap-1"><Target className="w-3 h-3" />Leverage</span>}
                  {useBoosts && <span className="text-[10px] font-black bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 px-2 py-1 rounded-lg flex items-center gap-1"><Zap className="w-3 h-3" />AI Boosts</span>}
                  {globalMaxExposure && <span className="text-[10px] font-black bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 px-2 py-1 rounded-lg flex items-center gap-1"><Shuffle className="w-3 h-3" />Max {globalMaxExposure}%</span>}
                  {salaryRange && <span className="text-[10px] font-black bg-slate-700/60 border border-slate-600/40 text-slate-300 px-2 py-1 rounded-lg flex items-center gap-1"><DollarSign className="w-3 h-3" />${(salaryRange[0]/1000).toFixed(1)}K–${(salaryRange[1]/1000).toFixed(1)}K</span>}
                  {Object.keys(customProjections).length > 0 && <span className="text-[10px] font-black bg-purple-500/15 border border-purple-500/25 text-purple-300 px-2 py-1 rounded-lg">✏️ {Object.keys(customProjections).length} custom</span>}
                </div>
              )}

              <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button
                  onClick={() => optimizeMut.mutate()}
                  disabled={optimizeMut.isPending}
                  className="bg-amber-600 hover:bg-amber-700 font-bold flex-1 sm:flex-none"
                  data-testid="btn-optimize-showdown"
                >
                  {optimizeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Swords className="w-4 h-4 mr-2" />}
                  Generate {lineupCount > 1 ? `${lineupCount} Lineups` : "Lineup"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setCaptainId(null); setLockedFlexIds([]); setExcludedIds([]); setCustomProjections({}); setSalaryRange(null); setProjectionMode("balanced"); setLeverageMode(false); setUseBoosts(false); setGlobalMaxExposure(null); }}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800"
                  data-testid="btn-clear-locks"
                >
                  <RefreshCw className="w-4 h-4 mr-1" /> Reset All
                </Button>
              </div>
            </div>

            <div className="lg:col-span-2">
              {generatedLineups.length > 0 && activeLineup ? (
                <Card className="bg-slate-900 border-slate-700" data-testid="showdown-lineup-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white text-base">
                        Generated Lineup{generatedLineups.length > 1 ? "s" : ""}
                      </CardTitle>
                      {generatedLineups.length > 1 && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveLineupIdx(Math.max(0, activeLineupIdx - 1))}
                            disabled={activeLineupIdx === 0}
                            className="h-7 w-7 p-0 text-slate-400"
                            data-testid="btn-prev-lineup"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <span className="text-xs text-slate-400 font-bold" data-testid="lineup-counter">
                            {activeLineupIdx + 1} / {generatedLineups.length}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveLineupIdx(Math.min(generatedLineups.length - 1, activeLineupIdx + 1))}
                            disabled={activeLineupIdx === generatedLineups.length - 1}
                            className="h-7 w-7 p-0 text-slate-400"
                            data-testid="btn-next-lineup"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {generatedLineups.length > 1 && (() => {
                      const apps: Record<number, { name: string; count: number }> = {};
                      for (const lu of generatedLineups) {
                        for (const p of [lu.captain, ...lu.flexPlayers]) {
                          if (!apps[p.id]) apps[p.id] = { name: p.name, count: 0 };
                          apps[p.id].count++;
                        }
                      }
                      return (
                        <div className="bg-slate-800/40 rounded-lg p-2.5" data-testid="exposure-panel">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Exposure — {generatedLineups.length} lineups</p>
                          <div className="space-y-1.5">
                            {Object.entries(apps).sort(([,a],[,b]) => b.count - a.count).slice(0, 6).map(([id, d]) => {
                              const pct = Math.round((d.count / generatedLineups.length) * 100);
                              const over = globalMaxExposure !== null && pct > globalMaxExposure;
                              return (
                                <div key={id} className="flex items-center gap-2">
                                  <span className="text-[10px] text-white font-bold flex-1 truncate">{d.name}</span>
                                  <span className="text-[10px] font-mono text-slate-500">{d.count}/{generatedLineups.length}</span>
                                  <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${over ? "bg-red-400" : "bg-cyan-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                                  </div>
                                  <span className={`text-[10px] font-black w-8 text-right ${over ? "text-red-400" : "text-cyan-400"}`}>{pct}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-3" data-testid="captain-slot">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[10px] font-black">
                          {captainLabel}
                        </Badge>
                        <Badge variant="outline" className="border-amber-500/30 text-amber-300 text-[10px]">
                          {captainMultiplier}x
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-white font-bold text-sm" data-testid="captain-name">{activeLineup.captain.name}</div>
                          <div className="text-slate-400 text-xs">{activeLineup.captain.position} &middot; {activeLineup.captain.team}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-amber-400 font-black text-sm" data-testid="captain-proj">
                            {toNum(activeLineup.captain.effectiveProjection).toFixed(1)} pts
                          </div>
                          <div className="text-slate-400 text-xs">${toNum(activeLineup.captain.effectiveSalary).toLocaleString()}</div>
                        </div>
                      </div>
                    </div>

                    {activeLineup.flexPlayers.map((player, i) => (
                      <div key={player.id} className="rounded-lg border border-slate-700 bg-slate-800/40 p-3" data-testid={`flex-slot-${i}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="border-slate-600 text-slate-400 text-[10px]">
                                {flexLabel}
                              </Badge>
                              <span className="text-white font-medium text-sm">{player.name}</span>
                            </div>
                            <div className="text-slate-400 text-xs mt-0.5">{player.position} &middot; {player.team}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-emerald-400 font-bold text-sm">{toNum(player.effectiveProjection).toFixed(1)} pts</div>
                            <div className="text-slate-400 text-xs">${toNum(player.effectiveSalary).toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    ))}

                    <div className="border-t border-slate-700 pt-3 mt-3">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <div className="text-lg font-black text-amber-400" data-testid="lineup-total-proj">
                            {activeLineup.totalProjectedPoints.toFixed(1)}
                          </div>
                          <div className="text-[10px] text-slate-400 uppercase">Projected</div>
                        </div>
                        <div>
                          <div className={`text-lg font-black ${activeLineup.totalSalary > (showdownConfig?.salaryCap || 50000) ? "text-red-400" : "text-white"}`} data-testid="lineup-total-salary">
                            ${activeLineup.totalSalary.toLocaleString()}
                          </div>
                          <div className="text-[10px] text-slate-400 uppercase">Salary</div>
                        </div>
                        <div>
                          <div className="text-lg font-black text-slate-300" data-testid="lineup-salary-remaining">
                            ${((showdownConfig?.salaryCap || 50000) - activeLineup.totalSalary).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-slate-400 uppercase">Remaining</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        onClick={() => saveMut.mutate(activeLineup)}
                        disabled={saveMut.isPending || savedLineupIndices.has(activeLineupIdx)}
                        className={`flex-1 font-bold ${savedLineupIndices.has(activeLineupIdx) ? "bg-emerald-700/30 border border-emerald-500/30 text-emerald-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
                        data-testid="btn-save-showdown"
                      >
                        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : savedLineupIndices.has(activeLineupIdx) ? "✓ Saved" : <><Save className="w-4 h-4 mr-1" />Save</>}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={exportCSV}
                        className="border-slate-600 text-slate-300 hover:bg-slate-800"
                        data-testid="btn-export-csv"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        CSV
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="bg-slate-900 border-slate-700">
                  <CardContent className="p-8 text-center" data-testid="showdown-no-lineup">
                    <Swords className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <h3 className="text-base font-bold text-white mb-1">No Lineup Yet</h3>
                    <p className="text-slate-400 text-sm">Lock a {captainLabel} and/or {flexLabel} players, then hit Generate.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
