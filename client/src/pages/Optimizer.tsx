import { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import type { Player, Slate, OptimizeResponse } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Lock, Unlock, X, Zap, RefreshCw, Save, Search,
  ChevronDown, ChevronUp, ArrowUpDown, Heart, Loader2,
  DollarSign, Target, TrendingUp, RotateCcw
} from "lucide-react";

const DK_NBA_SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"] as const;
type SlotName = typeof DK_NBA_SLOTS[number];
const SALARY_CAP = 50000;

function positionFitsSlot(position: string, slot: SlotName): boolean {
  const positions = position.split("/");
  switch (slot) {
    case "PG": return positions.includes("PG");
    case "SG": return positions.includes("SG");
    case "SF": return positions.includes("SF");
    case "PF": return positions.includes("PF");
    case "C": return positions.includes("C");
    case "G": return positions.includes("PG") || positions.includes("SG");
    case "F": return positions.includes("SF") || positions.includes("PF");
    case "UTIL": return true;
    default: return false;
  }
}

function assignPlayersToSlots(players: Player[]): Record<SlotName, Player | null> {
  const slotOrder: SlotName[] = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];

  function solve(slotIdx: number, used: Set<number>): Record<SlotName, Player | null> | null {
    if (slotIdx >= slotOrder.length) {
      return { PG: null, SG: null, SF: null, PF: null, C: null, G: null, F: null, UTIL: null };
    }
    const slot = slotOrder[slotIdx];
    const eligible = players.filter(p => !used.has(p.id) && positionFitsSlot(p.position, slot));

    const sorted = [...eligible].sort((a, b) => {
      const aSlots = slotOrder.filter(s => s !== slot && positionFitsSlot(a.position, s)).length;
      const bSlots = slotOrder.filter(s => s !== slot && positionFitsSlot(b.position, s)).length;
      return aSlots - bSlots;
    });

    for (const p of sorted) {
      const nextUsed = new Set(used);
      nextUsed.add(p.id);
      const result = solve(slotIdx + 1, nextUsed);
      if (result) {
        result[slot] = p;
        return result;
      }
    }
    return null;
  }

  return solve(0, new Set()) || { PG: null, SG: null, SF: null, PF: null, C: null, G: null, F: null, UTIL: null };
}

