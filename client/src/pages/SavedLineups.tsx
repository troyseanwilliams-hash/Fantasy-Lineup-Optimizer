import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Trophy, Zap, Trash2, ChevronDown, ChevronUp, ArrowLeftRight, Download, Lock, X, Check, DollarSign, CheckSquare, Square, ExternalLink, Shield, TrendingUp, ArrowUpDown, Users, History, Eye, AlertTriangle, Upload, Settings, RefreshCw, FileUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
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

type VaultSortKey = "newest" | "oldest" | "projection_high" | "projection_low" | "ownership_high" | "ownership_low" | "salary_high" | "salary_low";
type VaultTab = "active" | "review";

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
  const [vaultSort, setVaultSort] = useState<VaultSortKey>("newest");
  const [activeTab, setActiveTab] = useState<VaultTab>("active");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [regenUseBoosts, setRegenUseBoosts] = useState(true);
  const [regenCeilingMode, setRegenCeilingMode] = useState(false);
  const [regenLeverageMode, setRegenLeverageMode] = useState(false);
  const [showRegenSettings, setShowRegenSettings] = useState(false);
  const [regenMaxExposure, setRegenMaxExposure] = useState<number | null>(null);

  const { data: lineups, isLoading } = useQuery<any[]>({
    queryKey: ["/api/lineups"],
  });

  const sortedLineups = useMemo(() => {
    if (!lineups) return [];
    return [...lineups].sort((a, b) => {
      switch (vaultSort) {
        case "newest": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "projection_high": return Number(b.totalProjectedPoints) - Number(a.totalProjectedPoints);
        case "projection_low": return Number(a.totalProjectedPoints) - Number(b.totalProjectedPoints);
        case "ownership_high": return (b.totalOwnership ?? 0) - (a.totalOwnership ?? 0);
        case "ownership_low": return (a.totalOwnership ?? 0) - (b.totalOwnership ?? 0);
        case "salary_high": return b.totalSalary - a.totalSalary;
        case "salary_low": return a.totalSalary - b.totalSalary;
        default: return 0;
      }
    });
  }, [lineups, vaultSort]);

  const { data: subscription } = useQuery<any>({
    queryKey: ["/api/subscription"],
  });

  const tier = subscription?.tier || "free";
  const isPro = tier === "pro";
  const isPaid = tier === "pro" || tier === "star";

  const { data: reviewLineups, isLoading: reviewLoading } = useQuery<any[]>({
    queryKey: ["/api/lineups/review"],
    enabled: activeTab === "review" && isPaid,
  });

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

  const bulkGenerateMutation = useMutation({
    mutationFn: async ({ ids, useBoosts, ceilingMode, leverageMode, globalMaxExposure }: { ids: number[]; useBoosts?: boolean; ceilingMode?: boolean; leverageMode?: boolean; globalMaxExposure?: number }) => {
      const res = await apiRequest("POST", "/api/lineups/bulk-generate", { ids, useBoosts: useBoosts !== false, ceilingMode: ceilingMode || false, leverageMode: leverageMode || false, globalMaxExposure: globalMaxExposure ?? undefined });
      return res.json();
    },
    onSuccess: (data) => {
      const updated = data.updated || 0;
      const failed = (data.results || []).filter((r: any) => r.status !== "updated").length;
      let desc = `${updated} lineup${updated !== 1 ? "s" : ""} optimized with fresh rosters.`;
      if (failed > 0) desc += ` ${failed} skipped.`;
      toast({ title: "Lineups Regenerated", description: desc });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    },
    onError: (err: any) => {
      toast({ title: "Generation Failed", description: err.message || "Could not generate lineups.", variant: "destructive" });
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

  const { data: slates } = useQuery<any[]>({
    queryKey: ["/api/slates"],
  });

  const importMutation = useMutation({
    mutationFn: async (data: { entries: any[]; sport: string; slateId: number }) => {
      const res = await apiRequest("POST", "/api/lineups/import-dk", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
      const failed = data.results?.filter((r: any) => r.status === "failed").length || 0;
      if (failed > 0) {
        toast({ title: "Import Complete", description: `${data.imported} of ${data.total} entries imported. ${failed} failed (player mismatch).` });
      } else {
        toast({ title: "Import Successful", description: `${data.imported} DraftKings entries imported.` });
      }
    },
    onError: (err: any) => {
      toast({ title: "Import Failed", description: err.message || "Could not import entries.", variant: "destructive" });
    }
  });

  function parseCSVRow(row: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (inQuotes) {
        if (ch === '"' && row[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { fields.push(current.trim()); current = ""; }
        else { current += ch; }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  function parseDKEntryCSV(csvText: string): { entries: any[]; detectedSport: string | null } {
    const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return { entries: [], detectedSport: null };

    const headers = parseCSVRow(lines[0]);

    const entryIdIdx = headers.indexOf("Entry ID");
    const contestNameIdx = headers.indexOf("Contest Name");
    const contestIdIdx = headers.indexOf("Contest ID");
    const entryFeeIdx = headers.indexOf("Entry Fee");

    if (entryIdIdx < 0 || entryFeeIdx < 0) return { entries: [], detectedSport: null };

    const slotStartIdx = entryFeeIdx + 1;
    const slotHeaders = headers.slice(slotStartIdx).filter(h => h && h !== "Instructions");

    let detectedSport: string | null = null;
    const entries: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      const entryId = cols[entryIdIdx];
      if (!entryId || entryId === "") continue;

      const contestName = contestNameIdx >= 0 ? (cols[contestNameIdx] || "") : "";
      const contestId = contestIdIdx >= 0 ? (cols[contestIdIdx] || "") : "";
      const entryFee = cols[entryFeeIdx] || "";

      if (!detectedSport && contestName) {
        const cn = contestName.toUpperCase();
        if (cn.includes("NBA")) detectedSport = "NBA";
        else if (cn.includes("NHL")) detectedSport = "NHL";
        else if (cn.includes("NFL")) detectedSport = "NFL";
        else if (cn.includes("MLB")) detectedSport = "MLB";
        else if (cn.includes("GOLF") || cn.includes("PGA")) detectedSport = "GOLF";
        else if (cn.includes("SOCCER") || cn.includes("EPL") || cn.includes("MLS")) detectedSport = "SOCCER";
      }

      const dkPlayerIds: number[] = [];
      for (let s = 0; s < slotHeaders.length; s++) {
        const cell = cols[slotStartIdx + s] || "";
        const match = cell.match(/\((\d+)\)\s*$/);
        if (match) dkPlayerIds.push(parseInt(match[1]));
      }

      if (dkPlayerIds.length > 0) {
        entries.push({ entryId, contestName, contestId, entryFee, dkPlayerIds });
      }
    }

    return { entries, detectedSport };
  }

  function handleDKImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { entries, detectedSport } = parseDKEntryCSV(text);

      if (entries.length === 0) {
        toast({ title: "No Entries Found", description: "Could not parse any valid DK entries from the CSV file.", variant: "destructive" });
        return;
      }

      const sport = detectedSport;
      if (!sport) {
        toast({ title: "Sport Not Detected", description: "Could not detect sport from contest name. Ensure this is a valid DK entries CSV.", variant: "destructive" });
        return;
      }

      const matchingSlate = slates?.find((s: any) => s.sport === sport);
      if (!matchingSlate) {
        toast({ title: "No Active Slate", description: `No active ${sport} slate found. Can only import entries for sports with live DK data.`, variant: "destructive" });
        return;
      }

      importMutation.mutate({ entries, sport, slateId: matchingSlate.id });
    };
    reader.readAsText(file);
  }

  function buildDraftKingsCSV(lineups: LineupWithPlayers[]): string {
    if (lineups.length === 0) return "";
    const firstLineup = lineups[0];
    const config = getPlatformConfig(firstLineup.sport, firstLineup.platform as any);
    const slotHeaders = config.slots.map(slot => getSlotDisplayName(slot));

    const hasDkEntries = lineups.some((l: any) => l.dkEntryId);

    const headers = hasDkEntries
      ? ["Entry ID", "Contest Name", "Contest ID", "Entry Fee", ...slotHeaders]
      : slotHeaders;

    const rows = lineups.map(lineup => {
      const slotAssignments = assignPlayersToSlots(lineup.players, config.slots, lineup.sport);
      const playerCells = config.slots.map(slot => {
        const p = slotAssignments[slot];
        if (!p) return "";
        const dkId = (p as any).draftKingsPlayerId;
        return dkId ? `${p.name} (${dkId})` : p.name;
      });

      if (hasDkEntries) {
        const l = lineup as any;
        return [l.dkEntryId || "", l.dkContestName || "", l.dkContestId || "", l.dkEntryFee || "", ...playerCells];
      }
      return playerCells;
    });

    return [headers.join(","), ...rows.map(r => r.map(cell => `"${cell}"`).join(","))].join("\n");
  }

  function buildLineupCSV(lineup: LineupWithPlayers) {
    return buildDraftKingsCSV([lineup]);
  }

  function handleExportCSV(lineup: LineupWithPlayers) {
    if (!isPaid) {
      toast({ title: "Paid Feature", description: "Upgrade to Sharpshooter or Champion to export lineups.", variant: "destructive" });
      return;
    }
    if (lineup.platform !== "draftkings") {
      toast({ title: "Export Unavailable", description: "CSV export is only available for DraftKings lineups.", variant: "destructive" });
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
      toast({ title: "Paid Feature", description: "Upgrade to Sharpshooter or Champion to export lineups.", variant: "destructive" });
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

    const dkLineups = details.filter(d => d.platform === "draftkings");
    if (dkLineups.length === 0) {
      toast({ title: "No DraftKings Lineups", description: "CSV export is only available for DraftKings lineups. None of the selected lineups are from DraftKings.", variant: "destructive" });
      return;
    }
    if (dkLineups.length < details.length) {
      toast({ title: "Note", description: `${details.length - dkLineups.length} non-DraftKings lineup(s) excluded from export.` });
    }

    const sameSport = dkLineups.every(l => l.sport === dkLineups[0].sport);
    if (!sameSport) {
      toast({ title: "Mixed Sports", description: "All selected DraftKings lineups must be the same sport for CSV export.", variant: "destructive" });
      return;
    }

    const csv = buildDraftKingsCSV(dkLineups);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elitelineup_bulk_export_${dkLineups.length}_lineups.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setSelectedIds(new Set());
    toast({ title: "Bulk Export Complete", description: `${dkLineups.length} lineup${dkLineups.length > 1 ? "s" : ""} exported for DraftKings upload.` });
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

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center px-4">
        <div className="max-w-lg text-center space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 mb-2">
            <Trophy className="w-10 h-10 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">The Vault</h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Your personal lineup vault stores every optimized lineup you build. Save your best lineups, compare strategies across sports, swap players, and export to CSV for easy upload to DraftKings.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2" data-testid="vault-feature-save">
              <Shield className="w-5 h-5 text-cyan-400 mx-auto" />
              <div className="text-sm font-bold text-white">Save Lineups</div>
              <div className="text-xs text-slate-400">Store optimized lineups per sport and revisit them anytime</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2" data-testid="vault-feature-swap">
              <ArrowLeftRight className="w-5 h-5 text-amber-400 mx-auto" />
              <div className="text-sm font-bold text-white">Swap Players</div>
              <div className="text-xs text-slate-400">Fine-tune saved lineups with inline player swaps</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2" data-testid="vault-feature-export">
              <Download className="w-5 h-5 text-emerald-400 mx-auto" />
              <div className="text-sm font-bold text-white">CSV Export</div>
              <div className="text-xs text-slate-400">Export lineups to CSV for direct upload to DFS platforms</div>
            </div>
          </div>

          <div className="pt-4">
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold mb-4">
              DraftKings Integration
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-800/50 border border-amber-500/20 rounded-xl p-4 space-y-2" data-testid="vault-feature-dk-import">
                <Upload className="w-5 h-5 text-amber-400 mx-auto" />
                <div className="text-sm font-bold text-white">DK Entries Import</div>
                <div className="text-xs text-slate-400">Upload your DraftKings contest CSV to import lineups directly into the Vault</div>
              </div>
              <div className="bg-slate-800/50 border border-amber-500/20 rounded-xl p-4 space-y-2" data-testid="vault-feature-bulk-regen">
                <RefreshCw className="w-5 h-5 text-amber-400 mx-auto" />
                <div className="text-sm font-bold text-white">Bulk Regenerate</div>
                <div className="text-xs text-slate-400">Regenerate multiple lineups at once with AI boost engine, ceiling mode, and correlation stacking</div>
              </div>
              <div className="bg-slate-800/50 border border-amber-500/20 rounded-xl p-4 space-y-2" data-testid="vault-feature-dk-export">
                <FileUp className="w-5 h-5 text-amber-400 mx-auto" />
                <div className="text-sm font-bold text-white">DK Contest Export</div>
                <div className="text-xs text-slate-400">Export your optimized lineups in DraftKings contest-ready CSV format for instant upload</div>
              </div>
            </div>
          </div>

          <p className="text-slate-500 text-sm">Sign in to start building and saving your winning lineups.</p>
        </div>
      </div>
    );
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

  const totalLineups = lineups?.length || 0;
  const totalProjectedPts = lineups?.reduce((sum: number, l: any) => sum + Number(l.totalProjectedPoints || 0), 0) || 0;
  const totalSalaryUsed = lineups?.reduce((sum: number, l: any) => sum + (l.totalSalary || 0), 0) || 0;
  const sportBreakdown: Record<string, number> = {};
  lineups?.forEach((l: any) => { sportBreakdown[l.sport] = (sportBreakdown[l.sport] || 0) + 1; });

  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden border-b border-slate-800/50">
        <img
          src="/images/vault-bg.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-15"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/80 via-slate-950/90 to-slate-900/95" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />

        <div className="relative container mx-auto px-4 py-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Shield className="w-7 h-7 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-4xl font-black text-white tracking-tight" data-testid="vault-title">Lineup Vault</h1>
                <p className="text-slate-400 text-sm mt-1">Your optimized winning combinations. Expand, swap, and export.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {lineups && lineups.length > 0 && (
                <>
                  <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50" data-testid="vault-sort-controls">
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <select
                      value={vaultSort}
                      onChange={e => setVaultSort(e.target.value as VaultSortKey)}
                      className="bg-transparent border-none text-xs font-bold text-slate-300 outline-none cursor-pointer pr-1"
                      data-testid="vault-sort-select"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                      <option value="projection_high">Projection: High → Low</option>
                      <option value="projection_low">Projection: Low → High</option>
                      {isPaid ? (
                        <>
                          <option value="ownership_high">Proj. Ownership: High → Low</option>
                          <option value="ownership_low">Proj. Ownership: Low → High</option>
                        </>
                      ) : (
                        <option value="newest" disabled>🔒 Proj. Ownership Sort (Sharpshooter+)</option>
                      )}
                      <option value="salary_high">Salary: High → Low</option>
                      <option value="salary_low">Salary: Low → High</option>
                    </select>
                  </div>
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
                        <Trash2 className="w-4 h-4 mr-2" /> Delete {selectedIds.size}
                      </Button>
                      {isPaid && (
                        <div className="flex items-center gap-1">
                          <Button
                            onClick={() => bulkGenerateMutation.mutate({ ids: Array.from(selectedIds), useBoosts: regenUseBoosts, ceilingMode: regenCeilingMode, leverageMode: regenLeverageMode, globalMaxExposure: regenMaxExposure ?? undefined })}
                            disabled={bulkGenerateMutation.isPending}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            data-testid="bulk-generate-btn"
                          >
                            <Zap className="w-4 h-4 mr-2" /> {bulkGenerateMutation.isPending ? "Regenerating..." : `Regenerate ${selectedIds.size}`}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowRegenSettings(!showRegenSettings)}
                            className={`h-9 w-9 ${showRegenSettings ? "text-amber-400" : "text-slate-400 hover:text-white"}`}
                            data-testid="regen-settings-btn"
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                      {isPaid && (
                        <Button
                          onClick={handleBulkExport}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          data-testid="bulk-export-btn"
                        >
                          <Download className="w-4 h-4 mr-2" /> Export {selectedIds.size}
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
              {isPro && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleDKImport}
                    data-testid="dk-import-file-input"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    data-testid="dk-import-btn"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {importMutation.isPending ? "Importing..." : "Import DK Entries"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {showRegenSettings && selectedIds.size > 0 && isPaid && (
            <div className="bg-slate-800/60 border border-slate-700/40 rounded-xl px-4 py-3" data-testid="regen-settings-panel">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Regenerate Settings</p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={regenUseBoosts} onCheckedChange={setRegenUseBoosts} data-testid="regen-toggle-boosts" className="scale-90" />
                  <span className="text-xs font-bold text-slate-300">Boosts</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={regenCeilingMode} onCheckedChange={setRegenCeilingMode} data-testid="regen-toggle-ceiling" className="scale-90" />
                  <span className="text-xs font-bold text-slate-300">Ceiling Mode</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={regenLeverageMode} onCheckedChange={setRegenLeverageMode} data-testid="regen-toggle-leverage" className="scale-90" />
                  <span className="text-xs font-bold text-slate-300">Leverage</span>
                </div>
                <div className="flex items-center gap-2 min-w-[180px]">
                  <span className="text-xs font-bold text-slate-300 whitespace-nowrap">Exposure</span>
                  <Slider
                    value={[regenMaxExposure ?? 100]}
                    onValueChange={(v) => setRegenMaxExposure(v[0] >= 100 ? null : v[0])}
                    min={10}
                    max={100}
                    step={5}
                    className="flex-1"
                    data-testid="regen-slider-exposure"
                  />
                  <span className={`text-xs font-black min-w-[28px] text-center ${regenMaxExposure ? "text-cyan-400" : "text-slate-500"}`} data-testid="regen-text-exposure">
                    {regenMaxExposure ? `${regenMaxExposure}%` : "Off"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {totalLineups > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3" data-testid="stat-total-lineups">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Saved Lineups</p>
                <p className="text-2xl font-black text-white">{totalLineups}</p>
              </div>
              <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3" data-testid="stat-total-proj">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Proj Points</p>
                <p className="text-2xl font-black text-emerald-400">{totalProjectedPts.toFixed(1)}</p>
              </div>
              <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3" data-testid="stat-avg-proj">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Avg Proj / Lineup</p>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <p className="text-2xl font-black text-white">{totalLineups > 0 ? (totalProjectedPts / totalLineups).toFixed(1) : "0"}</p>
                </div>
              </div>
              <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3" data-testid="stat-sports">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Sports</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(sportBreakdown).map(([sport, count]) => (
                    <Badge key={sport} variant="outline" className="border-emerald-500/20 text-emerald-400 text-[11px] font-black">
                      {sport} ({count})
                    </Badge>
                  ))}
                  {Object.keys(sportBreakdown).length === 0 && <p className="text-2xl font-black text-slate-600">--</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6" data-testid="vault-tabs">
          <Button
            variant={activeTab === "active" ? "default" : "ghost"}
            onClick={() => setActiveTab("active")}
            className={activeTab === "active" ? "" : "text-slate-400"}
            data-testid="tab-active"
          >
            <Shield className="w-4 h-4 mr-2" /> Active Lineups
          </Button>
          <Button
            variant={activeTab === "review" ? "default" : "ghost"}
            onClick={() => {
              if (!isPaid) {
                toast({ title: "Paid Feature", description: "Upgrade to Sharpshooter or Champion to review lineups and contest comparisons.", variant: "destructive" });
                return;
              }
              setActiveTab("review");
            }}
            className={activeTab === "review" ? "" : "text-slate-400"}
            data-testid="tab-review"
          >
            <History className="w-4 h-4 mr-2" /> Review
            {!isPaid && <Lock className="w-3 h-3 ml-1" />}
          </Button>
        </div>

        {activeTab === "review" && isPaid ? (
          <ReviewTabContent
            reviewLineups={reviewLineups || []}
            isLoading={reviewLoading}
          />
        ) : (
          <>
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

            {sortedLineups.length > 0 ? (
              <div className="flex flex-col gap-5">
                {sortedLineups.map((lineup: any) => (
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
                    isPro={isPro}
                    isUpdating={updateMutation.isPending}
                    isSelected={selectedIds.has(lineup.id)}
                    onToggleSelect={() => toggleSelect(lineup.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-24 text-center bg-slate-800/10 rounded-3xl border-2 border-dashed border-slate-700/30">
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-emerald-500/40" />
                </div>
                <h5 className="text-xl font-black text-white mb-2" data-testid="no-lineups-message">No Saved Lineups Yet</h5>
                <p className="text-slate-400 max-w-sm mx-auto mb-6">Optimize a lineup and save it here to track, edit, and export to DraftKings.</p>
                <Link href="/">
                  <Button className="btn-primary" data-testid="build-first-lineup">
                    <Zap className="w-4 h-4 mr-2" /> Build Your First Lineup
                  </Button>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReviewTabContent({
  reviewLineups,
  isLoading,
}: {
  reviewLineups: any[];
  isLoading: boolean;
}) {
  const [expandedReviewId, setExpandedReviewId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => <Skeleton key={i} className="h-40 bg-slate-800 rounded-2xl" />)}
      </div>
    );
  }

  if (reviewLineups.length === 0) {
    return (
      <div className="py-24 text-center bg-slate-800/10 rounded-3xl border-2 border-dashed border-slate-700/30">
        <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-6">
          <History className="w-10 h-10 text-amber-500/40" />
        </div>
        <h5 className="text-xl font-black text-white mb-2" data-testid="no-review-lineups">No Review Lineups</h5>
        <p className="text-slate-400 max-w-sm mx-auto">
          Expired lineups are moved here at 2 AM ET for review. They are kept for 24 hours before being removed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="review-lineups-list">
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 mb-2">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-white">Review Mode</p>
            <p className="text-xs text-slate-400">These lineups have expired and are read-only. Compare your lineups against contest winners to learn and improve.</p>
          </div>
        </div>
      </div>

      {reviewLineups.map((lineup: any) => {
        const isExpanded = expandedReviewId === lineup.id;
        const isFD = lineup.platform === "fanduel";
        const platformLabel = isFD ? "FD" : "DK";
        const contestWinner = lineup.contestWinnerData;

        return (
          <Card
            key={lineup.id}
            className="bg-slate-800/20 border-slate-700/40"
            data-testid={`review-lineup-card-${lineup.id}`}
          >
            <div
              className="flex justify-between items-center p-5 cursor-pointer select-none"
              onClick={() => setExpandedReviewId(isExpanded ? null : lineup.id)}
              data-testid={`review-lineup-header-${lineup.id}`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-500/10 border border-amber-500/20`}>
                  <History className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-base font-black text-white">{lineup.name || "Optimized Lineup"}</h3>
                    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] font-black uppercase">
                      Review
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`${isFD ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"} text-[10px] font-black uppercase`}>
                      {lineup.sport} {platformLabel}
                    </Badge>
                    {lineup.reviewedAt && (
                      <span className="text-slate-500 text-[11px] font-medium">
                        Reviewed {new Date(lineup.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-5">
                <div className="hidden sm:flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Proj</p>
                    <p className="text-lg font-black text-emerald-400 tabular-nums" data-testid={`review-proj-${lineup.id}`}>{Number(lineup.totalProjectedPoints).toFixed(1)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Salary</p>
                    <p className="text-lg font-black text-white tabular-nums" data-testid={`review-salary-${lineup.id}`}>${lineup.totalSalary.toLocaleString()}</p>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-slate-700/40 p-5 bg-slate-900/30">
                {lineup.players && lineup.players.length > 0 ? (
                  <div className={contestWinner ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : ""}>
                    <div>
                      <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-emerald-400" /> Your Lineup
                      </h4>
                      <ReviewRosterTable players={lineup.players} sport={lineup.sport} platform={lineup.platform} totalSalary={lineup.totalSalary} totalProjectedPoints={lineup.totalProjectedPoints} />
                    </div>

                    {contestWinner && (
                      <div>
                        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                          <Trophy className="w-4 h-4 text-amber-400" /> Contest Winner
                        </h4>
                        <ReviewRosterTable
                          players={contestWinner.players || []}
                          sport={lineup.sport}
                          platform={lineup.platform}
                          totalSalary={contestWinner.totalSalary || 0}
                          totalProjectedPoints={contestWinner.totalProjectedPoints || "0"}
                          isWinner
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-400">Player data unavailable</p>
                      <p className="text-xs text-slate-400 mt-0.5">This lineup's player data was refreshed and can no longer be displayed.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ReviewRosterTable({
  players,
  sport,
  platform,
  totalSalary,
  totalProjectedPoints,
  isWinner = false,
}: {
  players: Player[];
  sport: string;
  platform: string;
  totalSalary: number;
  totalProjectedPoints: string;
  isWinner?: boolean;
}) {
  const config = getPlatformConfig(sport, platform as any);
  const slotAssignments = assignPlayersToSlots(players, config.slots, sport);
  const accentColor = isWinner ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="overflow-x-auto">
      <table className="w-full" data-testid={`review-roster-table-${isWinner ? "winner" : "yours"}`}>
        <thead>
          <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800">
            <th className="text-left py-2 pr-4 w-16">Slot</th>
            <th className="text-left py-2 pr-4">Player</th>
            <th className="text-left py-2 pr-4 w-16">Pos</th>
            <th className="text-left py-2 pr-4 w-16">Team</th>
            <th className="text-right py-2 pr-4 w-24">Salary</th>
            <th className="text-right py-2 pr-4 w-20">Proj</th>
          </tr>
        </thead>
        <tbody>
          {config.slots.map(slot => {
            const player = slotAssignments[slot];
            return (
              <tr key={slot} className="border-b border-slate-800/50">
                <td className="py-2 pr-4">
                  <span className="text-xs font-bold text-slate-400 bg-slate-800/80 px-2 py-1 rounded">
                    {getSlotDisplayName(slot)}
                  </span>
                </td>
                <td className="py-2 pr-4 text-sm font-semibold text-white">{player?.name || "—"}</td>
                <td className="py-2 pr-4 text-xs text-slate-400">{player?.position || "—"}</td>
                <td className="py-2 pr-4 text-xs text-slate-400">{player?.team || "—"}</td>
                <td className="py-2 pr-4 text-right text-sm font-medium text-white">
                  {player ? `$${player.salary.toLocaleString()}` : "—"}
                </td>
                <td className={`py-2 pr-4 text-right text-sm font-semibold ${accentColor}`}>
                  {player ? Number(player.projectedPoints).toFixed(1) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-700">
            <td colSpan={4} className="py-2 pr-4 text-xs font-bold text-slate-400 uppercase">Total</td>
            <td className="py-2 pr-4 text-right text-sm font-bold text-white">${totalSalary.toLocaleString()}</td>
            <td className={`py-2 pr-4 text-right text-sm font-bold ${accentColor}`}>{Number(totalProjectedPoints).toFixed(1)}</td>
          </tr>
        </tfoot>
      </table>
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
  isPro,
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
  isPro: boolean;
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
    <Card className={`bg-slate-800/20 border-slate-700/40 transition-all hover:border-slate-600/50 ${isSelected ? "ring-2 ring-emerald-500/50 border-emerald-500/30" : ""}`} data-testid={`lineup-card-${lineup.id}`}>
      <div
        className="flex justify-between items-center p-5 cursor-pointer select-none"
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
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isFD ? "bg-blue-500/10 border border-blue-500/20" : "bg-emerald-500/10 border border-emerald-500/20"}`}>
            <Trophy className={`w-5 h-5 ${isFD ? "text-blue-400" : "text-emerald-400"}`} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-base font-black text-white">{lineup.name || "Optimized Lineup"}</h3>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`${isFD ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"} text-[10px] font-black uppercase`}>
                {lineup.sport} {platformLabel}
              </Badge>
              {lineup.dkEntryId && (
                <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px] font-black uppercase" data-testid={`dk-import-badge-${lineup.id}`}>
                  DK Entry {lineup.dkEntryFee ? `· ${lineup.dkEntryFee}` : ""}
                </Badge>
              )}
              {lineup.isOrphaned && (
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] font-black uppercase" data-testid={`orphaned-badge-${lineup.id}`}>
                  <AlertTriangle className="w-3 h-3 mr-1" />Outdated
                </Badge>
              )}
              <span className="text-slate-500 text-[11px] font-medium">
                {new Date(lineup.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="hidden sm:flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Proj</p>
              <p className="text-lg font-black text-emerald-400 tabular-nums" data-testid={`lineup-proj-${lineup.id}`}>{Number(lineup.totalProjectedPoints).toFixed(1)}</p>
            </div>
            {isPaid ? (
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Proj. Own%</p>
                <p className={`text-lg font-black tabular-nums ${
                  (lineup.totalOwnership ?? 0) >= 150 ? "text-red-400" :
                  (lineup.totalOwnership ?? 0) >= 100 ? "text-amber-400" :
                  "text-purple-400"
                }`} data-testid={`lineup-own-${lineup.id}`}>
                  {(lineup.totalOwnership ?? 0).toFixed(0)}%
                </p>
              </div>
            ) : (
              <div className="text-right">
                <p className="text-[10px] font-black text-amber-500/70 uppercase tracking-widest flex items-center justify-end gap-1">
                  <Lock className="w-2.5 h-2.5" />Own%
                </p>
                <p className="text-lg font-black tabular-nums text-slate-600 blur-[3px] select-none">
                  {Math.round(Math.sin(lineup.id * 17) * 30 + 80)}%
                </p>
              </div>
            )}
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Salary</p>
              <p className="text-lg font-black text-white tabular-nums" data-testid={`lineup-salary-${lineup.id}`}>${lineup.totalSalary.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (lineupDetail) onExport(lineupDetail);
              }}
              disabled={!isExpanded || !lineupDetail}
              className={`h-8 w-8 ${isPaid ? "text-emerald-400 hover:bg-emerald-500/10" : "text-slate-500 opacity-50"}`}
              title={isPaid ? "Export CSV" : "Upgrade to export"}
              data-testid={`export-btn-${lineup.id}`}
            >
              {isPaid ? <Download className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="text-red-400 hover:bg-red-500/10 h-8 w-8"
              data-testid={`delete-btn-${lineup.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-700/40 p-5 bg-slate-900/30">
          {detailLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 bg-slate-800" />)}
            </div>
          ) : lineupDetail ? (
            <>
              {(lineupDetail as any).isOrphaned && (
                <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20" data-testid={`orphaned-notice-${lineup.id}`}>
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-400">Player data has been refreshed</p>
                    <p className="text-xs text-slate-400 mt-0.5">This lineup references players from a previous slate. Showing saved snapshot data. Swapping players is not available.</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="text-red-400 hover:bg-red-500/10 text-xs"
                    data-testid={`delete-orphaned-${lineup.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                  </Button>
                </div>
              )}
              <ExpandedRoster
                lineup={lineupDetail}
                onSwapPlayer={onSwapPlayer}
                swappingSlot={swappingSlot}
                setSwappingSlot={setSwappingSlot}
                isUpdating={isUpdating}
                isOrphaned={(lineupDetail as any).isOrphaned}
              />
            </>
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
  isOrphaned = false,
}: {
  lineup: LineupWithPlayers;
  onSwapPlayer: (lineupId: number, lineup: LineupWithPlayers, oldId: number, newId: number) => void;
  swappingSlot: { lineupId: number; slot: string; currentPlayerId: number } | null;
  setSwappingSlot: (s: { lineupId: number; slot: string; currentPlayerId: number } | null) => void;
  isUpdating: boolean;
  isOrphaned?: boolean;
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
                    {player ? Number(player.fppg || player.projectedPoints).toFixed(1) : "—"}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm font-semibold text-emerald-400">
                    {player ? Number(player.projectedPoints).toFixed(1) : "—"}
                  </td>
                  <td className="py-3 text-center">
                    {player && !isOrphaned && (
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
