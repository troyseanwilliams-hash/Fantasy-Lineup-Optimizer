import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Filter, RotateCcw, Save, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import type { Player, Slate } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePageMeta } from "@/hooks/use-page-meta";

type Override = {
  id?: number; playerId: number; customProjection: string | number | null; boostPercent: number;
  isExcluded: boolean; isLocked: boolean; minExposure: number | null; maxExposure: number | null; notes: string | null;
};
type Draft = Omit<Override, "id">;
type Exposure = { count: number; pct: number };
type Configuration = { slate: Slate; expiresAt: string; isExpired: boolean; players: Player[]; overrides: Override[]; exposures: Record<string, Exposure>; lineupCount: number };
type Sort = "name" | "exposure";

const cleanDraft = (playerId: number, source?: Override): Draft => ({
  playerId, customProjection: source?.customProjection ?? null, boostPercent: source?.boostPercent ?? 0,
  isExcluded: source?.isExcluded ?? false, isLocked: source?.isLocked ?? false,
  minExposure: source?.minExposure ?? null, maxExposure: source?.maxExposure ?? null, notes: source?.notes ?? null,
});

function inputNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function serverMessage(error: Error): string {
  const text = error.message.replace(/^\d+:\s*/, "");
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error || "The player setting could not be saved.";
  } catch {
    return text || "The player setting could not be saved.";
  }
}

function formatExposurePct(pct: number): string {
  return `${Math.round(pct * 10) / 10}%`;
}

