import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Crown, Lock, LockOpen, Ban, RotateCcw, Search, Loader2, Settings2, ArrowUpDown, Pencil, X, Save, Rocket, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Slate, Player, PlayerOverride } from "@shared/schema";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { usePageMeta } from "@/hooks/use-page-meta";

const SPORT_COLORS: Record<string, { accent: string; bg: string; border: string; tab: string }> = {
  NBA: { accent: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", tab: "bg-orange-500" },
  NHL: { accent: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", tab: "bg-cyan-500" },
  MLB: { accent: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", tab: "bg-red-500" },
  NFL: { accent: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", tab: "bg-green-500" },
  GOLF: { accent: "text-lime-400", bg: "bg-lime-500/10", border: "border-lime-500/20", tab: "bg-lime-500" },
  SOCCER: { accent: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20", tab: "bg-teal-500" },
};

const INJURY_COLORS: Record<string, string> = {
  OUT: "border-red-500/40 text-red-400 bg-red-500/10",
  Questionable: "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
  Doubtful: "border-orange-500/40 text-orange-400 bg-orange-500/10",
  Probable: "border-green-500/40 text-green-400 bg-green-500/10",
  "Day-to-Day": "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
};

const BOOST_LEVELS = [0, 5, 10, 15, 20];

type SortField = "name" | "position" | "salary" | "projectedPoints" | "fppg" | "value" | "override";
type SortDir = "asc" | "desc";

export default function PlayerConfig() {
  usePageMeta({ title: "Player Configuration - Custom Projections", description: "Customize player projections, lock players, and set exclusions for lineup optimization.", path: "/player-config" });
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedSport, setSelectedSport] = useState("NBA");
  const [selectedPlatform, setSelectedPlatform] = useState("draftkings");
  const [selectedSlateId, setSelectedSlateId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("salary");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editingPlayer, setEditingPlayer] = useState<number | null>(null);
  const [editProjection, setEditProjection] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("ALL");

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const isPro = subData?.tier === "pro" || subData?.tier === "premium";
  const isStar = subData?.tier === "star";
  const hasPaidAccess = isPro || isStar || user?.isAdmin;

  const { data: slates } = useQuery<Slate[]>({
    queryKey: ["/api/slates", "config"],
    queryFn: async () => {
      const res = await fetch("/api/slates?includeStarted=true");
      if (!res.ok) throw new Error("Failed to fetch slates");
      return res.json();
    },
    enabled: !!user,
  });

  const allSlates = slates || [];
  const sportSlates = allSlates.filter(s => s.sport === selectedSport);
  const platformOrder = ["draftkings", "fanduel", "yahoo"];
  const availablePlatforms = [...new Set(sportSlates.map(s => s.platform))].sort(
    (a, b) => platformOrder.indexOf(a) - platformOrder.indexOf(b)
  );
  const mainSlate = sportSlates.find(s => s.platform === selectedPlatform && s.isMain)
    || sportSlates.find(s => s.platform === "draftkings" && s.isMain)
    || sportSlates.find(s => s.isMain)
    || sportSlates[0];
  const slateId = mainSlate?.id;

  const platformSlates = useMemo(() => {
    return sportSlates
      .filter(s => s.platform === selectedPlatform && s.isActive !== false)
      .sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0));
  }, [sportSlates, selectedPlatform]);

  const isSlateFiltered = selectedSlateId !== "all";
  const numericSlateId = isSlateFiltered ? Number(selectedSlateId) : null;

  const { data: allPlayersData, isLoading: allPlayersLoading } = useQuery<{ players: Player[]; mainSlateId: number }>({
    queryKey: ["/api/players/all", selectedSport, selectedPlatform],
    queryFn: async () => {
      const res = await fetch(`/api/players/all/${selectedSport}?platform=${selectedPlatform}`);
      if (!res.ok) throw new Error("Failed to fetch players");
      return res.json();
    },
    enabled: !!selectedSport && !!user,
  });

  const { data: slatePlayersData, isLoading: slatePlayersLoading } = useQuery<Player[]>({
    queryKey: ["/api/slates", numericSlateId, "players"],
    queryFn: async () => {
      const res = await fetch(`/api/slates/${numericSlateId}/players`);
      if (!res.ok) throw new Error("Failed to fetch slate players");
      return res.json();
    },
    enabled: isSlateFiltered && !!numericSlateId && !!user,
  });

  const playersLoading = isSlateFiltered ? slatePlayersLoading : allPlayersLoading;
  const players = isSlateFiltered ? slatePlayersData : allPlayersData?.players;
  const effectiveSlateId = allPlayersData?.mainSlateId ?? slateId;

  const { data: overrides, isLoading: overridesLoading } = useQuery<PlayerOverride[]>({
    queryKey: ["/api/player-overrides", effectiveSlateId],
    queryFn: async () => {
      const res = await fetch(`/api/player-overrides/${effectiveSlateId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!effectiveSlateId && hasPaidAccess,
  });

  const dkIdToMainPlayerId = useMemo(() => {
    const map = new Map<number, number>();
    if (allPlayersData?.players) {
      for (const p of allPlayersData.players) {
        if ((p as any).draftKingsPlayerId) {
          map.set((p as any).draftKingsPlayerId, p.id);
        }
      }
    }
    return map;
  }, [allPlayersData]);

  const overrideMap = useMemo(() => {
    const map = new Map<number, PlayerOverride>();
    overrides?.forEach(o => map.set(o.playerId, o));
    return map;
  }, [overrides]);

  function resolveOverride(player: Player): PlayerOverride | undefined {
    const direct = overrideMap.get(player.id);
    if (direct) return direct;
    if (isSlateFiltered && (player as any).draftKingsPlayerId) {
      const mainId = dkIdToMainPlayerId.get((player as any).draftKingsPlayerId);
      if (mainId) return overrideMap.get(mainId);
    }
    return undefined;
  }

  function resolveMainPlayerId(player: Player): number {
    if (!isSlateFiltered) return player.id;
    if ((player as any).draftKingsPlayerId) {
      const mainId = dkIdToMainPlayerId.get((player as any).draftKingsPlayerId);
      if (mainId) return mainId;
    }
    return player.id;
  }

  const overrideCount = overrides?.length || 0;

  const upsertMutation = useMutation({
    mutationFn: async ({ playerId, data, dkPlayerId }: { playerId: number; data: any; dkPlayerId?: number }) => {
      const body = dkPlayerId ? { ...data, dkPlayerId } : data;
      const res = await apiRequest("PUT", `/api/player-overrides/${effectiveSlateId}/${playerId}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-overrides", effectiveSlateId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (playerId: number) => {
      await apiRequest("DELETE", `/api/player-overrides/${effectiveSlateId}/${playerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-overrides", effectiveSlateId] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/player-overrides/${effectiveSlateId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-overrides", effectiveSlateId] });
      toast({ title: "All overrides cleared", description: "Player settings have been reset to defaults." });
    },
  });

  const positions = useMemo(() => {
    if (!players) return [];
    const posSet = new Set<string>();
    players.forEach(p => p.position.split("/").forEach(pos => posSet.add(pos)));
    return Array.from(posSet).sort();
  }, [players]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    let filtered = players.map(p => {
      const val = p.salary > 0 ? Number(p.projectedPoints) / (p.salary / 1000) : 0;
      return { ...p, value: val };
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q)
      );
    }

    if (positionFilter !== "ALL") {
      filtered = filtered.filter(p => p.position.includes(positionFilter));
    }

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "position": cmp = a.position.localeCompare(b.position); break;
        case "salary": cmp = a.salary - b.salary; break;
        case "projectedPoints": cmp = Number(a.projectedPoints) - Number(b.projectedPoints); break;
        case "fppg": cmp = Number(a.fppg) - Number(b.fppg); break;
        case "value": cmp = a.value - b.value; break;
        case "override": {
          const aHas = resolveOverride(a) ? 1 : 0;
          const bHas = resolveOverride(b) ? 1 : 0;
          cmp = aHas - bHas;
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return filtered;
  }, [players, searchQuery, positionFilter, sortField, sortDir, overrideMap]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function getOverrideData(player: Player) {
    const existing = resolveOverride(player);
    return {
      customProjection: existing?.customProjection != null ? Number(existing.customProjection) : null,
      boostPercent: existing?.boostPercent || 0,
      isExcluded: existing?.isExcluded || false,
      isLocked: existing?.isLocked || false,
      minExposure: existing?.minExposure ?? null,
      maxExposure: existing?.maxExposure ?? null,
      notes: existing?.notes || null,
    };
  }

  function handleExposureChange(player: Player, field: "minExposure" | "maxExposure", value: string) {
    const d = getOverrideData(player);
    const parsed = value === "" ? null : parseInt(value, 10);
    if (parsed !== null && (isNaN(parsed) || parsed < 0 || parsed > 100)) return;
    if (field === "minExposure" && parsed !== null && d.maxExposure !== null && parsed > d.maxExposure) {
      toast({ title: "Invalid", description: "Min exposure cannot exceed max exposure.", variant: "destructive" });
      return;
    }
    if (field === "maxExposure" && parsed !== null && d.minExposure !== null && parsed < d.minExposure) {
      toast({ title: "Invalid", description: "Max exposure cannot be less than min exposure.", variant: "destructive" });
      return;
    }
    upsertMutation.mutate({ playerId: resolveMainPlayerId(player), data: { ...d, [field]: parsed }, dkPlayerId: (player as any).draftKingsPlayerId || undefined });
  }

  function handleToggleExclude(player: Player) {
    const d = getOverrideData(player);
    const newExcluded = !d.isExcluded;
    upsertMutation.mutate({
      playerId: resolveMainPlayerId(player),
      data: { ...d, isExcluded: newExcluded, isLocked: newExcluded ? false : d.isLocked },
      dkPlayerId: (player as any).draftKingsPlayerId || undefined,
    });
  }

  function handleToggleLock(player: Player) {
    const d = getOverrideData(player);
    const newLocked = !d.isLocked;
    upsertMutation.mutate({
      playerId: resolveMainPlayerId(player),
      data: { ...d, isLocked: newLocked, isExcluded: newLocked ? false : d.isExcluded },
      dkPlayerId: (player as any).draftKingsPlayerId || undefined,
    });
  }

  function handleCycleBoost(player: Player) {
    const d = getOverrideData(player);
    const currentIdx = BOOST_LEVELS.indexOf(d.boostPercent);
    const nextBoost = BOOST_LEVELS[(currentIdx + 1) % BOOST_LEVELS.length];
    upsertMutation.mutate({
      playerId: resolveMainPlayerId(player),
      data: { ...d, boostPercent: nextBoost },
      dkPlayerId: (player as any).draftKingsPlayerId || undefined,
    });
  }

  function handleSaveProjection(player: Player) {
    const val = editProjection.trim();
    const d = getOverrideData(player);
    const mainPid = resolveMainPlayerId(player);
    if (val === "" || val === player.projectedPoints) {
      upsertMutation.mutate({ playerId: mainPid, data: { ...d, customProjection: null }, dkPlayerId: (player as any).draftKingsPlayerId || undefined });
    } else {
      const num = parseFloat(val);
      if (isNaN(num) || num < 0) {
        toast({ title: "Invalid projection", description: "Please enter a valid number.", variant: "destructive" });
        return;
      }
      upsertMutation.mutate({ playerId: mainPid, data: { ...d, customProjection: num }, dkPlayerId: (player as any).draftKingsPlayerId || undefined });
    }
    setEditingPlayer(null);
    setEditProjection("");
  }

  function handleRemoveOverride(player: Player) {
    deleteMutation.mutate(resolveMainPlayerId(player));
  }

  function getEffectiveProjection(player: Player, override: PlayerOverride | undefined): number {
    let proj = override?.customProjection != null ? Number(override.customProjection) : Number(player.projectedPoints);
    if (override?.boostPercent && override.boostPercent > 0) {
      proj = Math.round(proj * (1 + override.boostPercent / 100) * 10) / 10;
    }
    return proj;
  }

  const colors = SPORT_COLORS[selectedSport] || SPORT_COLORS.NBA;

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <Card className="p-8 bg-slate-900/80 border-slate-700 text-center max-w-md">
          <Lock className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Sign In Required</h2>
          <p className="text-slate-400 mb-4">Please sign in to access player configuration.</p>
          <Link href="/login">
            <Button className="bg-emerald-600 hover:bg-emerald-700" data-testid="login-button">Sign In</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (!hasPaidAccess) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <Card className="p-8 bg-slate-900/80 border-slate-700 text-center max-w-md">
          <Crown className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Upgrade Required</h2>
          <p className="text-slate-400 mb-4">Player Configuration is available for Sharpshooter and Champion subscribers.</p>
          <Link href="/pricing">
            <Button className="bg-amber-600 hover:bg-amber-700" data-testid="upgrade-button">View Plans</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2" data-testid="page-title">
              <Settings2 className="w-6 h-6 text-emerald-400" />
              Player Configuration
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Customize projections, boosts, lock or exclude players. Changes apply to both optimizers and reset with each slate refresh.
            </p>
          </div>
          {overrideCount > 0 && (
            <div className="flex items-center gap-3">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30" data-testid="override-count">
                {overrideCount} override{overrideCount !== 1 ? "s" : ""}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                onClick={() => clearAllMutation.mutate()}
                disabled={clearAllMutation.isPending}
                data-testid="clear-all-overrides"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset All
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {ACTIVE_SPORTS.map(sport => {
            const sc = SPORT_COLORS[sport];
            const hasSlate = allSlates.some(s => s.sport === sport);
            return (
              <button
                key={sport}
                onClick={() => { setSelectedSport(sport); setSelectedPlatform("draftkings"); setSelectedSlateId("all"); setSearchQuery(""); setPositionFilter("ALL"); }}
                disabled={!hasSlate}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  selectedSport === sport
                    ? `${sc?.tab || "bg-emerald-500"} text-white shadow-lg`
                    : hasSlate
                      ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      : "bg-slate-800/50 text-slate-600 cursor-not-allowed"
                }`}
                data-testid={`sport-tab-${sport}`}
              >
                {sport}
              </button>
            );
          })}
        </div>

        {availablePlatforms.length > 1 && (
          <div className="flex gap-2 mb-4">
            {availablePlatforms.map(plat => {
              const label = plat === "draftkings" ? "DraftKings" : plat === "fanduel" ? "FanDuel" : "Yahoo";
              const isActive = (mainSlate?.platform || selectedPlatform) === plat;
              return (
                <button
                  key={plat}
                  onClick={() => { setSelectedPlatform(plat); setSelectedSlateId("all"); }}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition ${
                    isActive ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                  data-testid={`platform-tab-${plat}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {platformSlates.length > 1 && mainSlate && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Slate:</span>
            <select
              value={selectedSlateId}
              onChange={e => setSelectedSlateId(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white text-xs rounded px-3 py-1.5 max-w-xs truncate focus:outline-none focus:ring-1 focus:ring-emerald-500"
              data-testid="slate-selector"
            >
              <option value="all">All Players</option>
              {platformSlates.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}{s.isMain ? " (Main)" : ""}
                </option>
              ))}
            </select>
            {isSlateFiltered && (
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs" data-testid="slate-filter-badge">
                Filtered
              </Badge>
            )}
          </div>
        )}

        {!mainSlate ? (
          <Card className="p-8 bg-slate-900/50 border-slate-700 text-center">
            <p className="text-slate-400">No active slate for {selectedSport}</p>
          </Card>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  placeholder="Search by name or team..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 bg-slate-800 border-slate-700 text-white"
                  data-testid="search-players"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setPositionFilter("ALL")}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition ${
                    positionFilter === "ALL" ? `${colors.tab} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                  data-testid="filter-all"
                >
                  ALL
                </button>
                {positions.map(pos => (
                  <button
                    key={pos}
                    onClick={() => setPositionFilter(pos)}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition ${
                      positionFilter === pos ? `${colors.tab} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                    data-testid={`filter-${pos}`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {playersLoading || overridesLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
              </div>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-700">
                  <table className="w-full" data-testid="players-table">
                    <thead>
                      <tr className="bg-slate-800/80">
                        {([
                          { key: "name" as SortField, label: "Player" },
                          { key: "position" as SortField, label: "Pos" },
                          { key: "salary" as SortField, label: "Salary" },
                          { key: "fppg" as SortField, label: "FPPG" },
                          { key: "projectedPoints" as SortField, label: "Projection" },
                          { key: "value" as SortField, label: "Value" },
                        ]).map(col => (
                          <th
                            key={col.key}
                            className="px-3 py-3 text-left text-xs font-bold text-slate-400 uppercase cursor-pointer hover:text-white transition"
                            onClick={() => handleSort(col.key)}
                            data-testid={`sort-${col.key}`}
                          >
                            <div className="flex items-center gap-1">
                              {col.label}
                              {sortField === col.key && <ArrowUpDown className="w-3 h-3" />}
                            </div>
                          </th>
                        ))}
                        <th className="px-3 py-3 text-left text-xs font-bold text-cyan-400 uppercase hidden lg:table-cell">Avg</th>
                        <th className="px-3 py-3 text-center text-xs font-bold text-slate-400 uppercase">Boost</th>
                        <th className="px-3 py-3 text-center text-xs font-bold text-slate-400 uppercase">Custom Proj</th>
                        <th className="px-3 py-3 text-center text-xs font-bold text-emerald-400 uppercase">Min%</th>
                        <th className="px-3 py-3 text-center text-xs font-bold text-cyan-400 uppercase">Max%</th>
                        <th className="px-3 py-3 text-center text-xs font-bold text-slate-400 uppercase">Status</th>
                        <th className="px-3 py-3 text-center text-xs font-bold text-slate-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredPlayers.map(player => {
                        const override = resolveOverride(player);
                        const hasOverride = !!override;
                        const isEditing = editingPlayer === player.id;
                        const boostPct = override?.boostPercent || 0;
                        const effectiveProj = getEffectiveProjection(player, override);

                        return (
                          <tr
                            key={player.id}
                            className={`transition ${
                              override?.isExcluded
                                ? "bg-red-500/5 opacity-60"
                                : override?.isLocked
                                  ? "bg-emerald-500/5"
                                  : hasOverride
                                    ? "bg-amber-500/5"
                                    : "hover:bg-slate-800/50"
                            }`}
                            data-testid={`player-row-${player.id}`}
                          >
                            <td className="px-3 py-2.5">
                              <div className="flex flex-col">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-white font-medium text-sm">{player.name}</span>
                                  {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                                    <Badge variant="outline" className={`text-[9px] font-bold py-0 px-1.5 ${INJURY_COLORS[player.injuryStatus] || INJURY_COLORS["Day-to-Day"]}`}>
                                      {player.injuryStatus}
                                    </Badge>
                                  )}
                                </div>
                                <span className="text-slate-500 text-xs">{player.team} {player.opponent ? `vs ${player.opponent}` : ""} · {player.gameInfo}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">{player.position}</Badge>
                            </td>
                            <td className="px-3 py-2.5 text-white text-sm font-mono font-bold">${player.salary?.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs font-mono">{player.fppg}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-col items-start">
                                <span className="text-emerald-400 text-sm font-mono font-bold">{Number(player.projectedPoints).toFixed(1)}</span>
                                {(override?.customProjection != null || boostPct > 0) && (
                                  <span className="text-amber-400 text-[10px] font-bold font-mono" data-testid={`effective-proj-${player.id}`}>
                                    → {effectiveProj.toFixed(1)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-blue-400 text-xs font-mono font-bold">{player.value.toFixed(1)}x</td>
                            <td className="px-3 py-2.5 hidden lg:table-cell">
                              {(player as any).recentActualAvg != null ? (
                                <div className="flex flex-col">
                                  <span className="font-mono text-xs font-bold text-cyan-400" data-testid={`config-actual-avg-${player.id}`}>{(player as any).recentActualAvg}</span>
                                  <span className="text-[9px] text-slate-500">{(player as any).gamesTracked}g</span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button
                                onClick={() => handleCycleBoost(player)}
                                className={`relative p-1.5 rounded-md transition-all ${
                                  boostPct > 0
                                    ? "bg-amber-500/20 text-amber-400 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/30"
                                    : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"
                                }`}
                                title={boostPct > 0 ? `Boosted +${boostPct}% — click to change` : "Boost player projection"}
                                data-testid={`boost-${player.id}`}
                              >
                                <Rocket className={`w-3.5 h-3.5 ${boostPct > 0 ? "fill-amber-400" : ""}`} />
                                {boostPct > 0 && (
                                  <span className="absolute -top-1.5 -right-2 text-[9px] font-black text-amber-300 bg-amber-950 rounded px-0.5">
                                    +{boostPct}%
                                  </span>
                                )}
                              </button>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {isEditing ? (
                                <div className="flex items-center gap-1 justify-center">
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={editProjection}
                                    onChange={e => setEditProjection(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") handleSaveProjection(player);
                                      if (e.key === "Escape") { setEditingPlayer(null); setEditProjection(""); }
                                    }}
                                    className="w-20 h-7 text-xs bg-slate-800 border-slate-600 text-white text-right font-mono"
                                    autoFocus
                                    data-testid={`edit-projection-input-${player.id}`}
                                  />
                                  <button onClick={() => handleSaveProjection(player)} className="text-emerald-400 hover:text-emerald-300" data-testid={`save-projection-${player.id}`}>
                                    <Save className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => { setEditingPlayer(null); setEditProjection(""); }} className="text-slate-500 hover:text-slate-300">
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 justify-center">
                                  {override?.customProjection != null ? (
                                    <span className="text-amber-400 font-mono text-sm font-bold" data-testid={`custom-proj-${player.id}`}>
                                      {Number(override.customProjection).toFixed(1)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-600 text-sm">—</span>
                                  )}
                                  <button
                                    onClick={() => {
                                      setEditingPlayer(player.id);
                                      setEditProjection(override?.customProjection != null ? override.customProjection : player.projectedPoints);
                                    }}
                                    className="text-slate-500 hover:text-white ml-1"
                                    data-testid={`edit-projection-${player.id}`}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                placeholder="—"
                                value={override?.minExposure ?? ""}
                                onChange={e => handleExposureChange(player, "minExposure", e.target.value)}
                                className="w-16 h-7 text-xs bg-slate-800 border-emerald-500/30 text-emerald-400 text-center font-mono"
                                data-testid={`min-exposure-${player.id}`}
                              />
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                placeholder="—"
                                value={override?.maxExposure ?? ""}
                                onChange={e => handleExposureChange(player, "maxExposure", e.target.value)}
                                className="w-16 h-7 text-xs bg-slate-800 border-cyan-500/30 text-cyan-400 text-center font-mono"
                                data-testid={`max-exposure-${player.id}`}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1 justify-center">
                                {override?.isLocked && (
                                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">LOCKED</Badge>
                                )}
                                {override?.isExcluded && (
                                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">EXCLUDED</Badge>
                                )}
                                {!override?.isLocked && !override?.isExcluded && (
                                  <span className="text-slate-600 text-xs">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => handleToggleLock(player)}
                                  className={`p-1.5 rounded transition ${
                                    override?.isLocked
                                      ? "bg-emerald-500/20 text-emerald-400"
                                      : "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10"
                                  }`}
                                  title={override?.isLocked ? "Unlock player" : "Lock player into lineup"}
                                  data-testid={`toggle-lock-${player.id}`}
                                >
                                  {override?.isLocked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => handleToggleExclude(player)}
                                  className={`p-1.5 rounded transition ${
                                    override?.isExcluded
                                      ? "bg-red-500/20 text-red-400"
                                      : "text-slate-600 hover:text-red-400 hover:bg-red-500/10"
                                  }`}
                                  title={override?.isExcluded ? "Include player" : "Exclude from lineup"}
                                  data-testid={`toggle-exclude-${player.id}`}
                                >
                                  {override?.isExcluded ? <X className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                                </button>
                                {hasOverride && (
                                  <button
                                    onClick={() => handleRemoveOverride(player)}
                                    className="p-1.5 rounded text-slate-600 hover:text-amber-400 hover:bg-amber-500/10 transition"
                                    title="Reset to original settings"
                                    data-testid={`remove-override-${player.id}`}
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden space-y-2">
                  {filteredPlayers.map(player => {
                    const override = resolveOverride(player);
                    const hasOverride = !!override;
                    const isEditing = editingPlayer === player.id;
                    const boostPct = override?.boostPercent || 0;
                    const effectiveProj = getEffectiveProjection(player, override);

                    return (
                      <Card
                        key={player.id}
                        className={`p-3 border-slate-700 ${
                          override?.isExcluded
                            ? "bg-red-500/5 border-red-500/20 opacity-60"
                            : override?.isLocked
                              ? "bg-emerald-500/5 border-emerald-500/20"
                              : hasOverride
                                ? "bg-amber-500/5 border-amber-500/20"
                                : "bg-slate-900/50"
                        }`}
                        data-testid={`player-card-${player.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-medium text-sm">{player.name}</span>
                              <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 shrink-0">{player.position}</Badge>
                              {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                                <Badge variant="outline" className={`text-[9px] font-bold py-0 px-1 ${INJURY_COLORS[player.injuryStatus] || INJURY_COLORS["Day-to-Day"]}`}>
                                  {player.injuryStatus}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                              <span>{player.team} {player.opponent ? `vs ${player.opponent}` : ""}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-xs">
                              <span className="font-mono text-white font-bold">${player.salary?.toLocaleString()}</span>
                              <span className="font-mono text-slate-400">FPPG {player.fppg}</span>
                              <span className="font-mono text-emerald-400 font-bold">{Number(player.projectedPoints).toFixed(1)} pts</span>
                              {(player as any).recentActualAvg != null && (
                                <span className="font-mono text-cyan-400 font-bold">{(player as any).recentActualAvg}<span className="text-slate-500">/{(player as any).gamesTracked}g</span></span>
                              )}
                              <span className="font-mono text-blue-400 font-bold">{player.value.toFixed(1)}x</span>
                            </div>
                            {(override?.customProjection != null || boostPct > 0) && (
                              <div className="flex items-center gap-2 mt-1 text-xs">
                                <span className="text-amber-400 font-bold font-mono" data-testid={`mobile-effective-proj-${player.id}`}>
                                  → {effectiveProj.toFixed(1)} pts
                                </span>
                                {override?.customProjection != null && (
                                  <span className="text-slate-500">(custom: {Number(override.customProjection).toFixed(1)})</span>
                                )}
                                {boostPct > 0 && (
                                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[9px] py-0">+{boostPct}%</Badge>
                                )}
                              </div>
                            )}
                            {(override?.minExposure != null || override?.maxExposure != null) && (
                              <div className="flex items-center gap-2 mt-1 text-xs">
                                {override?.minExposure != null && (
                                  <span className="text-emerald-400 font-mono font-bold">Min {override.minExposure}%</span>
                                )}
                                {override?.maxExposure != null && (
                                  <span className="text-cyan-400 font-mono font-bold">Max {override.maxExposure}%</span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleCycleBoost(player)}
                              className={`relative p-1.5 rounded-md transition-all ${
                                boostPct > 0
                                  ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30"
                                  : "text-slate-600 hover:text-amber-400"
                              }`}
                              data-testid={`mobile-boost-${player.id}`}
                            >
                              <Rocket className={`w-4 h-4 ${boostPct > 0 ? "fill-amber-400" : ""}`} />
                              {boostPct > 0 && (
                                <span className="absolute -top-1 -right-1.5 text-[8px] font-black text-amber-300 bg-amber-950 rounded px-0.5">
                                  +{boostPct}%
                                </span>
                              )}
                            </button>
                            <button
                              onClick={() => {
                                setEditingPlayer(isEditing ? null : player.id);
                                setEditProjection(override?.customProjection != null ? override.customProjection : player.projectedPoints);
                              }}
                              className={`p-1.5 rounded transition ${
                                override?.customProjection != null
                                  ? "text-amber-400 bg-amber-500/10"
                                  : "text-slate-600 hover:text-amber-400"
                              }`}
                              data-testid={`mobile-edit-proj-${player.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleToggleLock(player)}
                              className={`p-1.5 rounded transition ${
                                override?.isLocked ? "bg-emerald-500/20 text-emerald-400" : "text-slate-600 hover:text-emerald-400"
                              }`}
                              data-testid={`mobile-toggle-lock-${player.id}`}
                            >
                              {override?.isLocked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleToggleExclude(player)}
                              className={`p-1.5 rounded transition ${
                                override?.isExcluded ? "bg-red-500/20 text-red-400" : "text-slate-600 hover:text-red-400"
                              }`}
                              data-testid={`mobile-toggle-exclude-${player.id}`}
                            >
                              {override?.isExcluded ? <X className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                            </button>
                            {hasOverride && (
                              <button
                                onClick={() => handleRemoveOverride(player)}
                                className="p-1.5 rounded text-slate-600 hover:text-amber-400"
                                title="Reset to original"
                                data-testid={`mobile-remove-override-${player.id}`}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        {isEditing && (
                          <>
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700">
                              <span className="text-xs text-slate-400">Custom Projection:</span>
                              <Input
                                type="number"
                                step="0.1"
                                value={editProjection}
                                onChange={e => setEditProjection(e.target.value)}
                                className="w-24 h-7 text-xs bg-slate-800 border-slate-600 text-white font-mono"
                                autoFocus
                                data-testid={`mobile-edit-input-${player.id}`}
                              />
                              <Button
                                size="sm"
                                className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 text-xs"
                                onClick={() => handleSaveProjection(player)}
                                data-testid={`mobile-save-proj-${player.id}`}
                              >
                                <Check className="w-3 h-3" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs text-emerald-400">Min%</span>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                placeholder="—"
                                value={override?.minExposure ?? ""}
                                onChange={e => handleExposureChange(player, "minExposure", e.target.value)}
                                className="w-16 h-7 text-xs bg-slate-800 border-emerald-500/30 text-emerald-400 text-center font-mono"
                                data-testid={`mobile-min-exposure-${player.id}`}
                              />
                              <span className="text-xs text-cyan-400">Max%</span>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                placeholder="—"
                                value={override?.maxExposure ?? ""}
                                onChange={e => handleExposureChange(player, "maxExposure", e.target.value)}
                                className="w-16 h-7 text-xs bg-slate-800 border-cyan-500/30 text-cyan-400 text-center font-mono"
                                data-testid={`mobile-max-exposure-${player.id}`}
                              />
                            </div>
                          </>
                        )}
                      </Card>
                    );
                  })}
                </div>

                {filteredPlayers.length === 0 && (
                  <Card className="p-8 bg-slate-900/50 border-slate-700 text-center">
                    <p className="text-slate-400">No players match your search.</p>
                  </Card>
                )}

                <div className="mt-4 text-xs text-slate-500 text-center">
                  Showing {filteredPlayers.length} of {players?.length || 0} players
                  {overrideCount > 0 && ` · ${overrideCount} custom override${overrideCount !== 1 ? "s" : ""} active`}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
