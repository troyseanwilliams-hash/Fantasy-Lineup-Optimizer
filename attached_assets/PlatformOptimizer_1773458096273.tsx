// ============================================================
// PlatformOptimizer.tsx
//
// This is the unified optimizer page that handles DraftKings,
// FanDuel, and Yahoo. It wraps the existing optimizer logic
// with platform-awareness:
//
//   1. Platform tab bar (DK / FD / YH) in the header
//   2. Per-platform salary cap, roster slots, and position rules
//      sourced from the extended platform-config.ts
//   3. Salary display — Yahoo uses $10–$50 style, DK/FD use $K
//   4. CSV export — Yahoo export uses Yahoo upload format
//   5. Yahoo-specific slot labels (SP, LW, RW, K)
//   6. Tier gating — FD/YH require paid plan
//
// MOUNTING: Replace or wrap your existing Optimizer route:
//   <Route path="/optimizer/:id" component={PlatformOptimizer} />
//
// All existing DraftKings behavior is preserved unchanged.
// ============================================================

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import type { Player, Slate, OptimizeResponse } from "@shared/schema";
import {
  getPlatformConfig, assignPlayersToSlots, getSlotDisplayName,
  positionFitsSlot, isPlatformSupported, PLATFORM_COLORS,
  type Platform, type Sport,
} from "@shared/platform-config";
import { PlatformSelector } from "@/components/PlatformSelector";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { PlayerInfoHoverCard } from "@/components/PlayerInfoHoverCard";
import { gradeLineup, GRADE_COLORS } from "@/lib/lineup-grader";
import {
  Lock, Unlock, X, Zap, RefreshCw, Save, Search,
  ChevronDown, ChevronUp, ArrowUpDown, Loader2,
  DollarSign, Target, TrendingUp, RotateCcw, Crown,
  Trophy, Star, Download, ArrowLeftRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "name" | "position" | "team" | "salary" | "projectedPoints" | "fppg" | "value";
type SortDir = "asc" | "desc";

const INJURY_COLORS: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/30",
  Doubtful: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Questionable: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Probable: "bg-green-500/20 text-green-400 border-green-500/30",
  "Day-to-Day": "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

// ── Salary formatting ─────────────────────────────────────────────────────────
// Yahoo uses a $200 budget with per-player salaries in the $10–$50 range.
// DK/FD use $50K–$60K caps with per-player salaries in the $3K–$12K range.

function formatSalary(salary: number, platform: Platform): string {
  if (platform === "yahoo") return `$${salary}`;
  return `$${(salary / 1000).toFixed(1)}K`;
}

function formatCap(cap: number, platform: Platform): string {
  if (platform === "yahoo") return `$${cap}`;
  return `$${cap.toLocaleString()}`;
}

// ── CSV export helpers ────────────────────────────────────────────────────────

function buildYahooCSV(
  players: Player[],
  slots: string[],
  sport: string,
): string {
  // Yahoo contest upload format:
  // Slot headers | Player Name (Yahoo Player ID) or just Player Name
  const slotAssignments = assignPlayersToSlots(players, slots, sport);
  const headers = slots.map(s => getSlotDisplayName(s));
  const row = slots.map(slot => {
    const p = slotAssignments[slot];
    return p ? p.name : "";
  });
  return [headers.join(","), row.map(c => `"${c}"`).join(",")].join("\n");
}

function buildFanDuelCSV(
  players: Player[],
  slots: string[],
  sport: string,
): string {
  // FanDuel upload format: Position,Player Name,Player ID (if available)
  const slotAssignments = assignPlayersToSlots(players, slots, sport);
  const headers = slots.map(s => getSlotDisplayName(s));
  const row = slots.map(slot => {
    const p = slotAssignments[slot] as any;
    if (!p) return "";
    // FD uses player IDs in the format "First Last:XXXXXXXX"
    return p.fanDuelPlayerId ? `${p.name}:${p.fanDuelPlayerId}` : p.name;
  });
  return [headers.join(","), row.map(c => `"${c}"`).join(",")].join("\n");
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PlatformOptimizer() {
  const [, params] = useRoute("/optimizer/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const slateId = Number(params?.id);

  // ── State ─────────────────────────────────────────────────────────────────
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
  const [swappingSlot, setSwappingSlot] = useState<string | null>(null);
  const [manualReplacements, setManualReplacements] = useState<Record<string, Player>>({});
  const [salaryRange, setSalaryRange] = useState<[number, number] | null>(null);
  const [mobileView, setMobileView] = useState<"players" | "lineup">("players");
  // Platform is per-session; doesn't persist across slate changes
  const [platform, setPlatform] = useState<Platform>("draftkings");

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: slates } = useQuery<Slate[]>({
    queryKey: ["/api/slates"],
    staleTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
  });

  const slate = useMemo(() => slates?.find(s => s.id === slateId), [slates, slateId]);
  const sport = (slate?.sport || "NBA") as Sport;

  // When slate changes, default platform to draftkings
  useEffect(() => {
    setPlatform("draftkings");
  }, [slateId]);

  const config = useMemo(() => {
    try { return getPlatformConfig(sport, platform); }
    catch { return getPlatformConfig("NBA", "draftkings"); }
  }, [sport, platform]);

  const sportSlates = useMemo(() => slates?.filter(s => s.sport === sport) || [], [slates, sport]);

  const playerUrl = buildUrl("/api/slates/:id/players", { id: slateId });
  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [playerUrl],
    enabled: !!slateId,
    staleTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
  });

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number; sportCounts: Record<string, number> }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
    staleTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });

  const tier = subData?.tier || "free";
  const isPaid = tier === "pro" || tier === "premium" || tier === "star";
  const isAdmin = (user as any)?.isAdmin === true;
  const hasPlatformAccess = isAdmin || platform === "draftkings" || isPaid;

  // ── Salary bounds (platform-aware) ────────────────────────────────────────
  const salaryBounds = useMemo(() => {
    if (!players || players.length === 0) {
      // Yahoo range
      if (platform === "yahoo") return { min: 10, max: 50, step: 1 };
      return { min: 3000, max: 10000, step: 100 };
    }
    const salaries = players.map(p => p.salary).filter(s => !isNaN(s));
    if (salaries.length === 0) return { min: 3000, max: 10000, step: 100 };
    const min = Math.min(...salaries);
    const max = Math.max(...salaries);
    return { min, max, step: platform === "yahoo" ? 1 : 100 };
  }, [players, platform]);

  // Reset salary range when platform changes
  useEffect(() => { setSalaryRange(null); }, [platform, slateId]);

  // ── Optimize ──────────────────────────────────────────────────────────────
  const optimizeMutation = useMutation<OptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize", constraints);
      return res.json();
    },
    onSuccess: () => {
      setRemovedSlots(new Set());
      setReplacingSlot(null);
      setManualReplacements({});
    },
    onError: (err) => {
      toast({ title: "Optimization Failed", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    optimizeMutation.reset();
    setRemovedSlots(new Set());
    setReplacingSlot(null);
    setSwappingSlot(null);
    setManualReplacements({});
    setSalaryRange(null);
  }, [slateId]);

  // ── Save ──────────────────────────────────────────────────────────────────
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

  // ── Derived state ─────────────────────────────────────────────────────────
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
        const matchSalary = !salaryRange || (p.salary >= salaryRange[0] && p.salary <= salaryRange[1]);
        return matchSearch && matchPos && matchSalary;
      })
      .map(p => ({
        ...p,
        value: Number(p.projectedPoints) / (p.salary / (platform === "yahoo" ? 1 : 1000)),
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
  }, [players, search, posFilter, excludedIds, salaryRange, customProjections, boosts, sortKey, sortDir, platform]);

  const currentLineup = optimizeMutation.data;
  const lineupSlots = useMemo(() => {
    if (!currentLineup?.lineup) return null;
    const assigned = assignPlayersToSlots(currentLineup.lineup, config.slots, sport);
    removedSlots.forEach(slot => { if (assigned[slot]) assigned[slot] = null; });
    Object.entries(manualReplacements).forEach(([slot, player]) => { assigned[slot] = player; });
    return assigned;
  }, [currentLineup, config.slots, sport, removedSlots, manualReplacements]);

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

  const lineupGrade = useMemo(() => {
    if (activeLineupPlayers.length === 0) return null;
    return gradeLineup(activeLineupPlayers, sport, platform, totalSalary, totalProj);
  }, [activeLineupPlayers, sport, platform, totalSalary, totalProj]);

  const remainingSalary = config.salaryCap - totalSalary;

  const swapBudget = useMemo(() => {
    if (!swappingSlot || !lineupSlots) return 0;
    const currentPlayer = lineupSlots[swappingSlot];
    return currentPlayer ? currentPlayer.salary : 0;
  }, [swappingSlot, lineupSlots]);

  const replacementEligiblePlayers = useMemo(() => {
    if (!replacingSlot || !players) return [];
    const lineupPlayerIds = new Set(activeLineupPlayers.map(p => p.id));
    const availableSalary = remainingSalary + swapBudget;
    return players.filter(p => {
      if (lineupPlayerIds.has(p.id)) return false;
      if (excludedIds.includes(p.id)) return false;
      if (!positionFitsSlot(p.position, replacingSlot, sport)) return false;
      if (p.salary > availableSalary) return false;
      return true;
    });
  }, [replacingSlot, players, activeLineupPlayers, excludedIds, sport, remainingSalary, swapBudget]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleOptimize = () => {
    if (!hasPlatformAccess) {
      toast({
        title: `${config.label} requires a paid plan`,
        description: "Upgrade to Sharpshooter or Champion to optimize on FanDuel and Yahoo.",
        variant: "destructive",
      });
      return;
    }
    setSwappingSlot(null);
    setReplacingSlot(null);
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
      playerMinSalary: salaryRange?.[0],
      playerMaxSalary: salaryRange?.[1],
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
    setBoosts({});
    setRemovedSlots(new Set());
    setReplacingSlot(null);
    setSwappingSlot(null);
    setManualReplacements({});
    setSalaryRange(null);
    optimizeMutation.reset();
    setLineupName("");
  };

  const handleExportCSV = () => {
    if (!activeLineupPlayers.length) return;
    let csv: string;
    let filename: string;
    if (platform === "yahoo") {
      csv = buildYahooCSV(activeLineupPlayers, config.slots, sport);
      filename = `yahoo_${sport.toLowerCase()}_lineup.csv`;
    } else if (platform === "fanduel") {
      csv = buildFanDuelCSV(activeLineupPlayers, config.slots, sport);
      filename = `fanduel_${sport.toLowerCase()}_lineup.csv`;
    } else {
      // DK — existing logic
      const slotAssignments = assignPlayersToSlots(activeLineupPlayers, config.slots, sport);
      const headers = config.slots.map(s => getSlotDisplayName(s));
      const row = config.slots.map(slot => {
        const p = slotAssignments[slot] as any;
        if (!p) return "";
        return p.draftKingsPlayerId ? `${p.name} (${p.draftKingsPlayerId})` : p.name;
      });
      csv = [headers.join(","), row.map(c => `"${c}"`).join(",")].join("\n");
      filename = `dk_${sport.toLowerCase()}_lineup.csv`;
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV Exported", description: `Lineup exported for ${config.label} upload.` });
  };

  const handleRemoveFromSlot = (slot: string) => {
    setRemovedSlots(prev => new Set(prev).add(slot));
    setManualReplacements(prev => { const n = { ...prev }; delete n[slot]; return n; });
    setSwappingSlot(null);
    setReplacingSlot(null);
  };

  const handleSwapFromSlot = (slot: string) => {
    if (swappingSlot === slot) { setSwappingSlot(null); setReplacingSlot(null); }
    else { setSwappingSlot(slot); setReplacingSlot(slot); }
  };

  const handleSelectReplacement = (player: Player) => {
    if (!replacingSlot) return;
    setManualReplacements(prev => ({ ...prev, [replacingSlot]: player }));
    setRemovedSlots(prev => { const n = new Set(prev); n.delete(replacingSlot); return n; });
    setReplacingSlot(null);
    setSwappingSlot(null);
  };

  const handlePlatformChange = (p: Platform) => {
    if (p !== "draftkings" && !isPaid && !isAdmin) {
      toast({
        title: `${p === "fanduel" ? "FanDuel" : "Yahoo"} requires a paid plan`,
        description: "Upgrade to Sharpshooter or Champion to unlock FanDuel and Yahoo optimization.",
        variant: "destructive",
      });
      return;
    }
    handleReset();
    setPlatform(p);
  };

  // ── Sort header helper ────────────────────────────────────────────────────
  const SortHeader = ({ label, field, className = "" }: { label: string; field: SortKey; className?: string }) => (
    <th
      className={`px-3 py-3 text-[11px] font-black uppercase tracking-widest cursor-pointer select-none hover:text-slate-300 transition-colors ${className}`}
      onClick={() => toggleSort(field)}
      data-testid={`sort-${field}`}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === field && (
          <ArrowUpDown className={`w-3 h-3 ${sortDir === "asc" ? "rotate-180" : ""}`} />
        )}
      </div>
    </th>
  );

  // ── Platform colors ───────────────────────────────────────────────────────
  const pc = PLATFORM_COLORS[platform];

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 py-4">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-3 mb-0.5">
              <h1 className="text-xl sm:text-2xl font-black text-white" data-testid="optimizer-title">
                Lineup Optimizer
              </h1>
              <Badge className={`${pc.bg} ${pc.text} ${pc.border} text-[10px] font-black`}>
                {config.shortLabel} · {sport}
              </Badge>
              {!hasPlatformAccess && platform !== "draftkings" && (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] font-black flex items-center gap-1">
                  <Crown className="w-2.5 h-2.5" /> Paid
                </Badge>
              )}
            </div>
            <p className="text-slate-400 text-xs mt-1">
              {config.rosterSize} players · {formatCap(config.salaryCap, platform)} cap
              {platform === "yahoo" && " · Yahoo DFS $200 budget"}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Platform tabs */}
            <PlatformSelector
              sport={sport}
              value={platform}
              onChange={handlePlatformChange}
              showProBadge
              tier={tier}
            />

            {/* Slate selector */}
            {sportSlates.length > 1 && (
              <select
                className="bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-lg px-3 py-2"
                value={slateId}
                onChange={e => { handleReset(); setLocation(`/optimizer/${e.target.value}`); }}
                data-testid="slate-selector"
              >
                {sportSlates.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {new Date(s.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* ── FD/YH paywall banner ── */}
        {!hasPlatformAccess && platform !== "draftkings" && (
          <div className="mb-4 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3" data-testid="platform-paywall-banner">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-sm text-amber-300 font-bold">
                {config.label} optimization is available on Sharpshooter and Champion plans.
              </p>
            </div>
            <Link href="/pricing">
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black font-black shrink-0">
                Upgrade
              </Button>
            </Link>
          </div>
        )}

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

          {/* LEFT — Player Pool */}
          <div className={`xl:col-span-3 ${mobileView !== "players" ? "hidden xl:block" : ""}`}>
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden">

              {/* Search + filters */}
              <div className="px-4 py-3 border-b border-slate-800/50 flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <Input
                    placeholder="Search players…"
                    className="pl-9 bg-slate-800/60 border-slate-700/50 h-8 text-sm"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    data-testid="player-search"
                  />
                </div>
                <div className="flex gap-1.5">
                  {/* Position filter */}
                  <select
                    className="bg-slate-800/80 border border-slate-700/50 text-xs font-bold text-white rounded-lg px-2.5 py-1.5 h-8"
                    value={posFilter}
                    onChange={e => setPosFilter(e.target.value)}
                    data-testid="pos-filter"
                  >
                    <option value="ALL">All Pos</option>
                    {config.positionFilters.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <span className="text-[11px] text-slate-500 font-bold self-center ml-auto shrink-0">
                  {filteredPlayers.length} players
                </span>
              </div>

              {/* Salary range filter */}
              <div className="px-4 py-2.5 border-b border-slate-800/40 flex items-center gap-3">
                <DollarSign className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <Slider
                  value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                  onValueChange={v => setSalaryRange([v[0], v[1]])}
                  min={salaryBounds.min}
                  max={salaryBounds.max}
                  step={salaryBounds.step}
                  className="flex-1"
                  data-testid="salary-slider"
                />
                <span className={`text-[11px] font-black shrink-0 w-24 text-right ${salaryRange ? "text-emerald-400" : "text-slate-500"}`}>
                  {formatSalary(salaryRange?.[0] ?? salaryBounds.min, platform)} –{" "}
                  {formatSalary(salaryRange?.[1] ?? salaryBounds.max, platform)}
                </span>
                {salaryRange && (
                  <button onClick={() => setSalaryRange(null)} className="text-slate-500 hover:text-white shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Player table */}
              {isLoading ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
                </div>
              ) : (
                <div className="overflow-auto max-h-[65vh]">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="sticky top-0 bg-slate-900/95 z-10 border-b border-slate-800">
                      <tr className="text-slate-400 text-left">
                        <th className="px-3 py-3 w-8" />
                        <SortHeader label="Player" field="name" />
                        <SortHeader label="Pos" field="position" className="hidden sm:table-cell" />
                        <SortHeader label="Team" field="team" className="hidden sm:table-cell" />
                        <SortHeader label="Salary" field="salary" className="text-right" />
                        <SortHeader label="Proj" field="projectedPoints" className="text-right" />
                        <SortHeader label="Val" field="value" className="text-right hidden md:table-cell" />
                        <th className="px-3 py-3 w-20 text-center text-[11px] font-black uppercase tracking-widest">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlayers.map(player => {
                        const isLocked = lockedIds.includes(player.id);
                        const inLineup = activeLineupPlayers.some(p => p.id === player.id);
                        const isSwapCandidate = !!replacingSlot && !inLineup &&
                          positionFitsSlot(player.position, replacingSlot, sport) &&
                          player.salary <= remainingSalary + swapBudget;
                        const injuryKey = Object.keys(INJURY_COLORS).find(k =>
                          player.injuryStatus?.includes(k)
                        );

                        return (
                          <tr
                            key={player.id}
                            className={`border-b border-slate-800/40 transition-colors ${
                              inLineup ? `${pc.bg}` :
                              isSwapCandidate ? "bg-emerald-500/5 cursor-pointer hover:bg-emerald-500/10" :
                              isLocked ? "bg-amber-500/5" :
                              "hover:bg-slate-800/30"
                            }`}
                            onClick={isSwapCandidate ? () => handleSelectReplacement(player) : undefined}
                            data-testid={`player-row-${player.id}`}
                          >
                            {/* Injury / in-lineup indicator */}
                            <td className="px-3 py-2.5 w-8">
                              {inLineup ? (
                                <div className={`w-1.5 h-1.5 rounded-full ${pc.bg} border ${pc.border} mx-auto`} />
                              ) : injuryKey ? (
                                <Badge className={`${INJURY_COLORS[injuryKey]} text-[9px] px-1 font-black`}>
                                  {injuryKey[0]}
                                </Badge>
                              ) : null}
                            </td>

                            {/* Name */}
                            <td className="px-3 py-2.5 font-bold text-white max-w-[140px] truncate">
                              <PlayerInfoHoverCard player={player} platform={platform}>
                                <span className="cursor-pointer hover:underline decoration-dotted">{player.name}</span>
                              </PlayerInfoHoverCard>
                            </td>

                            {/* Pos */}
                            <td className="px-3 py-2.5 text-slate-400 hidden sm:table-cell text-xs">{player.position}</td>

                            {/* Team */}
                            <td className="px-3 py-2.5 text-slate-400 hidden sm:table-cell text-xs">{player.team}</td>

                            {/* Salary */}
                            <td className="px-3 py-2.5 text-right text-slate-300 font-bold tabular-nums text-xs">
                              {formatSalary(player.salary, platform)}
                            </td>

                            {/* Custom projection input */}
                            <td className="px-3 py-2.5 text-right">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={customProjections[player.id] !== undefined
                                  ? customProjections[player.id]
                                  : Number(player.projectedPoints).toFixed(1)}
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val >= 0) setCustomProjections(prev => ({ ...prev, [player.id]: val }));
                                  else if (e.target.value === "") setCustomProjections(prev => { const n = { ...prev }; delete n[player.id]; return n; });
                                }}
                                className={`w-12 text-right bg-transparent border-0 focus:outline-none focus:bg-slate-700/60 focus:rounded px-0.5 text-xs tabular-nums ${
                                  customProjections[player.id] !== undefined ? "text-purple-400 font-bold" : "text-emerald-400 font-bold"
                                }`}
                                title="Click to override projection"
                                data-testid={`proj-input-${player.id}`}
                              />
                            </td>

                            {/* Value */}
                            <td className="px-3 py-2.5 text-right hidden md:table-cell">
                              <span className={`text-[10px] font-bold tabular-nums ${
                                (player as any).value >= 5 ? "text-emerald-400" :
                                (player as any).value >= 3.5 ? "text-slate-300" : "text-slate-500"
                              }`}>
                                {((player as any).value ?? 0).toFixed(1)}x
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-center gap-0.5">
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setLockedIds(prev => isLocked ? prev.filter(id => id !== player.id) : [...prev, player.id]);
                                    setExcludedIds(prev => prev.filter(id => id !== player.id));
                                  }}
                                  className={`p-1.5 rounded-lg transition-colors ${isLocked ? "bg-amber-500/20 text-amber-400" : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"}`}
                                  title={isLocked ? "Unlock" : "Lock"}
                                  data-testid={`lock-${player.id}`}
                                >
                                  {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setExcludedIds(prev => [...prev, player.id]);
                                    setLockedIds(prev => prev.filter(id => id !== player.id));
                                  }}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
              )}

              {/* Locked + excluded chips */}
              {(lockedIds.length > 0 || excludedIds.length > 0) && (
                <div className="px-4 py-2.5 border-t border-slate-800/50 flex flex-wrap gap-1.5">
                  {lockedIds.map(id => {
                    const p = players?.find(pl => pl.id === id);
                    return p ? (
                      <span key={id} className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2 py-0.5 text-[10px] font-bold text-amber-400">
                        <Lock className="w-2.5 h-2.5" /> {p.name}
                        <button onClick={() => setLockedIds(prev => prev.filter(x => x !== id))} className="hover:text-white ml-0.5">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ) : null;
                  })}
                  {excludedIds.map(id => {
                    const p = players?.find(pl => pl.id === id);
                    return p ? (
                      <span key={id} className="inline-flex items-center gap-1 bg-red-500/10 border border-red-500/25 rounded-lg px-2 py-0.5 text-[10px] font-bold text-red-400">
                        <X className="w-2.5 h-2.5" /> {p.name}
                        <button onClick={() => setExcludedIds(prev => prev.filter(x => x !== id))} className="hover:text-white ml-0.5">
                          <RotateCcw className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}

              {/* Optimize + reset */}
              <div className="px-4 py-3 border-t border-slate-800/50 flex gap-2">
                <Button
                  onClick={handleOptimize}
                  disabled={optimizeMutation.isPending || !slateId}
                  className={`flex-1 font-black text-sm h-10 ${
                    !hasPlatformAccess
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30"
                      : platform === "fanduel"
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20"
                      : platform === "yahoo"
                      ? "bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/20"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20"
                  }`}
                  data-testid="optimize-btn"
                >
                  {optimizeMutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Optimizing…</>
                    : !hasPlatformAccess
                    ? <><Crown className="w-4 h-4 mr-2" />Upgrade to Optimize</>
                    : <><Zap className="w-4 h-4 mr-2" />Optimize {config.shortLabel} Lineup</>
                  }
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="border-slate-700 text-slate-400 h-10"
                  data-testid="reset-btn"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* RIGHT — Lineup */}
          <div className={`xl:col-span-2 ${mobileView !== "lineup" ? "hidden xl:block" : ""}`}>
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden">

              {/* Lineup header */}
              <div className={`px-5 py-3 border-b border-slate-800/50 flex items-center justify-between ${pc.bg}`}>
                <div>
                  <p className={`text-xs font-black uppercase tracking-widest ${pc.text}`}>
                    {config.label} Lineup
                  </p>
                  {activeLineupPlayers.length > 0 && lineupGrade && (
                    <div className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md text-xs font-black ${GRADE_COLORS[lineupGrade.grade]?.bg || ""} ${GRADE_COLORS[lineupGrade.grade]?.text || "text-slate-400"} border ${GRADE_COLORS[lineupGrade.grade]?.border || ""}`}>
                      {lineupGrade.grade === "S" && <Star className="w-3 h-3 fill-current" />}
                      Grade {lineupGrade.grade} · {lineupGrade.score}/100
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className={`text-lg font-black tabular-nums ${remainingSalary < 0 ? "text-red-400" : "text-white"}`}>
                    {formatSalary(totalSalary, platform)}
                  </p>
                  <p className={`text-[10px] font-bold ${remainingSalary < 0 ? "text-red-400" : "text-slate-400"}`}>
                    {remainingSalary >= 0 ? formatSalary(remainingSalary, platform) + " left" : "OVER CAP"}
                  </p>
                </div>
              </div>

              {/* Roster slots */}
              <div className="divide-y divide-slate-800/50">
                {config.slots.map(slot => {
                  const player = lineupSlots?.[slot];
                  const isRemoved = removedSlots.has(slot);
                  const isSwappingThis = swappingSlot === slot;
                  const slotLabel = getSlotDisplayName(slot);

                  // Yahoo-specific slot styling cues
                  const isKicker = slotLabel === "K";
                  const isSP = slotLabel === "SP";
                  const isLW = slotLabel === "LW";
                  const isRW = slotLabel === "RW";

                  return (
                    <div
                      key={slot}
                      className={`px-4 py-3 flex items-center gap-3 transition-colors ${
                        isSwappingThis ? "bg-emerald-500/5 border-l-2 border-emerald-500/50" :
                        isRemoved ? "opacity-40" :
                        player ? "hover:bg-slate-800/20" : "bg-slate-800/10"
                      }`}
                      data-testid={`lineup-slot-${slot}`}
                    >
                      {/* Slot label */}
                      <div className={`w-10 h-8 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-black ${
                        isKicker ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                        isSP ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" :
                        isLW ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" :
                        isRW ? "bg-sky-500/20 text-sky-400 border border-sky-500/30" :
                        `${pc.bg} ${pc.text} border ${pc.border}`
                      }`}>
                        {slotLabel}
                      </div>

                      {/* Player info */}
                      <div className="flex-1 min-w-0">
                        {player && !isRemoved ? (
                          <>
                            <PlayerInfoHoverCard player={player} platform={platform}>
                              <p className="text-sm font-bold text-white truncate cursor-pointer hover:underline decoration-dotted">
                                {player.name}
                              </p>
                            </PlayerInfoHoverCard>
                            <p className="text-[10px] text-slate-400">
                              {player.position} · {player.team} · {formatSalary(player.salary, platform)}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-slate-600 italic">
                            {isRemoved ? "Removed" : "Empty"}
                          </p>
                        )}
                      </div>

                      {/* Projection */}
                      {player && !isRemoved && (
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-black tabular-nums ${pc.text}`}>
                            {(customProjections[player.id] ?? Number(player.projectedPoints)).toFixed(1)}
                          </p>
                          <p className="text-[10px] text-slate-500">pts</p>
                        </div>
                      )}

                      {/* Swap / remove */}
                      {player && !isRemoved && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => handleSwapFromSlot(slot)}
                            className={`p-1.5 rounded-lg transition-colors ${isSwappingThis ? "bg-emerald-500/20 text-emerald-400" : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"}`}
                            data-testid={`swap-slot-${slot}`}
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveFromSlot(slot)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            data-testid={`remove-slot-${slot}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              {activeLineupPlayers.length > 0 && (
                <div className={`px-5 py-3 border-t border-slate-800/50 ${pc.bg}`}>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className={`text-lg font-black tabular-nums ${pc.text}`}>
                        {totalProj.toFixed(1)}
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Proj Pts</p>
                    </div>
                    <div>
                      <p className={`text-lg font-black tabular-nums ${remainingSalary < 0 ? "text-red-400" : "text-white"}`}>
                        {formatSalary(totalSalary, platform)}
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Salary</p>
                    </div>
                    <div>
                      <p className={`text-lg font-black tabular-nums ${remainingSalary < 0 ? "text-red-400" : "text-slate-300"}`}>
                        {formatSalary(Math.abs(remainingSalary), platform)}
                        {remainingSalary < 0 ? " over" : " left"}
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remaining</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Save + Export */}
              {activeLineupPlayers.length > 0 && user && (
                <div className="px-4 py-3 border-t border-slate-800/50 space-y-2">
                  <Input
                    placeholder={`Name this ${config.shortLabel} lineup…`}
                    value={lineupName}
                    onChange={e => setLineupName(e.target.value)}
                    className="bg-slate-800/60 border-slate-700/50 text-sm h-8"
                    data-testid="lineup-name-input"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSave}
                      disabled={saveLineupMutation.isPending || remainingSalary < 0}
                      className={`flex-1 font-bold h-9 ${pc.bg} border ${pc.border} ${pc.text} hover:opacity-80`}
                      data-testid="save-lineup-btn"
                    >
                      {saveLineupMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                        : <Save className="w-4 h-4 mr-1.5" />}
                      Save to Vault
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportCSV}
                      className="border-slate-700 text-slate-300 h-9 font-bold"
                      data-testid="export-csv-btn"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      CSV
                    </Button>
                  </div>
                </div>
              )}

              {/* Swap replacement list */}
              {replacingSlot && replacementEligiblePlayers.length > 0 && (
                <div className="border-t border-slate-700/50 px-4 py-3" data-testid="swap-panel">
                  <p className="text-xs font-bold text-slate-300 mb-2">
                    Replacing <span className={pc.text}>{getSlotDisplayName(replacingSlot)}</span> slot
                    <button onClick={() => { setReplacingSlot(null); setSwappingSlot(null); }} className="ml-2 text-slate-500 hover:text-white">
                      <X className="w-3.5 h-3.5 inline" />
                    </button>
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {replacementEligiblePlayers
                      .sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints))
                      .slice(0, 20)
                      .map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectReplacement(p)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-700/40 transition-colors text-left"
                          data-testid={`swap-candidate-${p.id}`}
                        >
                          <span className="text-[10px] font-black text-slate-400 w-8">{p.position.split("/")[0]}</span>
                          <span className="text-sm font-bold text-white flex-1 truncate">{p.name}</span>
                          <span className="text-xs text-slate-400">{formatSalary(p.salary, platform)}</span>
                          <span className={`text-xs font-black ${pc.text} w-10 text-right`}>{Number(p.projectedPoints).toFixed(1)}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile tab bar */}
        <div className="xl:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 flex z-50">
          {["players", "lineup"].map(v => (
            <button
              key={v}
              onClick={() => setMobileView(v as any)}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                mobileView === v ? `${pc.text}` : "text-slate-500"
              }`}
            >
              {v === "players" ? `Players (${filteredPlayers.length})` : `${config.shortLabel} Lineup`}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
