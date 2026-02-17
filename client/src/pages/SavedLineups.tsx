import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Trophy, Zap, Trash2, ChevronDown, ChevronUp, ArrowLeftRight, Download, Lock, X, Check, DollarSign, CheckSquare, Square, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { AFFILIATE_LINKS } from "@shared/affiliate-config";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { getPlatformConfig, assignPlayersToSlots, getSlotDisplayName, positionFitsSlot } from "@shared/platform-config";
import type { Player } from "@shared/schema";

interface LineupWithPlayers {
  id: number;
  sport: string;
  platform: string;
  name: string | null;
  totalSalary: number;
  totalProjectedPoints: string;
  playerIds: number[];
  createdAt: string;
  slateId: number;
  players: Player[];
  allPlayers: Player[];
}

export default function SavedLineups() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [swappingSlot, setSwappingSlot] = useState<{ lineupId: number; slot: string; currentPlayerId: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: lineups, isLoading } = useQuery<any[]>({
    queryKey: ["/api/lineups"],
  });

  const { data: subscription } = useQuery<any>({
    queryKey: ["/api/subscription"],
  });

  const tier = subscription?.tier || "free";
  const isPaid = tier === "pro" || tier === "star";

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/lineups/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Lineup Deleted", description: "Removed from your vault." });
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/lineups/bulk-delete", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Lineups Deleted", description: `${data.deleted} lineup${data.deleted > 1 ? "s" : ""} removed from your vault.` });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    },
    onError: () => {
      toast({ title: "Delete Failed", description: "Could not delete selected lineups.", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, playerIds }: { id: number; playerIds: number[] }) => {
      const res = await apiRequest("PATCH", `/api/lineups/${id}`, { playerIds });
      return res.json();
    },
    onSuccess: (data, variables) => {
      toast({ title: "Lineup Updated", description: "Player swapped and stats recalculated." });
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lineups", variables.id] });
      setSwappingSlot(null);
    },
    onError: (err: any) => {
      toast({ title: "Swap Failed", description: err.message || "Could not update lineup.", variant: "destructive" });
    }
  });

  function buildLineupCSV(lineup: LineupWithPlayers) {
    const config = getPlatformConfig(lineup.sport, lineup.platform as any);
    const slotAssignments = assignPlayersToSlots(lineup.players, config.slots, lineup.sport);

    const headers = ["Slot", "Name", "Position", "Team", "Salary", "FPPG", "Projected"];
    const rows = config.slots.map(slot => {
      const p = slotAssignments[slot];
      if (!p) return [getSlotDisplayName(slot), "", "", "", "", "", ""];
      return [
        getSlotDisplayName(slot),
        p.name,
        p.position,
        p.team,
        p.salary.toString(),
        Number(p.fppg).toFixed(1),
        Number(p.projectedPoints).toFixed(1),
      ];
    });
    rows.push(["", "", "", "TOTAL", lineup.totalSalary.toString(), "", Number(lineup.totalProjectedPoints).toFixed(1)]);
    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  }

  function handleExportCSV(lineup: LineupWithPlayers) {
    if (!isPaid) {
      toast({ title: "Paid Feature", description: "Upgrade to Star or Pro to export lineups.", variant: "destructive" });
      return;
    }
    const csv = buildLineupCSV(lineup);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lineup.sport}_${lineup.platform}_lineup_${lineup.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: "CSV downloaded." });
  }

  async function handleBulkExport() {
    if (!isPaid) {
      toast({ title: "Paid Feature", description: "Upgrade to Star or Pro to export lineups.", variant: "destructive" });
      return;
    }
    if (selectedIds.size === 0) {
      toast({ title: "No Lineups Selected", description: "Select lineups to export using the checkboxes.", variant: "destructive" });
      return;
    }

    const details: LineupWithPlayers[] = [];
    const ids = Array.from(selectedIds);
    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await fetch(`/api/lineups/${ids[i]}`, { credentials: "include" });
        if (res.ok) details.push(await res.json());
      } catch {}
    }

    if (details.length === 0) {
      toast({ title: "Export Failed", description: "Could not load lineup details.", variant: "destructive" });
      return;
    }

    const sections = details.map((lineup, i) => {
      const label = `Lineup ${i + 1}: ${lineup.sport} ${lineup.platform === "fanduel" ? "FD" : "DK"} - ${lineup.name || "Optimized"}`;
      return `${label}\n${buildLineupCSV(lineup)}`;
    });

    const csv = sections.join("\n\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elitelineup_bulk_export_${details.length}_lineups.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setSelectedIds(new Set());
    toast({ title: "Bulk Export Complete", description: `${details.length} lineup${details.length > 1 ? "s" : ""} exported.` });
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!lineups) return;
    if (selectedIds.size === lineups.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(lineups.map((l: any) => l.id)));
    }
  }

  function handleSwapPlayer(lineupId: number, lineup: LineupWithPlayers, oldPlayerId: number, newPlayerId: number) {
    const newPlayerIds = lineup.playerIds.map(id => id === oldPlayerId ? newPlayerId : id);
    updateMutation.mutate({ id: lineupId, playerIds: newPlayerIds });
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Skeleton className="h-12 w-48 bg-slate-800 mb-8" />
        <div className="grid grid-cols-1 gap-6">
          {[1, 2].map(i => <Skeleton key={i} className="h-64 bg-slate-800 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight" data-testid="vault-title">Lineup Vault</h1>
          <p className="text-slate-400">Your optimized winning combinations. Click to expand, swap players, and export.</p>
        </div>
        <div className="flex items-center gap-3">
          {lineups && lineups.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleSelectAll}
                className="border-slate-700 text-slate-300"
                data-testid="select-all-btn"
              >
                {selectedIds.size === lineups.length ? (
                  <><CheckSquare className="w-4 h-4 mr-2" /> Deselect All</>
                ) : (
                  <><Square className="w-4 h-4 mr-2" /> Select All</>
                )}
              </Button>
              {selectedIds.size > 0 && (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
                    disabled={bulkDeleteMutation.isPending}
                    data-testid="bulk-delete-btn"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete {selectedIds.size} Lineup{selectedIds.size > 1 ? "s" : ""}
                  </Button>
                  {isPaid && (
                    <Button
                      onClick={handleBulkExport}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      data-testid="bulk-export-btn"
                    >
                      <Download className="w-4 h-4 mr-2" /> Export {selectedIds.size} Lineup{selectedIds.size > 1 ? "s" : ""}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
          <Link href="/">
            <Button className="btn-primary" data-testid="build-new-lineup">Build New Lineup</Button>
          </Link>
        </div>
      </div>

      <a
        href={AFFILIATE_LINKS.draftkings.dfs.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block mb-8"
        data-testid="vault-dk-dfs-banner"
      >
        <div className="bg-gradient-to-r from-emerald-900/30 to-slate-900/50 border border-emerald-700/20 rounded-xl p-5 transition-all hover-elevate">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <span className="text-emerald-400 font-black text-sm">DK</span>
              </div>
              <div>
                <p className="text-sm font-black text-white">{AFFILIATE_LINKS.draftkings.dfs.label}</p>
                <p className="text-xs text-slate-400">{AFFILIATE_LINKS.draftkings.dfs.description}</p>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-emerald-500/50" />
          </div>
        </div>
      </a>

      {lineups?.length ? (
        <div className="flex flex-col gap-6">
          {lineups.map((lineup: any) => (
            <LineupCard
              key={lineup.id}
              lineup={lineup}
              isExpanded={expandedId === lineup.id}
              onToggleExpand={() => setExpandedId(expandedId === lineup.id ? null : lineup.id)}
              onDelete={() => deleteMutation.mutate(lineup.id)}
              onExport={handleExportCSV}
              onSwapPlayer={handleSwapPlayer}
              swappingSlot={swappingSlot}
              setSwappingSlot={setSwappingSlot}
              isPaid={isPaid}
              isUpdating={updateMutation.isPending}
              isSelected={selectedIds.has(lineup.id)}
              onToggleSelect={() => toggleSelect(lineup.id)}
            />
          ))}
        </div>
      ) : (
        <div className="py-24 text-center bg-slate-800/20 rounded-3xl border-2 border-dashed border-slate-800/50">
          <Zap className="w-16 h-16 text-slate-700 mx-auto mb-6" />
          <h5 className="text-xl font-bold text-slate-300 mb-2" data-testid="no-lineups-message">No Saved Lineups</h5>
          <p className="text-slate-400 max-w-sm mx-auto">Once you optimize a lineup, save it to your vault to track performance and export to DFS sites.</p>
        </div>
      )}
    </div>
  );
}

function LineupCard({
  lineup,
  isExpanded,
  onToggleExpand,
  onDelete,
  onExport,
  onSwapPlayer,
  swappingSlot,
  setSwappingSlot,
  isPaid,
  isUpdating,
  isSelected,
  onToggleSelect,
}: {
  lineup: any;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onExport: (l: LineupWithPlayers) => void;
  onSwapPlayer: (lineupId: number, lineup: LineupWithPlayers, oldId: number, newId: number) => void;
  swappingSlot: { lineupId: number; slot: string; currentPlayerId: number } | null;
  setSwappingSlot: (s: { lineupId: number; slot: string; currentPlayerId: number } | null) => void;
  isPaid: boolean;
  isUpdating: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const { data: lineupDetail, isLoading: detailLoading } = useQuery<LineupWithPlayers>({
    queryKey: ["/api/lineups", lineup.id],
    enabled: isExpanded,
  });

  const isFD = lineup.platform === "fanduel";
  const platformLabel = isFD ? "FD" : "DK";

  return (
    <Card className={`bg-slate-800/30 border-slate-800 transition-all ${isSelected ? "ring-2 ring-emerald-500/50" : ""}`} data-testid={`lineup-card-${lineup.id}`}>
      <div
        className="flex justify-between items-center p-6 cursor-pointer select-none"
        onClick={onToggleExpand}
        data-testid={`lineup-header-${lineup.id}`}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={e => { e.stopPropagation(); onToggleSelect(); }}
            className="flex-shrink-0"
            data-testid={`select-lineup-${lineup.id}`}
          >
            {isSelected ? (
              <CheckSquare className="w-5 h-5 text-emerald-400" />
            ) : (
              <Square className="w-5 h-5 text-slate-600 hover:text-slate-400" />
            )}
          </button>
          <div className="flex items-center gap-2">
            <Badge className={`${isFD ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"} border-0 text-[11px] font-black uppercase`}>
              {lineup.sport} {platformLabel}
            </Badge>
            <span className="text-slate-400 text-xs font-medium">
              {new Date(lineup.createdAt).toLocaleDateString()}
            </span>
          </div>
          <h3 className="text-xl font-bold text-white">{lineup.name || "Optimized Lineup"}</h3>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Proj</p>
              <p className="text-lg font-bold text-emerald-400" data-testid={`lineup-proj-${lineup.id}`}>{Number(lineup.totalProjectedPoints).toFixed(1)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Salary</p>
              <p className="text-lg font-bold text-white" data-testid={`lineup-salary-${lineup.id}`}>${lineup.totalSalary.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (lineupDetail) onExport(lineupDetail);
              }}
              disabled={!isExpanded || !lineupDetail}
              className={isPaid ? "text-emerald-400" : "text-slate-500 opacity-50"}
              title={isPaid ? "Export CSV" : "Upgrade to export"}
              data-testid={`export-btn-${lineup.id}`}
            >
              {isPaid ? <Download className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="text-red-400"
              data-testid={`delete-btn-${lineup.id}`}
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>

          {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-800 p-6">
          {detailLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 bg-slate-800" />)}
            </div>
          ) : lineupDetail ? (
            <ExpandedRoster
              lineup={lineupDetail}
              onSwapPlayer={onSwapPlayer}
              swappingSlot={swappingSlot}
              setSwappingSlot={setSwappingSlot}
              isUpdating={isUpdating}
            />
          ) : (
            <p className="text-slate-400">Failed to load lineup details.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function ExpandedRoster({
  lineup,
  onSwapPlayer,
  swappingSlot,
  setSwappingSlot,
  isUpdating,
}: {
  lineup: LineupWithPlayers;
  onSwapPlayer: (lineupId: number, lineup: LineupWithPlayers, oldId: number, newId: number) => void;
  swappingSlot: { lineupId: number; slot: string; currentPlayerId: number } | null;
  setSwappingSlot: (s: { lineupId: number; slot: string; currentPlayerId: number } | null) => void;
  isUpdating: boolean;
}) {
  const config = getPlatformConfig(lineup.sport, lineup.platform as any);
  const slotAssignments = assignPlayersToSlots(lineup.players, config.slots, lineup.sport);
  const isSwapping = swappingSlot?.lineupId === lineup.id;
  const currentSwapSlot = isSwapping ? swappingSlot!.slot : null;

  const eligibleReplacements = currentSwapSlot
    ? lineup.allPlayers.filter(p =>
        !lineup.playerIds.includes(p.id) &&
        positionFitsSlot(p.position, currentSwapSlot, lineup.sport) &&
        (lineup.totalSalary - (slotAssignments[currentSwapSlot]?.salary || 0) + p.salary) <= config.salaryCap
      ).sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints))
    : [];

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full" data-testid={`roster-table-${lineup.id}`}>
          <thead>
            <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800">
              <th className="text-left py-2 pr-4 w-16">Slot</th>
              <th className="text-left py-2 pr-4">Player</th>
              <th className="text-left py-2 pr-4 w-16">Pos</th>
              <th className="text-left py-2 pr-4 w-16">Team</th>
              <th className="text-right py-2 pr-4 w-24">Salary</th>
              <th className="text-right py-2 pr-4 w-16">FPPG</th>
              <th className="text-right py-2 pr-4 w-20">Proj</th>
              <th className="text-center py-2 w-16">Swap</th>
            </tr>
          </thead>
          <tbody>
            {config.slots.map(slot => {
              const player = slotAssignments[slot];
              const isThisSlotSwapping = isSwapping && currentSwapSlot === slot;

              return (
                <tr
                  key={slot}
                  className={`border-b border-slate-800/50 ${isThisSlotSwapping ? "bg-emerald-500/5" : "hover:bg-slate-800/30"}`}
                  data-testid={`roster-row-${lineup.id}-${slot}`}
                >
                  <td className="py-3 pr-4">
                    <span className="text-xs font-bold text-slate-400 bg-slate-800/80 px-2 py-1 rounded">
                      {getSlotDisplayName(slot)}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-sm font-semibold text-white">{player?.name || "—"}</span>
                  </td>
                  <td className="py-3 pr-4 text-xs text-slate-400">{player?.position || "—"}</td>
                  <td className="py-3 pr-4 text-xs text-slate-400">{player?.team || "—"}</td>
                  <td className="py-3 pr-4 text-right text-sm font-medium text-white">
                    {player ? `$${player.salary.toLocaleString()}` : "—"}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm text-slate-400">
                    {player ? Number(player.fppg).toFixed(1) : "—"}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm font-semibold text-emerald-400">
                    {player ? Number(player.projectedPoints).toFixed(1) : "—"}
                  </td>
                  <td className="py-3 text-center">
                    {player && (
                      isThisSlotSwapping ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSwappingSlot(null)}
                          className="w-8 h-8 text-red-400"
                          data-testid={`cancel-swap-${lineup.id}-${slot}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSwappingSlot({ lineupId: lineup.id, slot, currentPlayerId: player.id })}
                          disabled={isUpdating || (isSwapping && currentSwapSlot !== slot)}
                          className="w-8 h-8 text-slate-500"
                          data-testid={`swap-btn-${lineup.id}-${slot}`}
                        >
                          <ArrowLeftRight className="w-4 h-4" />
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700">
              <td colSpan={4} className="py-3 pr-4 text-xs font-bold text-slate-400 uppercase">
                Total ({lineup.playerIds.length} players)
              </td>
              <td className="py-3 pr-4 text-right text-sm font-bold text-white">
                ${lineup.totalSalary.toLocaleString()}
              </td>
              <td className="py-3 pr-4"></td>
              <td className="py-3 pr-4 text-right text-sm font-bold text-emerald-400">
                {Number(lineup.totalProjectedPoints).toFixed(1)}
              </td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={8} className="pt-1 pb-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-3 h-3 text-slate-400" />
                  <span className="text-xs text-slate-400">
                    Remaining: ${(config.salaryCap - lineup.totalSalary).toLocaleString()} / ${config.salaryCap.toLocaleString()} cap
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {isSwapping && currentSwapSlot && (
        <div className="mt-6 border-t border-slate-700 pt-4" data-testid={`swap-panel-${lineup.id}`}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-white">
              Select replacement for <span className="text-emerald-400">{getSlotDisplayName(currentSwapSlot)}</span> slot
            </h4>
            <Button variant="ghost" size="sm" onClick={() => setSwappingSlot(null)} className="text-slate-400">
              Cancel
            </Button>
          </div>
          {eligibleReplacements.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">No eligible replacements found within salary cap.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-900/95">
                  <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                    <th className="text-left py-2 px-3">Player</th>
                    <th className="text-left py-2 px-3">Pos</th>
                    <th className="text-left py-2 px-3">Team</th>
                    <th className="text-right py-2 px-3">Salary</th>
                    <th className="text-right py-2 px-3">Proj</th>
                    <th className="text-center py-2 px-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleReplacements.slice(0, 30).map(player => (
                    <tr key={player.id} className="border-t border-slate-800/50 hover:bg-slate-800/30" data-testid={`replacement-row-${player.id}`}>
                      <td className="py-2 px-3 text-sm font-medium text-white">{player.name}</td>
                      <td className="py-2 px-3 text-xs text-slate-400">{player.position}</td>
                      <td className="py-2 px-3 text-xs text-slate-400">{player.team}</td>
                      <td className="py-2 px-3 text-right text-sm text-white">${player.salary.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-sm font-semibold text-emerald-400">{Number(player.projectedPoints).toFixed(1)}</td>
                      <td className="py-2 px-3 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onSwapPlayer(lineup.id, lineup, swappingSlot!.currentPlayerId, player.id)}
                          disabled={isUpdating}
                          className="w-7 h-7 text-emerald-400"
                          data-testid={`select-replacement-${player.id}`}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