export default function PlayerConfiguration() {
  usePageMeta({ title: "Player Configuration", description: "Persistent player controls for each DFS slate.", path: "/player-configuration" });
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const { data: slates } = useQuery<Slate[]>({
    queryKey: ["/api/slates", "includeStarted=true"],
    queryFn: async () => {
      const res = await fetch("/api/slates?includeStarted=true", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load available slates.");
      return res.json();
    },
  });
  const initialSlate = Number(new URLSearchParams(window.location.search).get("slateId"));
  const [slateId, setSlateId] = useState(Number.isFinite(initialSlate) && initialSlate > 0 ? initialSlate : 0);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [baseline, setBaseline] = useState<Record<number, Draft>>({});
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [overCapOnly, setOverCapOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ player: Player; override: Override } | null>(null);
  const initializedSlateRef = useRef<number | null>(null);
  const baselineRef = useRef<Record<number, Draft>>({});
  baselineRef.current = baseline;

  useEffect(() => {
    if (!slateId && slates?.length) setSlateId(slates.find(s => s.isActive !== false)?.id ?? slates[0].id);
  }, [slates, slateId]);

  const configQuery = useQuery<Configuration>({
    queryKey: ["/api/player-configuration", slateId],
    queryFn: async () => {
      const res = await fetch(`/api/player-configuration/${slateId}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text();
        let message = "Could not load this slate configuration.";
        try { message = JSON.parse(body).message || JSON.parse(body).error || message; } catch { message = body || message; }
        const error = new Error(message) as Error & { status?: number };
        error.status = res.status;
        throw error;
      }
      return res.json();
    },
    enabled: slateId > 0,
  });
  const config = configQuery.data;
  const isReadOnly = !!config?.isExpired;

  useEffect(() => {
    if (!config) return;
    const next: Record<number, Draft> = {};
    config.players.forEach(player => { next[player.id] = cleanDraft(player.id, config.overrides.find(o => o.playerId === player.id)); });
    if (initializedSlateRef.current !== config.slate.id) {
      initializedSlateRef.current = config.slate.id;
      baselineRef.current = next;
      setDrafts(next); setBaseline(next); setError(null); setUndo(null);
      return;
    }
    // A refetch confirms saved data but must never discard a separate player's
    // in-progress draft (or the reset undo affordance).
    const previous = baselineRef.current;
    baselineRef.current = next;
    setBaseline(next);
    setDrafts(current => Object.fromEntries(config.players.map(player => {
      const currentDraft = current[player.id] ?? cleanDraft(player.id);
      const wasUntouched = JSON.stringify(currentDraft) === JSON.stringify(previous[player.id]);
      return [player.id, wasUntouched ? next[player.id] : currentDraft];
    })));
  }, [config]);

  const dirtyIds = useMemo(() => Object.keys(drafts).map(Number).filter(id => JSON.stringify(drafts[id]) !== JSON.stringify(baseline[id])), [drafts, baseline]);
  const setDraft = (id: number, updates: Partial<Draft>) => setDrafts(current => ({ ...current, [id]: { ...(current[id] ?? cleanDraft(id)), ...updates } }));
  const selectSlate = (id: number) => {
    if (id === slateId) return;
    if (dirtyIds.length && !window.confirm("Discard unsaved player changes and switch slates?")) return;
    setSlateId(id); setLocation(`/player-config?slateId=${id}`);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/player-configuration"] });
    queryClient.invalidateQueries({ queryKey: ["/api/player-overrides"] });
  };
  const saveMutation = useMutation({
    mutationFn: async ({ player, draft, targetSlateId }: { player: Player; draft: Draft; targetSlateId: number }) => {
      const body = { ...draft, customProjection: draft.customProjection === null ? null : Number(draft.customProjection), dkPlayerId: player.draftKingsPlayerId ?? undefined };
      await apiRequest("PUT", `/api/player-overrides/${targetSlateId}/${player.id}`, body);
    },
    onSuccess: (_, variables) => {
      if (slateId === variables.targetSlateId) setBaseline(current => ({ ...current, [variables.player.id]: variables.draft }));
      invalidate();
      toast({ title: "Player setting saved", description: "This control will apply to future optimizer and Resim batches." });
    },
    onError: (err: Error) => setError(serverMessage(err)),
  });
  const resetMutation = useMutation({
    mutationFn: async ({ playerId, targetSlateId }: { playerId: number; targetSlateId: number }) => { await apiRequest("DELETE", `/api/player-overrides/${targetSlateId}/${playerId}`); },
    onSuccess: (_, { playerId, targetSlateId }) => {
      if (slateId !== targetSlateId) return;
      const player = config?.players.find(p => p.id === playerId);
      const previous = config?.overrides.find(o => o.playerId === playerId);
      if (player && previous) setUndo({ player, override: previous });
      setDrafts(current => ({ ...current, [playerId]: cleanDraft(playerId) }));
      setBaseline(current => ({ ...current, [playerId]: cleanDraft(playerId) }));
      invalidate();
    },
    onError: (err: Error) => setError(serverMessage(err)),
  });
  const clearMutation = useMutation({
    mutationFn: async (targetSlateId: number) => { await apiRequest("DELETE", `/api/player-overrides/${targetSlateId}`); },
    onSuccess: (_, targetSlateId) => {
      if (slateId === targetSlateId && config) {
        const empty = Object.fromEntries(config.players.map(player => [player.id, cleanDraft(player.id)]));
        baselineRef.current = empty; setDrafts(empty); setBaseline(empty); setUndo(null);
      }
      invalidate(); toast({ title: "Slate settings cleared", description: "All personal player settings for this slate were removed." });
    },
    onError: (err: Error) => setError(serverMessage(err)),
  });
  const savePlayer = (player: Player) => {
    const draft = drafts[player.id];
    if (!draft || isReadOnly) return;
    const min = draft.minExposure, max = draft.maxExposure;
    if ((min !== null && (!Number.isInteger(min) || min < 0 || min > 100)) || (max !== null && (!Number.isInteger(max) || max < 0 || max > 100))) return setError("Exposure limits must be whole numbers between 0 and 100.");
    const projection = draft.customProjection === null ? null : Number(draft.customProjection);
    if (projection !== null && (!Number.isFinite(projection) || projection < 0 || projection > 500)) return setError("Custom projection must be between 0 and 500.");
    if ((draft.notes?.length ?? 0) > 200) return setError("Notes are limited to 200 characters.");
    if (min !== null && max !== null && min > max) return setError("Minimum exposure cannot exceed maximum exposure.");
    if (draft.isExcluded && min !== null && min > 0) return setError("An excluded player cannot have a positive minimum exposure.");
    if (draft.isLocked && (draft.isExcluded || (max !== null && max < 100))) return setError("A locked player cannot be excluded or capped below 100%.");
    setError(null); saveMutation.mutate({ player, draft, targetSlateId: slateId });
  };
  const undoReset = () => {
    if (!undo) return;
    setDrafts(current => ({ ...current, [undo.player.id]: cleanDraft(undo.player.id, undo.override) }));
    saveMutation.mutate({ player: undo.player, draft: cleanDraft(undo.player.id, undo.override), targetSlateId: slateId });
    setUndo(null);
  };

  const rows = useMemo(() => {
    if (!config) return [];
    const term = search.trim().toLowerCase();
    return config.players.filter(player => {
      const exposure = config.exposures[String(player.id)];
      const cap = drafts[player.id]?.maxExposure;
      return (!term || `${player.name} ${player.position} ${player.team}`.toLowerCase().includes(term))
        && (position === "ALL" || player.position.includes(position)) && (team === "ALL" || player.team === team)
        && (!overCapOnly || (cap !== null && cap !== undefined && (exposure?.pct ?? 0) > cap));
    }).sort((a, b) => sort === "exposure" ? (config.exposures[String(b.id)]?.pct ?? 0) - (config.exposures[String(a.id)]?.pct ?? 0) : a.name.localeCompare(b.name));
  }, [config, drafts, search, position, team, overCapOnly, sort]);
  const positions = useMemo(() => Array.from(new Set(config?.players.flatMap(p => p.position.split("/")) ?? [])).sort(), [config]);
  const teams = useMemo(() => Array.from(new Set(config?.players.map(p => p.team) ?? [])).sort(), [config]);

  if (!authLoading && !user) return <div className="mx-auto max-w-3xl px-4 py-16 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-amber-400" /><h1 className="mt-4 text-xl font-black text-white">Sign in to manage player settings</h1><p className="mt-2 text-slate-400">Your player controls are personal and slate-scoped.</p><Link href="/login" className="mt-5 inline-flex h-10 items-center rounded-md bg-emerald-500 px-4 text-sm font-bold text-slate-950">Sign in</Link></div>;
  if (configQuery.isLoading || !slateId) return <div className="mx-auto max-w-7xl px-4 py-10 animate-pulse"><div className="h-36 rounded-xl bg-slate-800" /><div className="mt-5 h-96 rounded-xl bg-slate-800/70" /></div>;
  if (configQuery.isError) {
    const denied = (configQuery.error as Error & { status?: number }).status === 403;
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-amber-400" /><h1 className="mt-4 text-xl font-black text-white">{denied ? "Player Configuration is a paid feature" : "Configuration unavailable"}</h1><p className="mt-2 text-slate-400">{configQuery.error.message}</p>{denied ? <Link href="/pricing" className="mt-5 inline-flex h-10 items-center rounded-md bg-amber-400 px-4 text-sm font-bold text-slate-950">View plans</Link> : <Button className="mt-5" onClick={() => configQuery.refetch()}>Try again</Button>}</div>;
  }
  if (!config) return null;

  return <div className="min-h-[100dvh] bg-[#0F172A] text-slate-100">
    <div className="mx-auto max-w-[1500px] px-3 py-5 sm:px-6 lg:py-8">
      <header className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/20">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div><div className="flex items-center gap-2 text-emerald-400"><SlidersHorizontal className="h-4 w-4" /><span className="text-[11px] font-black uppercase tracking-[.18em]">Portfolio controls</span></div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Player Configuration</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Persistent controls for <span className="font-bold text-slate-200">{config.slate.name}</span>. Per-player caps apply to each new optimizer or Resim batch; saved lineups are never changed retroactively.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><label className="text-xs font-bold text-slate-400" htmlFor="slate-picker">Slate</label><select id="slate-picker" value={slateId} onChange={e => selectSlate(Number(e.target.value))} className="h-10 min-w-56 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-slate-100">{slates?.map(s => <option key={s.id} value={s.id}>{s.sport} · {s.name}{s.isActive === false ? " (inactive)" : ""}</option>)}</select></div>
        </div>
        {isReadOnly ? <div className="mt-5 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>This slate expired {new Date(config.expiresAt).toLocaleString()}. Its settings are preserved for reference and are read-only; no other slate has been selected.</span></div> :
          <div className="mt-5 grid gap-3 border-t border-slate-800 pt-4 text-xs sm:grid-cols-3"><div><span className="text-slate-500">Saved lineups</span><strong className="ml-2 text-slate-200">{config.lineupCount}</strong></div><div className="text-slate-400">A stronger global exposure cap still wins.</div><Link href={`/optimizer/${slateId}`} className="font-bold text-emerald-400 hover:text-emerald-300">Open optimizer for this slate</Link></div>}
      </header>
      {error && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      {undo && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"><span>Reset saved for {undo.player.name}.</span><Button variant="outline" size="sm" onClick={undoReset}>Undo reset</Button></div>}
      <section className="mt-5 rounded-xl border border-slate-700/80 bg-slate-900/55">
        <div className="flex flex-col gap-3 border-b border-slate-800 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row"><label className="relative flex-1"><span className="sr-only">Search players</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player, position, or team" className="border-slate-700 bg-slate-950 pl-9" /></label>
            <select aria-label="Filter position" value={position} onChange={e => setPosition(e.target.value)} className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option>ALL</option>{positions.map(value => <option key={value}>{value}</option>)}</select>
            <select aria-label="Filter team" value={team} onChange={e => setTeam(e.target.value)} className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option>ALL</option>{teams.map(value => <option key={value}>{value}</option>)}</select></div>
          <div className="flex items-center gap-3"><label className="flex items-center gap-2 whitespace-nowrap text-xs font-bold text-slate-400"><Switch checked={overCapOnly} onCheckedChange={setOverCapOnly} />Above saved cap</label><Button variant="outline" size="sm" onClick={() => setSort(sort === "name" ? "exposure" : "name")}><Filter className="mr-1 h-3.5 w-3.5" />Sort: {sort}</Button>{!isReadOnly && <Button variant="outline" size="sm" onClick={() => { if (window.confirm("Clear all personal player settings for this slate?")) clearMutation.mutate(slateId); }} disabled={clearMutation.isPending}><RotateCcw className="mr-1 h-3.5 w-3.5" />Clear slate</Button>}</div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left"><thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Player</th><th>Saved exposure</th><th>Projection</th><th>Boost</th><th>Min / Max per batch</th><th>Include</th><th>Lock</th><th>Notes</th><th className="pr-4 text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-800">{rows.map(player => { const draft = drafts[player.id] ?? cleanDraft(player.id); const exposure = config.exposures[String(player.id)]; const over = draft.maxExposure !== null && (exposure?.pct ?? 0) > draft.maxExposure; const field = (key: "minExposure" | "maxExposure") => ({ value: draft[key] ?? "", onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(player.id, { [key]: inputNumber(e.target.value) }) }); return <tr key={player.id} className={over ? "bg-amber-500/[.045]" : ""}>
            <td className="px-4 py-3"><div className="font-bold text-slate-100">{player.name}</div><div className="mt-0.5 text-xs text-slate-500">{player.position} · {player.team} · ${player.salary.toLocaleString()}</div></td>
            <td className="py-3"><div className={over ? "font-black text-amber-300" : "font-bold text-slate-300"}>{exposure ? formatExposurePct(exposure.pct) : "—"}</div><div className="text-[11px] text-slate-500">{exposure ? `${exposure.count} of ${config.lineupCount}` : "No saved exposure"}</div></td>
            <td><Input aria-label={`${player.name} custom projection`} disabled={isReadOnly} type="number" min="0" max="500" step="0.1" value={draft.customProjection ?? ""} onChange={e => setDraft(player.id, { customProjection: inputNumber(e.target.value) })} placeholder={String(player.projectedPoints)} className="h-8 w-20 border-slate-700 bg-slate-950 px-2 text-xs" /></td>
            <td><select aria-label={`${player.name} boost`} disabled={isReadOnly} value={draft.boostPercent} onChange={e => setDraft(player.id, { boostPercent: Number(e.target.value) as 0 | 5 | 10 | 15 | 20 })} className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-xs">{[0,5,10,15,20].map(v => <option key={v} value={v}>{v}%</option>)}</select></td>
            <td><div className="flex items-center gap-1"><Input aria-label={`${player.name} minimum exposure`} disabled={isReadOnly} type="number" min="0" max="100" {...field("minExposure")} className="h-8 w-14 border-slate-700 bg-slate-950 px-2 text-xs" /><span className="text-slate-600">/</span><Input aria-label={`${player.name} maximum exposure`} disabled={isReadOnly} type="number" min="0" max="100" {...field("maxExposure")} className="h-8 w-14 border-slate-700 bg-slate-950 px-2 text-xs" /></div></td>
            <td><Switch aria-label={`${player.name} excluded`} disabled={isReadOnly} checked={draft.isExcluded} onCheckedChange={checked => setDraft(player.id, { isExcluded: checked, ...(checked ? { isLocked: false } : {}) })} /></td>
            <td><Switch aria-label={`${player.name} locked`} disabled={isReadOnly} checked={draft.isLocked} onCheckedChange={checked => setDraft(player.id, { isLocked: checked })} /></td>
            <td><Input aria-label={`${player.name} notes`} disabled={isReadOnly} maxLength={200} value={draft.notes ?? ""} onChange={e => setDraft(player.id, { notes: e.target.value || null })} className="h-8 w-40 border-slate-700 bg-slate-950 px-2 text-xs" /></td>
            <td className="pr-4 text-right"><div className="flex justify-end gap-1">{!isReadOnly && <Button size="sm" className="h-8 px-2" disabled={!dirtyIds.includes(player.id) || saveMutation.isPending} onClick={() => savePlayer(player)}><Save className="h-3.5 w-3.5" /><span className="sr-only">Save {player.name}</span></Button>}{!isReadOnly && baseline[player.id] && <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-400" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate({ playerId: player.id, targetSlateId: slateId })}><RotateCcw className="h-3.5 w-3.5" /><span className="sr-only">Reset {player.name}</span></Button>}</div></td>
          </tr>; })}</tbody></table></div>
        {rows.length === 0 && <div className="p-12 text-center text-sm text-slate-500">No players match these view filters.</div>}
      </section>
      <p className="mt-4 text-xs leading-5 text-slate-500">Saved exposure is a report of existing saved lineups, not a setting owner. New controls are scoped to this exact slate and are used only when a new batch is created.</p>
    </div>
  </div>;
}