type SortKey = "name" | "position" | "team" | "salary" | "projectedPoints" | "fppg" | "value";
type SortDir = "asc" | "desc";

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
  const [sortKey, setSortKey] = useState<SortKey>("projectedPoints");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [activeLineupTab, setActiveLineupTab] = useState(0);
  const [savedLineups, setSavedLineups] = useState<OptimizeResponse[]>([]);
  const [lineupName, setLineupName] = useState("");

  const { data: slates } = useQuery<Slate[]>({ queryKey: ["/api/slates"] });
  const slate = useMemo(() => slates?.find(s => s.id === slateId), [slates, slateId]);

  const playerUrl = buildUrl("/api/slates/:id/players", { id: slateId });
  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [playerUrl],
    enabled: !!slateId,
  });

  const optimizeMutation = useMutation<OptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize", constraints);
      return res.json();
    },
  });

  const saveLineupMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/lineups", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lineup Saved!", description: "Added to your saved lineups." });
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    },
  });

  const games = useMemo(() => {
    if (!players) return [];
    const gameMap = new Map<string, { away: string; home: string; time: string }>();
    players.forEach(p => {
      if (p.gameInfo) {
        const key = p.gameInfo;
        if (!gameMap.has(key)) {
          const parts = p.gameInfo.split(" ");
          const time = parts[parts.length - 1] || "";
          const teams = p.gameInfo.replace(time, "").trim();
          const [away, home] = teams.includes("@")
            ? teams.split(" @ ").map(s => s.trim())
            : teams.includes("vs")
              ? teams.split(" vs ").map(s => s.trim())
              : [p.team, p.opponent || ""];
          gameMap.set(key, { away, home, time });
        }
      }
    });
    return Array.from(gameMap.values());
  }, [players]);

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
        effectiveProj: customProjections[p.id] ?? Number(p.projectedPoints),
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
  }, [players, search, posFilter, excludedIds, customProjections, sortKey, sortDir]);

  const excludedPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter(p => excludedIds.includes(p.id));
  }, [players, excludedIds]);

  const currentLineup = optimizeMutation.data;
  const lineupSlots = useMemo(() => {
    if (!currentLineup?.lineup) return null;
    return assignPlayersToSlots(currentLineup.lineup);
  }, [currentLineup]);

  const lockedSalary = useMemo(() => {
    if (!players) return 0;
    return players.filter(p => lockedIds.includes(p.id)).reduce((s, p) => s + p.salary, 0);
  }, [players, lockedIds]);

  const handleOptimize = () => {
    optimizeMutation.mutate({
      slateId,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      maxSalary: SALARY_CAP,
      playerProjections: Object.keys(customProjections).length > 0 ? customProjections : undefined,
    });
  };

  const handleSave = () => {
    if (!currentLineup?.lineup || !user) return;
    saveLineupMutation.mutate({
      userId: (user as any).id,
      slateId,
      sport: "NBA",
      totalSalary: currentLineup.totalSalary,
      totalProjectedPoints: currentLineup.totalProjectedPoints.toString(),
      playerIds: currentLineup.lineup.map(p => p.id),
      name: lineupName || `Lineup ${new Date().toLocaleTimeString()}`,
    });
  };

  const handleReset = () => {
    setLockedIds([]);
    setExcludedIds([]);
    setCustomProjections({});
    optimizeMutation.reset();
    setLineupName("");
  };

  const SortHeader = ({ label, field, className = "" }: { label: string; field: SortKey; className?: string }) => (
    <th
      className={`px-3 py-3 text-[10px] font-black uppercase tracking-widest cursor-pointer select-none hover:text-slate-300 transition-colors ${className}`}
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

  const positions = ["ALL", "PG", "SG", "SF", "PF", "C"];

  return (
    <div className="flex flex-col xl:flex-row h-[calc(100vh-80px)] overflow-hidden">
      {/* LEFT: Player Pool */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-800">
        {/* Top Bar: Slate + Games */}
        <div className="border-b border-slate-800 bg-slate-900/40">
          <div className="px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-400 fill-emerald-400" />
              <span className="text-lg font-black text-white tracking-tight">NBA OPTIMIZER</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Slate:</span>
              <select
                className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-1.5 font-bold"
                value={slateId}
                onChange={e => setLocation(`/optimizer/${e.target.value}`)}
                data-testid="slate-selector"
              >
                {slates?.filter(s => s.sport === "NBA").map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Game Matchup Cards */}
          <div className="px-4 pb-3 flex gap-2 overflow-x-auto scrollbar-hide">
            {games.map((game, i) => (
              <div
                key={i}
                className="flex-shrink-0 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 flex items-center gap-2 text-xs hover:border-emerald-500/30 transition-colors cursor-default"
                data-testid={`game-card-${i}`}
              >
                <span className="font-black text-white">{game.away}</span>
                <span className="text-slate-500 text-[10px]">@</span>
                <span className="font-black text-white">{game.home}</span>
                <span className="text-[9px] text-slate-500 font-bold ml-1">{game.time}</span>
              </div>
            ))}
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
                    ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
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

        {/* Player Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
              <tr className="text-slate-500">
                <th className="px-3 py-3 w-10 text-center text-[10px] font-black uppercase">Lock</th>
                <th className="px-3 py-3 w-10 text-center text-[10px] font-black uppercase">Excl</th>
                <SortHeader label="Pos" field="position" />
                <SortHeader label="Player" field="name" />
                <SortHeader label="Team" field="team" />
                <SortHeader label="Opp" field="team" className="hidden lg:table-cell" />
                <SortHeader label="Salary" field="salary" />
                <SortHeader label="FPPG" field="fppg" />
                <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">My Proj</th>
                <SortHeader label="Value" field="value" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredPlayers.map(player => {
                const isLocked = lockedIds.includes(player.id);
                return (
                  <tr
                    key={player.id}
                    className={`group transition-colors hover:bg-slate-800/30 ${isLocked ? "bg-emerald-500/5" : ""}`}
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
                          isLocked ? "bg-emerald-500 text-white shadow-md" : "text-slate-600 hover:text-emerald-400 hover:bg-slate-800"
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
                        className="p-1.5 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-[11px] font-bold text-emerald-400/80">{player.position}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-bold text-sm text-white group-hover:text-emerald-400 transition-colors">{player.name}</div>
                      <div className="text-[10px] text-slate-600 font-medium">{player.gameInfo}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-400 uppercase">{player.team}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 uppercase hidden lg:table-cell">{player.opponent}</td>
                    <td className="px-3 py-2 font-mono text-sm font-bold text-white">${player.salary.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{player.fppg}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="0.1"
                        className="w-16 h-7 bg-slate-950 border-slate-800 text-right font-mono font-bold text-emerald-400 text-xs px-1"
                        defaultValue={player.projectedPoints?.toString()}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) setCustomProjections(prev => ({ ...prev, [player.id]: v }));
                        }}
                        data-testid={`proj-${player.id}`}
                      />
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
            <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">Excluded:</span>
            {excludedPlayers.map(p => (
              <Badge
                key={p.id}
                variant="outline"
                className="border-red-500/30 text-red-400 text-[10px] font-bold cursor-pointer hover:bg-red-500/10"
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
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Salary Rem.</p>
              <p className={`text-lg font-black ${
                currentLineup ? (SALARY_CAP - currentLineup.totalSalary < 0 ? "text-red-400" : "text-white") : "text-slate-400"
              }`}>
                ${currentLineup ? (SALARY_CAP - currentLineup.totalSalary).toLocaleString() : SALARY_CAP.toLocaleString()}
              </p>
            </div>
            <div className="bg-slate-800/80 rounded-lg p-3 text-center border border-slate-700/50">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">FP Proj.</p>
              <p className="text-lg font-black text-emerald-400">
                {currentLineup ? currentLineup.totalProjectedPoints.toFixed(1) : "0.0"}
              </p>
            </div>
            <div className="bg-slate-800/80 rounded-lg p-3 text-center border border-slate-700/50">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Value</p>
              <p className="text-lg font-black text-blue-400">
                {currentLineup ? (currentLineup.totalProjectedPoints / (currentLineup.totalSalary / 1000)).toFixed(1) + "x" : "0.0x"}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleOptimize}
              disabled={optimizeMutation.isPending}
              className="flex-1 h-11 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm shadow-lg shadow-emerald-500/20"
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

        {/* Locked players count */}
        <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500">
          <span>${lockedSalary.toLocaleString()} Locked</span>
          <span>{lockedIds.length} / 8 Locked</span>
        </div>

        {/* Lineup Slots */}
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {DK_NBA_SLOTS.map(slot => {
            const player = lineupSlots?.[slot] || null;
            return (
              <div
                key={slot}
                className={`flex items-center rounded-lg border transition-all ${
                  player
                    ? "bg-slate-800/60 border-slate-700 hover:border-emerald-500/30"
                    : "bg-slate-900/40 border-slate-800 border-dashed"
                }`}
                data-testid={`slot-${slot}`}
              >
                <div className={`w-12 h-12 flex items-center justify-center font-black text-xs rounded-l-lg ${
                  player ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800/50 text-slate-600"
                }`}>
                  {slot}
                </div>
                {player ? (
                  <div className="flex-1 flex items-center justify-between px-3 py-2">
                    <div>
                      <div className="text-sm font-bold text-white">{player.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase">
                        <span>{player.team}</span>
                        <span>vs {player.opponent}</span>
                        <span className="text-emerald-400/60">{player.position}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-emerald-400">{Number(player.projectedPoints).toFixed(1)}</div>
                      <div className="text-[10px] font-mono text-slate-500 font-bold">${player.salary.toLocaleString()}</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 px-3 py-3 text-sm text-slate-600 font-medium">
                    Make a Pick
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 space-y-3">
          {currentLineup?.lineup && (
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
                  disabled={saveLineupMutation.isPending}
                  className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm"
                  data-testid="save-lineup-btn"
                >
                  {saveLineupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Heart className="w-4 h-4 mr-2" />}
                  Save Lineup
                </Button>
              </div>
            </>
          )}
          <div className="flex items-center justify-between text-[10px] text-slate-600 font-bold">
            <span>Total: ${currentLineup?.totalSalary?.toLocaleString() || "0"}</span>
            <span>{currentLineup?.totalProjectedPoints?.toFixed(1) || "0.0"} FP</span>
          </div>
        </div>
      </div>
    </div>
  );
}
