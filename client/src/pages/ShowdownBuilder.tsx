import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Swords, Crown, Lock, X, Search, Download, Save,
  ChevronLeft, ChevronRight, RefreshCw, Zap, Target, Sliders,
  ChevronDown, ChevronUp, DollarSign, BarChart3, Shuffle,
  TrendingUp, TrendingDown, AlertTriangle, Settings2, EyeOff,
  Activity, Clock, RotateCcw,
} from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { Slate, Player } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

// Per-player settings (mirroring ProOptimizer pattern)
interface PlayerSettings {
  customProjection?: number;
  customOwnership?: number;   // override the scout/default ownership %
  maxExposure?: number;       // 0–100, per-player cap across lineups
  fade: boolean;              // soft-exclude (low weight, not hard exclude)
}

// Scout signal shape (matches ai_scout.py output)
interface ScoutSignal {
  player_name: string;
  signal_type: string;
  reason: string;
  beneficiary_names?: string[];
  ownership_delta?: number;
  confidence: number;
}

// Mirror of BOOST_WEIGHTS in ai_scout.py / useScoutBoosts.ts
const BOOST_WEIGHTS: Record<string, number> = {
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

const SIGNAL_META: Record<string, { label: string; colorClass: string; icon: string }> = {
  starter_out:       { label: "Starter Out",   colorClass: "text-red-400 bg-red-500/10 border-red-500/30",         icon: "🚨" },
  injury_opp:        { label: "Inj Opp",        colorClass: "text-orange-400 bg-orange-500/10 border-orange-500/30", icon: "⚡" },
  lineup_promotion:  { label: "Usage Bump",     colorClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", icon: "📈" },
  weather_boost:     { label: "Weather",        colorClass: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",      icon: "🌤️" },
  matchup_upgrade:   { label: "Matchup",        colorClass: "text-blue-400 bg-blue-500/10 border-blue-500/30",      icon: "🎯" },
  confirmed_starter: { label: "Confirmed",      colorClass: "text-green-400 bg-green-500/10 border-green-500/30",   icon: "✅" },
  value_spike:       { label: "Value",          colorClass: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30", icon: "💰" },
  hot_streak:        { label: "Hot Streak",     colorClass: "text-amber-400 bg-amber-500/10 border-amber-500/30",   icon: "🔥" },
  negative_news:     { label: "Negative",       colorClass: "text-slate-400 bg-slate-800 border-slate-700",         icon: "⚠️" },
  out:               { label: "OUT",            colorClass: "text-red-400 bg-red-500/20 border-red-500/40",         icon: "❌" },
};

const SHOWDOWN_SPORTS = ["NBA", "NFL"].filter(s => ACTIVE_SPORTS.includes(s as any));

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ShowdownBuilder() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Slate / sport ──────────────────────────────────────────────────────────
  const [sport, setSport] = useState("NBA");
  const [platform] = useState<"draftkings" | "fanduel">("draftkings");
  const [selectedSlateId, setSelectedSlateId] = useState<number | null>(null);
  const [gameFilter, setGameFilter] = useState<string>("");

  // ── Player pool filters ────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<"proj" | "salary" | "value" | "name" | "boost">("proj");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ── Locks / excludes ───────────────────────────────────────────────────────
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [lockedFlexIds, setLockedFlexIds] = useState<number[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);

  // ── Per-player settings ────────────────────────────────────────────────────
  // playerId (string) -> PlayerSettings
  const [playerSettings, setPlayerSettings] = useState<Record<string, PlayerSettings>>({});
  const [expandedSettingsId, setExpandedSettingsId] = useState<number | null>(null);

  // Derived shortcut: customProjections map (for backward-compat w/ optimizer payload)
  const customProjections = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, s] of Object.entries(playerSettings)) {
      if (s.customProjection !== undefined) out[id] = s.customProjection;
    }
    return out;
  }, [playerSettings]);

  function updatePlayerSetting(playerId: number, patch: Partial<PlayerSettings>) {
    setPlayerSettings(prev => {
      const cur = prev[String(playerId)] ?? { fade: false };
      return { ...prev, [String(playerId)]: { ...cur, ...patch } };
    });
  }

  function resetPlayerSetting(playerId: number) {
    setPlayerSettings(prev => {
      const n = { ...prev };
      delete n[String(playerId)];
      return n;
    });
  }

  const customizedCount = Object.keys(playerSettings).length;

  // ── Lineup settings ────────────────────────────────────────────────────────
  const [lineupCount, setLineupCount] = useState(1);
  const [projectionMode, setProjectionMode] = useState<"balanced" | "ceiling">("balanced");
  const [leverageMode, setLeverageMode] = useState(false);
  const [useBoosts, setUseBoosts] = useState(false);
  const [globalMaxExposure, setGlobalMaxExposure] = useState<number | null>(null);
  const [salaryRange, setSalaryRange] = useState<[number, number] | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // ── Output ─────────────────────────────────────────────────────────────────
  const [generatedLineups, setGeneratedLineups] = useState<ShowdownLineup[]>([]);
  const [showdownConfig, setShowdownConfig] = useState<ShowdownConfig | null>(null);
  const [activeLineupIdx, setActiveLineupIdx] = useState(0);
  const [savedLineupIndices, setSavedLineupIndices] = useState<Set<number>>(new Set());

  // ── Subscription ───────────────────────────────────────────────────────────
  const { data: subscription } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });
  const userIsAdmin = (user as any)?.isAdmin === true;
  const tier = subscription?.tier || "free";
  const maxLineups = userIsAdmin ? 20 : tier === "pro" ? 20 : tier === "star" ? 5 : 1;
  const isPaidUser = userIsAdmin || tier === "pro" || tier === "star";

  // ── Scout signals ──────────────────────────────────────────────────────────
  const { data: scoutData, isLoading: scoutLoading } = useQuery<{
    signals: ScoutSignal[];
    seconds_until_refresh: number;
  }>({
    queryKey: ["/api/scout/signals", sport],
    queryFn: () => apiRequest("GET", `/api/scout/signals/${sport}`).then(r => r.json()),
    refetchInterval: 60_000,
    enabled: !!sport,
  });

  const scoutSignals: ScoutSignal[] = scoutData?.signals || [];

  // Build a name -> signals map for fast lookup in the player table
  const signalByName = useMemo(() => {
    const map: Record<string, ScoutSignal[]> = {};
    for (const sig of scoutSignals) {
      const key = sig.player_name.toLowerCase();
      if (!map[key]) map[key] = [];
      map[key].push(sig);
    }
    return map;
  }, [scoutSignals]);

  // Compute net scout boost per player name
  const boostByName = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sig of scoutSignals) {
      const key = sig.player_name.toLowerCase();
      const w = (BOOST_WEIGHTS[sig.signal_type] || 0) * sig.confidence;
      map[key] = (map[key] || 0) + w;
    }
    return map;
  }, [scoutSignals]);

  // ── Reset helper — clears ALL player-specific state on slate switch ──────
  function resetForSlate(newSlateId: number | null) {
    setCaptainId(null);
    setLockedFlexIds([]);
    setExcludedIds([]);
    setGameFilter("");
    setSearchTerm("");
    setPosFilter("ALL");
    setTeamFilter("ALL");
    setSalaryRange(null);
    setPlayerSettings({});
    setExpandedSettingsId(null);
    setGeneratedLineups([]);
    setShowdownConfig(null);
    setSavedLineupIndices(new Set());
    setActiveLineupIdx(0);
    setSelectedSlateId(newSlateId);
  }

  // ── Slates ─────────────────────────────────────────────────────────────────
  interface SlateOption {
    id:           number;
    sport:        string;
    platform:     string;
    gameType:     string;
    label:        string;
    startTime:    string;
    isMain:       boolean;
    gameCount:    number;
    contestCount: number;
    salaryCap:    number;
  }

  const { data: slates, isLoading: slatesLoading } = useQuery<SlateOption[]>({
    queryKey: ["/api/showdown/slates", sport, platform],
    queryFn: async () => {
      const res = await fetch(
        `/api/showdown/slates?sport=${sport}&platform=${platform}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch slates");
      const data: SlateOption[] = await res.json();
      if (data.length > 0 && !selectedSlateId) {
        const main = data.find(s => s.isMain) ?? data[0];
        setSelectedSlateId(main.id);
      }
      return data;
    },
    refetchOnWindowFocus: true,
    staleTime: 5 * 60 * 1000,
  });

  // ── Players ────────────────────────────────────────────────────────────────
  const { data: playerData, isLoading: playersLoading } = useQuery<{
    slate: any;
    games: Record<string, Player[]>;
    players: Player[];
  }>({
    queryKey: ["/api/showdown/players", selectedSlateId],
    queryFn: async () => {
      const res = await fetch(`/api/showdown/players/${selectedSlateId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch players");
      return res.json();
    },
    enabled: !!selectedSlateId,
  });

  const players = playerData?.players || [];
  const games = playerData?.games || {};
  const gameKeys = Object.keys(games);

  // ── Derived player metadata ────────────────────────────────────────────────
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

  const captainMultiplier = showdownConfig?.captainMultiplier || (platform === "fanduel" ? 2.0 : 1.5);
  const salaryMultiplier = platform === "fanduel" ? 1.0 : 1.5;
  const captainLabel = showdownConfig?.captainLabel || (platform === "fanduel" ? "MVP" : "CPT");
  const flexLabel = showdownConfig?.flexLabel || "FLEX";

  // ── Filtered + enriched player pool ───────────────────────────────────────
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
      .map(p => {
        const pset = playerSettings[String(p.id)];
        const nameKey = p.name.toLowerCase();
        const scoutBoost = useBoosts ? (boostByName[nameKey] || 0) : 0;
        const baseProj = toNum(p.projectedPoints);
        const customProj = pset?.customProjection;
        // custom proj wins → base+scout if boosts on → base
        const effProj = customProj !== undefined ? customProj : (baseProj + scoutBoost);
        const value = effProj / Math.max(p.salary / 1000, 0.1);
        return {
          ...p,
          _effProj: effProj,
          _scoutBoost: scoutBoost,
          _signals: signalByName[nameKey] || [],
          _value: value,
          _fade: pset?.fade ?? false,
          _customOwnership: pset?.customOwnership,
          _maxExposure: pset?.maxExposure,
        };
      })
      .sort((a, b) => {
        if (sortKey === "salary")  return sortDir === "asc" ? a.salary - b.salary : b.salary - a.salary;
        if (sortKey === "value")   return sortDir === "asc" ? a._value - b._value : b._value - a._value;
        if (sortKey === "name")    return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        if (sortKey === "boost")   return sortDir === "asc" ? a._scoutBoost - b._scoutBoost : b._scoutBoost - a._scoutBoost;
        return sortDir === "asc" ? a._effProj - b._effProj : b._effProj - a._effProj;
      });
  }, [players, gameFilter, searchTerm, posFilter, teamFilter, salaryRange, playerSettings, useBoosts, boostByName, signalByName, sortKey, sortDir]);

  // ── Optimize ───────────────────────────────────────────────────────────────
  const optimizeMut = useMutation({
    mutationFn: async () => {
      // Build per-player payload: merge custom projections + scout boosts (if on)
      const mergedProjections: Record<string, number> = { ...customProjections };
      if (useBoosts) {
        for (const p of players) {
          const pid = String(p.id);
          if (pid in mergedProjections) continue; // user override wins
          const boost = boostByName[p.name.toLowerCase()] || 0;
          if (boost !== 0) mergedProjections[pid] = toNum(p.projectedPoints) + boost;
        }
      }

      // Per-player exposure caps
      const perPlayerMaxExposure: Record<string, number> = {};
      for (const [pid, pset] of Object.entries(playerSettings)) {
        if (pset.maxExposure !== undefined) perPlayerMaxExposure[pid] = pset.maxExposure;
      }

      // Per-player custom ownership overrides
      const ownershipOverrides: Record<string, number> = {};
      for (const [pid, pset] of Object.entries(playerSettings)) {
        if (pset.customOwnership !== undefined) ownershipOverrides[pid] = pset.customOwnership;
      }

      // Faded players → soft-exclude (pass as a separate flag array)
      const fadedIds = Object.entries(playerSettings)
        .filter(([, s]) => s.fade)
        .map(([id]) => Number(id));

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
        playerProjections: Object.keys(mergedProjections).length > 0 ? mergedProjections : undefined,
        playerMinSalary: salaryRange?.[0] ?? undefined,
        playerMaxSalary: salaryRange?.[1] ?? undefined,
        perPlayerMaxExposure: Object.keys(perPlayerMaxExposure).length > 0 ? perPlayerMaxExposure : undefined,
        ownershipOverrides: Object.keys(ownershipOverrides).length > 0 ? ownershipOverrides : undefined,
        fadedPlayerIds: fadedIds.length > 0 ? fadedIds : undefined,
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

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async (lineup: ShowdownLineup) => {
      const snapshot = [
        { ...lineup.captain, slot: captainLabel },
        ...lineup.flexPlayers.map((p, i) => ({ ...p, slot: `${flexLabel}${i + 1}` })),
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

  // ── Actions ────────────────────────────────────────────────────────────────
  function toggleCaptain(playerId: number) {
    setCaptainId(prev => prev === playerId ? null : playerId);
    setLockedFlexIds(prev => prev.filter(id => id !== playerId));
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

  function toggleExpanded(playerId: number) {
    setExpandedSettingsId(prev => prev === playerId ? null : playerId);
  }

  function exportCSV() {
    if (!activeLineup) return;
    const header = [captainLabel, ...Array.from({ length: activeLineup.flexPlayers.length }, () => flexLabel)].join(",");
    const row = [activeLineup.captain.name, ...activeLineup.flexPlayers.map(p => p.name)].join(",");
    const blob = new Blob([`${header}\n${row}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `showdown_${sport}_lineup.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function resetAll() {
    setCaptainId(null); setLockedFlexIds([]); setExcludedIds([]);
    setPlayerSettings({}); setSalaryRange(null);
    setProjectionMode("balanced"); setLeverageMode(false);
    setUseBoosts(false); setGlobalMaxExposure(null);
    setExpandedSettingsId(null);
  }

  const activeLineup = generatedLineups[activeLineupIdx];

  const anyActiveConfig = projectionMode !== "balanced" || leverageMode || useBoosts
    || !!globalMaxExposure || !!salaryRange || customizedCount > 0;

  // ── Unauthenticated guard ──────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2" data-testid="showdown-title">
              <Swords className="w-6 h-6 text-amber-500" />
              Showdown Builder
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              {captainLabel} scores {captainMultiplier}x &middot; Single-game lineups
              {scoutSignals.length > 0 && (
                <span className="ml-2 text-emerald-400 font-bold">
                  · {scoutSignals.length} Scout signals active
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {SHOWDOWN_SPORTS.map(s => (
              <Button
                key={s}
                variant={sport === s ? "default" : "outline"}
                size="sm"
                onClick={() => { setSport(s); resetForSlate(null); }}
                className={sport === s ? "bg-amber-600 hover:bg-amber-700 h-8" : "border-slate-600 text-slate-300 h-8"}
                data-testid={`showdown-sport-${s.toLowerCase()}`}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        {/* ── Top Controls ── */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <Select
            value={selectedSlateId?.toString() || ""}
            onValueChange={v => resetForSlate(Number(v))}
          >
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white sm:max-w-sm" data-testid="select-slate">
              <SelectValue placeholder={slatesLoading ? "Loading slates..." : "Select a slate"} />
            </SelectTrigger>
            <SelectContent>
              {(slates || []).map(s => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  <div className="flex items-center gap-2">
                    {s.isMain && (
                      <span className="text-amber-400 text-[10px] font-black">★</span>
                    )}
                    <span>{s.label}</span>
                    {s.gameCount > 0 && !s.label.includes("game") && (
                      <span className="text-slate-500 text-[11px]">
                        · {s.gameCount}G
                      </span>
                    )}
                  </div>
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
                {gameKeys.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
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

        {/* ── Empty state ── */}
        {!selectedSlateId ? (
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-12 text-center" data-testid="showdown-select-slate">
              <Swords className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Select a Slate</h3>
              <p className="text-slate-400">
                {slates && slates.length > 0
                  ? `${slates.length} ${sport} slate${slates.length > 1 ? "s" : ""} available — pick one above.`
                  : `Choose a ${sport} slate above to start building showdown lineups.`}
              </p>
              {slates && slates.length > 1 && (
                <p className="text-slate-500 text-xs mt-2">
                  ★ marks the main Classic slate
                </p>
              )}
            </CardContent>
          </Card>
        ) : playersLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

            {/* ── LEFT: Player Pool ── */}
            <div className="lg:col-span-3">
              <Card className="bg-slate-900 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white text-base">Player Pool ({filteredPlayers.length})</CardTitle>
                    <div className="flex gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1 text-[10px] text-amber-400"><Crown className="w-3 h-3" /> {captainLabel}</div>
                      <div className="flex items-center gap-1 text-[10px] text-blue-400"><Lock className="w-3 h-3" /> {flexLabel}</div>
                      <div className="flex items-center gap-1 text-[10px] text-red-400"><X className="w-3 h-3" /> Exclude</div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400"><Settings2 className="w-3 h-3" /> Settings</div>
                    </div>
                  </div>

                  {/* Filters row */}
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
                  <div className="max-h-[60vh] overflow-y-auto">
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
                          {scoutSignals.length > 0 && (
                            <th onClick={() => { setSortKey("boost"); setSortDir(d => d === "asc" ? "desc" : "asc"); }} className="text-center px-1 py-2 cursor-pointer hover:text-white select-none text-emerald-400">
                              Scout {sortKey === "boost" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                            </th>
                          )}
                          <th onClick={() => { setSortKey("value"); setSortDir(d => d === "asc" ? "desc" : "asc"); }} className="text-right px-1 py-2 cursor-pointer hover:text-white select-none hidden sm:table-cell" title="Pts/$1K">
                            Val {sortKey === "value" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </th>
                          <th className="text-center px-1 py-2 w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPlayers.map(player => {
                          const isCpt  = captainId === player.id;
                          const isFlex = lockedFlexIds.includes(player.id);
                          const isExcl = excludedIds.includes(player.id);
                          const isFade = player._fade;
                          const isExpanded = expandedSettingsId === player.id;
                          const pset = playerSettings[String(player.id)];
                          const hasCustomSettings = !!pset && (
                            pset.customProjection !== undefined ||
                            pset.customOwnership !== undefined ||
                            pset.maxExposure !== undefined ||
                            pset.fade
                          );
                          const cptSal  = Math.round(player.salary * salaryMultiplier);
                          const cptProj = Math.round(player._effProj * captainMultiplier * 100) / 100;
                          const topSignal = player._signals[0];

                          return (
                            <>
                              {/* ── Main player row ── */}
                              <tr
                                key={`row-${player.id}`}
                                className={`border-t border-slate-800 transition-colors ${
                                  isExcl ? "opacity-40" :
                                  isFade ? "opacity-60 bg-slate-900/40" :
                                  isCpt ? "bg-amber-500/10" :
                                  isFlex ? "bg-blue-500/10" :
                                  isExpanded ? "bg-slate-800/60" :
                                  "hover:bg-slate-800/50"
                                }`}
                                data-testid={`player-row-${player.id}`}
                              >
                                {/* Injury badge */}
                                <td className="px-2 py-1.5">
                                  {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                                    <Badge variant="outline" className="border-red-500/30 text-red-400 text-[9px] px-1">
                                      {player.injuryStatus === "Probable" ? "P" : player.injuryStatus === "Questionable" ? "Q" : player.injuryStatus === "Doubtful" ? "D" : "O"}
                                    </Badge>
                                  )}
                                </td>

                                {/* Name + signal badge */}
                                <td className="px-1 py-1.5 max-w-[120px] sm:max-w-[160px]">
                                  <div className="flex flex-col gap-0.5">
                                    <span className={`font-medium truncate ${isExcl || isFade ? "line-through text-slate-500" : "text-white"}`}>
                                      {player.name}
                                    </span>
                                    {topSignal && (
                                      <span className={`text-[9px] font-black px-1 py-0.5 rounded border w-fit ${(SIGNAL_META[topSignal.signal_type] || SIGNAL_META["hot_streak"]).colorClass}`}>
                                        {(SIGNAL_META[topSignal.signal_type] || SIGNAL_META["hot_streak"]).icon} {(SIGNAL_META[topSignal.signal_type] || SIGNAL_META["hot_streak"]).label}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="px-1 py-1.5 text-slate-400">{player.position}</td>
                                <td className="px-1 py-1.5 text-slate-400 hidden sm:table-cell">{player.team}</td>
                                <td className="px-1 py-1.5 text-slate-300 text-right">${player.salary.toLocaleString()}</td>
                                <td className="px-1 py-1.5 text-amber-400 text-right font-medium">${cptSal.toLocaleString()}</td>

                                {/* Projection (editable inline) */}
                                <td className="px-1 py-1.5 text-right">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={pset?.customProjection !== undefined ? pset.customProjection : toNum(player.projectedPoints).toFixed(1)}
                                    onChange={e => {
                                      const val = parseFloat(e.target.value);
                                      if (!isNaN(val) && val >= 0) updatePlayerSetting(player.id, { customProjection: val });
                                      else if (e.target.value === "") updatePlayerSetting(player.id, { customProjection: undefined });
                                    }}
                                    className={`w-12 text-right bg-transparent border-0 focus:outline-none focus:bg-slate-700/60 focus:rounded px-0.5 text-xs tabular-nums ${pset?.customProjection !== undefined ? "text-purple-400 font-bold" : player._scoutBoost !== 0 ? "text-emerald-300" : "text-slate-300"}`}
                                    title="Click to override projection"
                                    data-testid={`custom-proj-${player.id}`}
                                  />
                                </td>

                                {/* CPT projected */}
                                <td className="px-1 py-1.5 text-amber-400 text-right font-bold">{cptProj.toFixed(1)}</td>

                                {/* Scout boost column */}
                                {scoutSignals.length > 0 && (
                                  <td className="px-1 py-1.5 text-center">
                                    {player._scoutBoost !== 0 && (
                                      <span className={`text-[10px] font-black tabular-nums ${player._scoutBoost > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                        {player._scoutBoost > 0 ? "+" : ""}{player._scoutBoost.toFixed(1)}
                                      </span>
                                    )}
                                  </td>
                                )}

                                {/* Value */}
                                <td className="px-1 py-1.5 text-right hidden sm:table-cell">
                                  <span className={`text-[10px] font-bold tabular-nums ${player._value >= 5 ? "text-emerald-400" : player._value >= 3.5 ? "text-slate-300" : "text-slate-500"}`}>
                                    {player._value.toFixed(1)}x
                                  </span>
                                </td>

                                {/* Actions */}
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
                                    {/* Per-player settings toggle */}
                                    <button
                                      onClick={() => toggleExpanded(player.id)}
                                      className={`p-1 rounded transition-colors relative ${isExpanded ? "bg-slate-700 text-white" : hasCustomSettings ? "text-purple-400 hover:bg-slate-700" : "text-slate-500 hover:text-slate-300 hover:bg-slate-700"}`}
                                      title="Player settings"
                                      data-testid={`player-settings-${player.id}`}
                                    >
                                      <Settings2 className="w-3.5 h-3.5" />
                                      {hasCustomSettings && !isExpanded && (
                                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-purple-400 rounded-full" />
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* ── Per-player settings expansion ── */}
                              {isExpanded && (
                                <tr key={`settings-${player.id}`} className="bg-slate-800/80 border-t border-slate-700/50">
                                  <td colSpan={scoutSignals.length > 0 ? 11 : 10} className="px-3 py-3">
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-[11px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                          <Settings2 className="w-3.5 h-3.5 text-purple-400" />
                                          {player.name} — Player Settings
                                        </span>
                                        {hasCustomSettings && (
                                          <button
                                            onClick={() => resetPlayerSetting(player.id)}
                                            className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-1"
                                            data-testid={`reset-player-settings-${player.id}`}
                                          >
                                            <RotateCcw className="w-3 h-3" /> Reset
                                          </button>
                                        )}
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

                                        {/* Custom projection override */}
                                        <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Custom Projection</label>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              step="0.1"
                                              min="0"
                                              placeholder={toNum(player.projectedPoints).toFixed(1)}
                                              value={pset?.customProjection ?? ""}
                                              onChange={e => {
                                                const val = parseFloat(e.target.value);
                                                if (!isNaN(val) && val >= 0) updatePlayerSetting(player.id, { customProjection: val });
                                                else updatePlayerSetting(player.id, { customProjection: undefined });
                                              }}
                                              className="w-20 bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs focus:border-purple-500 focus:outline-none"
                                              data-testid={`custom-proj-expanded-${player.id}`}
                                            />
                                            <span className="text-[10px] text-slate-500">pts</span>
                                            {player._scoutBoost !== 0 && !pset?.customProjection && (
                                              <span className={`text-[9px] font-bold ${player._scoutBoost > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                Scout: {player._scoutBoost > 0 ? "+" : ""}{player._scoutBoost.toFixed(1)}
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Custom ownership override */}
                                        <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">Ownership %</label>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              step="1"
                                              min="1"
                                              max="99"
                                              placeholder={
                                                (() => {
                                                  const own = toNum((player as any).ownershipProjection);
                                                  const delta = scoutSignals.find(s => s.player_name.toLowerCase() === player.name.toLowerCase())?.ownership_delta ?? 0;
                                                  return Math.max(1, Math.min(99, own + delta)).toFixed(0);
                                                })()
                                              }
                                              value={pset?.customOwnership ?? ""}
                                              onChange={e => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val)) updatePlayerSetting(player.id, { customOwnership: Math.max(1, Math.min(99, val)) });
                                                else updatePlayerSetting(player.id, { customOwnership: undefined });
                                              }}
                                              className="w-16 bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                                              data-testid={`custom-ownership-${player.id}`}
                                            />
                                            <span className="text-[10px] text-slate-500">%</span>
                                          </div>
                                        </div>

                                        {/* Max exposure */}
                                        <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5">
                                            Max Exposure
                                            {lineupCount <= 1 && <span className="text-slate-600 ml-1">(multi-lineup)</span>}
                                          </label>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              step="5"
                                              min="0"
                                              max="100"
                                              placeholder="100"
                                              value={pset?.maxExposure ?? ""}
                                              onChange={e => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val)) updatePlayerSetting(player.id, { maxExposure: Math.max(0, Math.min(100, val)) });
                                                else updatePlayerSetting(player.id, { maxExposure: undefined });
                                              }}
                                              className="w-16 bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none"
                                              data-testid={`max-exposure-${player.id}`}
                                            />
                                            <span className="text-[10px] text-slate-500">%</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Fade toggle */}
                                      <div className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                                          <div>
                                            <p className="text-xs font-bold text-white">Fade Player</p>
                                            <p className="text-[10px] text-slate-500">Soft-downweight in optimizer (vs hard exclude)</p>
                                          </div>
                                        </div>
                                        <Switch
                                          checked={pset?.fade ?? false}
                                          onCheckedChange={v => updatePlayerSetting(player.id, { fade: v })}
                                          data-testid={`fade-${player.id}`}
                                        />
                                      </div>

                                      {/* Scout signals for this player */}
                                      {player._signals.length > 0 && (
                                        <div className="space-y-1.5">
                                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                            <Zap className="w-3 h-3 text-emerald-400" /> Scout Signals
                                          </p>
                                          {player._signals.map((sig, si) => {
                                            const meta = SIGNAL_META[sig.signal_type] || SIGNAL_META["hot_streak"];
                                            const boost = BOOST_WEIGHTS[sig.signal_type] || 0;
                                            return (
                                              <div key={si} className={`rounded-lg px-2.5 py-1.5 border flex items-start justify-between gap-2 ${meta.colorClass}`}>
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-center gap-1.5 mb-0.5">
                                                    <span className="text-[10px] font-black">{meta.icon} {meta.label}</span>
                                                    <span className="text-[9px] opacity-70">{Math.round(sig.confidence * 100)}% conf</span>
                                                  </div>
                                                  <p className="text-[11px] opacity-80 leading-snug">{sig.reason}</p>
                                                  {sig.beneficiary_names && sig.beneficiary_names.length > 0 && (
                                                    <p className="text-[10px] mt-0.5 opacity-70">↗ {sig.beneficiary_names.join(", ")}</p>
                                                  )}
                                                </div>
                                                <div className="text-right shrink-0">
                                                  <span className={`text-xs font-black tabular-nums ${boost > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                    {boost > 0 ? "+" : ""}{boost.toFixed(1)}
                                                  </span>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
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
                  <button
                    onClick={() => setShowConfig(c => !c)}
                    className="w-full flex items-center justify-between text-sm font-bold text-slate-300 hover:text-white transition-colors"
                    data-testid="toggle-config"
                  >
                    <div className="flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-amber-400/70" />
                      <span className="text-xs">Optimizer Settings</span>
                      {anyActiveConfig && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                    </div>
                    {showConfig ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                  </button>

                  {showConfig && (
                    <div className="space-y-4 mt-3 pt-3 border-t border-slate-800/60">

                      {/* Projection mode */}
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
                        {/* Leverage */}
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

                        {/* AI Boosts */}
                        <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${isPaidUser ? "bg-slate-800/40" : "bg-slate-800/20 opacity-60"}`}>
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-emerald-400" />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-bold text-white">AI Scout Boosts</p>
                                {!isPaidUser && <span className="text-[9px] font-black text-amber-400/80 bg-amber-500/10 px-1 py-0.5 rounded">PRO</span>}
                                {scoutSignals.length > 0 && isPaidUser && (
                                  <span className="text-[9px] font-black text-emerald-400/80 bg-emerald-500/10 px-1 py-0.5 rounded">
                                    {scoutSignals.length} signals
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500">
                                {scoutLoading ? "Fetching signals..." : `Scout projection adjustments from live news`}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={useBoosts}
                            onCheckedChange={isPaidUser ? setUseBoosts : undefined}
                            disabled={!isPaidUser}
                            data-testid="toggle-boosts"
                          />
                        </div>
                      </div>

                      {/* Scout signal summary (when boosts enabled) */}
                      {useBoosts && scoutSignals.length > 0 && (
                        <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
                          <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Activity className="w-3 h-3" /> Active Scout Signals — {sport}
                          </p>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {scoutSignals.slice(0, 10).map((sig, i) => {
                              const meta = SIGNAL_META[sig.signal_type] || SIGNAL_META["hot_streak"];
                              const boost = BOOST_WEIGHTS[sig.signal_type] || 0;
                              return (
                                <div key={i} className="flex items-start gap-2">
                                  <span className={`text-[9px] font-black px-1 py-0.5 rounded border shrink-0 ${meta.colorClass}`}>
                                    {meta.icon} {meta.label}
                                  </span>
                                  <span className="text-[11px] text-slate-300 flex-1 leading-snug">{sig.player_name} — {sig.reason}</span>
                                  <span className={`text-[10px] font-black shrink-0 ${boost > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {boost > 0 ? "+" : ""}{boost.toFixed(1)}
                                  </span>
                                </div>
                              );
                            })}
                            {scoutSignals.length > 10 && (
                              <p className="text-[10px] text-slate-600 text-center">+{scoutSignals.length - 10} more signals</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Salary range */}
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

                      {/* Max exposure (multi-lineup) */}
                      {lineupCount > 1 && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Shuffle className="w-3.5 h-3.5 text-slate-500" />
                              <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Global Max Exposure</span>
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
                            {globalMaxExposure ? `No player appears in more than ${globalMaxExposure}% of lineups` : "Drag left to cap player frequency"}
                          </p>
                        </div>
                      )}

                      {/* Per-player settings summary */}
                      {customizedCount > 0 && (
                        <div className="rounded-lg border border-purple-900/40 bg-purple-950/20 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-black text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Settings2 className="w-3 h-3" /> Per-Player Settings ({customizedCount})
                            </p>
                            <button
                              onClick={() => setPlayerSettings({})}
                              className="text-[10px] text-slate-600 hover:text-red-400 flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" /> Clear all
                            </button>
                          </div>
                          <div className="space-y-1">
                            {Object.entries(playerSettings).map(([pid, pset]) => {
                              const p = players.find(pl => String(pl.id) === pid);
                              if (!p) return null;
                              const chips = [];
                              if (pset.customProjection !== undefined) chips.push(`proj: ${pset.customProjection}`);
                              if (pset.customOwnership !== undefined) chips.push(`own: ${pset.customOwnership}%`);
                              if (pset.maxExposure !== undefined) chips.push(`max: ${pset.maxExposure}%`);
                              if (pset.fade) chips.push("faded");
                              return (
                                <div key={pid} className="flex items-center justify-between text-[10px]">
                                  <span className="text-slate-300 font-bold truncate">{p.name}</span>
                                  <div className="flex gap-1 flex-wrap justify-end">
                                    {chips.map((c, ci) => (
                                      <span key={ci} className="text-purple-300 bg-purple-500/10 border border-purple-500/20 rounded px-1 py-0.5 font-bold">
                                        {c}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Active config chips ── */}
              {anyActiveConfig && (
                <div className="flex flex-wrap gap-1.5 mt-2" data-testid="active-config-chips">
                  {projectionMode === "ceiling" && <span className="text-[10px] font-black bg-purple-500/15 border border-purple-500/25 text-purple-300 px-2 py-1 rounded-lg">🚀 Ceiling</span>}
                  {leverageMode && <span className="text-[10px] font-black bg-amber-500/15 border border-amber-500/25 text-amber-300 px-2 py-1 rounded-lg flex items-center gap-1"><Target className="w-3 h-3" />Leverage</span>}
                  {useBoosts && <span className="text-[10px] font-black bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 px-2 py-1 rounded-lg flex items-center gap-1"><Zap className="w-3 h-3" />Scout Active</span>}
                  {globalMaxExposure && <span className="text-[10px] font-black bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 px-2 py-1 rounded-lg flex items-center gap-1"><Shuffle className="w-3 h-3" />Max {globalMaxExposure}%</span>}
                  {salaryRange && <span className="text-[10px] font-black bg-slate-700/60 border border-slate-600/40 text-slate-300 px-2 py-1 rounded-lg flex items-center gap-1"><DollarSign className="w-3 h-3" />${(salaryRange[0]/1000).toFixed(1)}K–${(salaryRange[1]/1000).toFixed(1)}K</span>}
                  {customizedCount > 0 && <span className="text-[10px] font-black bg-purple-500/15 border border-purple-500/25 text-purple-300 px-2 py-1 rounded-lg flex items-center gap-1"><Settings2 className="w-3 h-3" />{customizedCount} customized</span>}
                </div>
              )}

              {/* ── Generate / Reset ── */}
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
                  onClick={resetAll}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800"
                  data-testid="btn-clear-locks"
                >
                  <RefreshCw className="w-4 h-4 mr-1" /> Reset All
                </Button>
              </div>
            </div>

            {/* ── RIGHT: Generated Lineup ── */}
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
                          <Button variant="ghost" size="sm" onClick={() => setActiveLineupIdx(Math.max(0, activeLineupIdx - 1))} disabled={activeLineupIdx === 0} className="h-7 w-7 p-0 text-slate-400" data-testid="btn-prev-lineup">
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <span className="text-xs text-slate-400 font-bold" data-testid="lineup-counter">{activeLineupIdx + 1} / {generatedLineups.length}</span>
                          <Button variant="ghost" size="sm" onClick={() => setActiveLineupIdx(Math.min(generatedLineups.length - 1, activeLineupIdx + 1))} disabled={activeLineupIdx === generatedLineups.length - 1} className="h-7 w-7 p-0 text-slate-400" data-testid="btn-next-lineup">
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">

                    {/* Exposure bar */}
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
                              const perCap = playerSettings[id]?.maxExposure;
                              const overPer = perCap !== undefined && pct > perCap;
                              return (
                                <div key={id} className="flex items-center gap-2">
                                  <span className="text-[10px] text-white font-bold flex-1 truncate">{d.name}</span>
                                  <span className="text-[10px] font-mono text-slate-500">{d.count}/{generatedLineups.length}</span>
                                  <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${over || overPer ? "bg-red-400" : "bg-cyan-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                                  </div>
                                  <span className={`text-[10px] font-black w-8 text-right ${over || overPer ? "text-red-400" : "text-cyan-400"}`}>{pct}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Captain slot */}
                    <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-3" data-testid="captain-slot">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[10px] font-black">{captainLabel}</Badge>
                        <Badge variant="outline" className="border-amber-500/30 text-amber-300 text-[10px]">{captainMultiplier}x</Badge>
                        {/* Scout badge on captain */}
                        {(() => {
                          const sig = signalByName[activeLineup.captain.name.toLowerCase()]?.[0];
                          if (!sig) return null;
                          const meta = SIGNAL_META[sig.signal_type];
                          if (!meta) return null;
                          return (
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${meta.colorClass}`}>
                              {meta.icon} {meta.label}
                            </span>
                          );
                        })()}
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

                    {/* Flex slots */}
                    {activeLineup.flexPlayers.map((player, i) => {
                      const sig = signalByName[player.name.toLowerCase()]?.[0];
                      const meta = sig ? SIGNAL_META[sig.signal_type] : null;
                      return (
                        <div key={player.id} className="rounded-lg border border-slate-700 bg-slate-800/40 p-3" data-testid={`flex-slot-${i}`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="border-slate-600 text-slate-400 text-[10px]">{flexLabel}</Badge>
                                <span className="text-white font-medium text-sm">{player.name}</span>
                                {meta && (
                                  <span className={`text-[9px] font-black px-1 py-0.5 rounded border ${meta.colorClass}`}>
                                    {meta.icon} {meta.label}
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-400 text-xs mt-0.5">{player.position} &middot; {player.team}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-emerald-400 font-bold text-sm">{toNum(player.effectiveProjection).toFixed(1)} pts</div>
                              <div className="text-slate-400 text-xs">${toNum(player.effectiveSalary).toLocaleString()}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Totals */}
                    <div className="border-t border-slate-700 pt-3 mt-3">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <div className="text-lg font-black text-amber-400" data-testid="lineup-total-proj">{activeLineup.totalProjectedPoints.toFixed(1)}</div>
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

                    {/* Save / Export */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        onClick={() => saveMut.mutate(activeLineup)}
                        disabled={saveMut.isPending || savedLineupIndices.has(activeLineupIdx)}
                        className={`flex-1 font-bold ${savedLineupIndices.has(activeLineupIdx) ? "bg-emerald-700/30 border border-emerald-500/30 text-emerald-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
                        data-testid="btn-save-showdown"
                      >
                        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : savedLineupIndices.has(activeLineupIdx) ? "✓ Saved" : <><Save className="w-4 h-4 mr-1" />Save</>}
                      </Button>
                      <Button variant="outline" onClick={exportCSV} className="border-slate-600 text-slate-300 hover:bg-slate-800" data-testid="btn-export-csv">
                        <Download className="w-4 h-4 mr-1" />CSV
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

                    {/* Scout teaser when no lineup generated */}
                    {scoutSignals.length > 0 && (
                      <div className="mt-4 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3 text-left">
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Zap className="w-3 h-3" /> {scoutSignals.length} Scout Signals Ready
                        </p>
                        {scoutSignals.slice(0, 3).map((sig, i) => {
                          const meta = SIGNAL_META[sig.signal_type] || SIGNAL_META["hot_streak"];
                          return (
                            <div key={i} className="flex items-center gap-2 mb-1">
                              <span className={`text-[9px] font-black px-1 rounded border ${meta.colorClass}`}>{meta.icon}</span>
                              <span className="text-[11px] text-slate-300">{sig.player_name} — {sig.reason.slice(0, 60)}{sig.reason.length > 60 ? "…" : ""}</span>
                            </div>
                          );
                        })}
                        {!isPaidUser && (
                          <p className="text-[10px] text-amber-400/70 mt-2">Upgrade to PRO to apply Scout boosts automatically.</p>
                        )}
                      </div>
                    )}
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
