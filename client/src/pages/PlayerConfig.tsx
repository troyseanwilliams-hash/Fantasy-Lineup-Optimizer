import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Crown, Lock, LockOpen, Ban, Check, RotateCcw, Search, Loader2, Settings2, ArrowUpDown, Pencil, X, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Slate, Player, PlayerOverride } from "@shared/schema";
import { ACTIVE_SPORTS } from "@shared/platform-config";

const SPORT_COLORS: Record<string, { accent: string; bg: string; border: string; tab: string }> = {
  NBA: { accent: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", tab: "bg-orange-500" },
  NHL: { accent: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", tab: "bg-cyan-500" },
  MLB: { accent: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", tab: "bg-red-500" },
  NFL: { accent: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", tab: "bg-green-500" },
  GOLF: { accent: "text-lime-400", bg: "bg-lime-500/10", border: "border-lime-500/20", tab: "bg-lime-500" },
  SOCCER: { accent: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20", tab: "bg-teal-500" },
};

type SortField = "name" | "position" | "salary" | "projectedPoints" | "override";
type SortDir = "asc" | "desc";

export default function PlayerConfig() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedSport, setSelectedSport] = useState("NBA");
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
    queryKey: ["/api/slates"],
    enabled: !!user,
  });

  const mainSlates = slates?.filter(s => s.isMain) || [];
  const currentSlate = mainSlates.find(s => s.sport === selectedSport);
  const slateId = currentSlate?.id;

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: ["/api/slates", slateId, "players"],
    queryFn: async () => {
      const res = await fetch(`/api/slates/${slateId}/players`);
      if (!res.ok) throw new Error("Failed to fetch players");
      return res.json();
    },
    enabled: !!slateId && !!user,
  });

  const { data: overrides, isLoading: overridesLoading } = useQuery<PlayerOverride[]>({
    queryKey: ["/api/player-overrides", slateId],
    queryFn: async () => {
      const res = await fetch(`/api/player-overrides/${slateId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slateId && hasPaidAccess,
  });

  const overrideMap = useMemo(() => {
    const map = new Map<number, PlayerOverride>();
    overrides?.forEach(o => map.set(o.playerId, o));
    return map;
  }, [overrides]);

  const overrideCount = overrides?.length || 0;

  const upsertMutation = useMutation({
    mutationFn: async ({ playerId, data }: { playerId: number; data: any }) => {
      const res = await apiRequest("PUT", `/api/player-overrides/${slateId}/${playerId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-overrides", slateId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (playerId: number) => {
      await apiRequest("DELETE", `/api/player-overrides/${slateId}/${playerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-overrides", slateId] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/player-overrides/${slateId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-overrides", slateId] });
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
    let filtered = [...players];

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
        case "override": {
          const aHas = overrideMap.has(a.id) ? 1 : 0;
          const bHas = overrideMap.has(b.id) ? 1 : 0;
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

  function handleToggleExclude(player: Player) {
    const existing = overrideMap.get(player.id);
    const newExcluded = !existing?.isExcluded;
    upsertMutation.mutate({
      playerId: player.id,
      data: {
        customProjection: existing?.customProjection ?? null,
        isExcluded: newExcluded,
        isLocked: newExcluded ? false : (existing?.isLocked || false),
        notes: existing?.notes || null,
      },
    });
  }

  function handleToggleLock(player: Player) {
    const existing = overrideMap.get(player.id);
    const newLocked = !existing?.isLocked;
    upsertMutation.mutate({
      playerId: player.id,
      data: {
        customProjection: existing?.customProjection ?? null,
        isExcluded: newLocked ? false : (existing?.isExcluded || false),
        isLocked: newLocked,
        notes: existing?.notes || null,
      },
    });
  }

  function handleSaveProjection(player: Player) {
    const val = editProjection.trim();
    const existing = overrideMap.get(player.id);
    if (val === "" || val === player.projectedPoints) {
      if (existing && existing.customProjection != null) {
        upsertMutation.mutate({
          playerId: player.id,
          data: {
            customProjection: null,
            isExcluded: existing.isExcluded,
            isLocked: existing.isLocked,
            notes: existing.notes,
          },
        });
      }
    } else {
      const num = parseFloat(val);
      if (isNaN(num) || num < 0) {
        toast({ title: "Invalid projection", description: "Please enter a valid number.", variant: "destructive" });
        return;
      }
      upsertMutation.mutate({
        playerId: player.id,
        data: {
          customProjection: num,
          isExcluded: existing?.isExcluded || false,
          isLocked: existing?.isLocked || false,
          notes: existing?.notes || null,
        },
      });
    }
    setEditingPlayer(null);
    setEditProjection("");
  }

  function handleRemoveOverride(playerId: number) {
    deleteMutation.mutate(playerId);
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
              Customize projections, lock, or exclude players. Changes apply to both optimizers and reset with each slate refresh.
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
            const hasSlate = mainSlates.some(s => s.sport === sport);
            return (
              <button
                key={sport}
                onClick={() => { setSelectedSport(sport); setSearchQuery(""); setPositionFilter("ALL"); }}
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

        {!currentSlate ? (
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
                        {[
                          { key: "name" as SortField, label: "Player" },
                          { key: "position" as SortField, label: "Pos" },
                          { key: "salary" as SortField, label: "Salary" },
                          { key: "projectedPoints" as SortField, label: "Projection" },
                        ].map(col => (
                          <th
                            key={col.key}
                            className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase cursor-pointer hover:text-white transition"
                            onClick={() => handleSort(col.key)}
                            data-testid={`sort-${col.key}`}
                          >
                            <div className="flex items-center gap-1">
                              {col.label}
                              {sortField === col.key && (
                                <ArrowUpDown className="w-3 h-3" />
                              )}
                            </div>
                          </th>
                        ))}
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase">Custom Proj</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase">Status</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredPlayers.map(player => {
                        const override = overrideMap.get(player.id);
                        const hasOverride = !!override;
                        const isEditing = editingPlayer === player.id;

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
                            <td className="px-4 py-3">
                              <div className="flex flex-col">
                                <span className="text-white font-medium text-sm">{player.name}</span>
                                <span className="text-slate-500 text-xs">{player.team} {player.opponent ? `vs ${player.opponent}` : ""}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">{player.position}</Badge>
                            </td>
                            <td className="px-4 py-3 text-slate-300 text-sm font-mono">${player.salary?.toLocaleString()}</td>
                            <td className="px-4 py-3 text-slate-300 text-sm font-mono">{Number(player.projectedPoints).toFixed(1)}</td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={editProjection}
                                    onChange={e => setEditProjection(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") handleSaveProjection(player);
                                      if (e.key === "Escape") { setEditingPlayer(null); setEditProjection(""); }
                                    }}
                                    className="w-20 h-7 text-xs bg-slate-800 border-slate-600 text-white"
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
                                <div className="flex items-center gap-1">
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
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                {override?.isLocked && (
                                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">LOCKED</Badge>
                                )}
                                {override?.isExcluded && (
                                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">EXCLUDED</Badge>
                                )}
                                {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">{player.injuryStatus}</Badge>
                                )}
                                {!override?.isLocked && !override?.isExcluded && !player.injuryStatus && (
                                  <span className="text-slate-600 text-xs">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
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
                                    onClick={() => handleRemoveOverride(player.id)}
                                    className="p-1.5 rounded text-slate-600 hover:text-amber-400 hover:bg-amber-500/10 transition"
                                    title="Remove all overrides for this player"
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
                    const override = overrideMap.get(player.id);
                    const hasOverride = !!override;
                    const isEditing = editingPlayer === player.id;

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
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium text-sm truncate">{player.name}</span>
                              <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 shrink-0">{player.position}</Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                              <span>{player.team}</span>
                              <span className="font-mono">${player.salary?.toLocaleString()}</span>
                              <span className="font-mono">{Number(player.projectedPoints).toFixed(1)} pts</span>
                              {override?.customProjection != null && (
                                <span className="text-amber-400 font-bold font-mono" data-testid={`mobile-custom-proj-${player.id}`}>
                                  → {Number(override.customProjection).toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
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
                                onClick={() => handleRemoveOverride(player.id)}
                                className="p-1.5 rounded text-slate-600 hover:text-amber-400"
                                data-testid={`mobile-remove-override-${player.id}`}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        {isEditing && (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700">
                            <span className="text-xs text-slate-400">Custom Projection:</span>
                            <Input
                              type="number"
                              step="0.1"
                              value={editProjection}
                              onChange={e => setEditProjection(e.target.value)}
                              className="w-24 h-7 text-xs bg-slate-800 border-slate-600 text-white"
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
