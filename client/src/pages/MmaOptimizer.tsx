import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, Download, FileUp, Lock, ShieldCheck, Swords, Unlock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { usePageMeta } from "@/hooks/use-page-meta";
import {
  exportMmaLineups, MMA_MAX_FILE_BYTES, MMA_SALARY_CAP, optimizeMmaLineups,
  parseDraftKingsMmaCsv, type MmaFighter, type MmaLineup,
} from "@/lib/mma-optimizer";

export default function MmaOptimizer() {
  usePageMeta({ title: "UFC / MMA Optimizer", description: "Import a DraftKings MMA salary CSV, enter projections, and build valid six-fighter lineups.", path: "/mma-optimizer" });
  const inputRef = useRef<HTMLInputElement>(null);
  const [fighters, setFighters] = useState<MmaFighter[]>([]);
  const [lineups, setLineups] = useState<MmaLineup[]>([]);
  const [filename, setFilename] = useState("");
  const [count, setCount] = useState(1);
  const [avoidOpponents, setAvoidOpponents] = useState(true);
  const [error, setError] = useState("");
  const now = Date.now();
  const invalidate = () => setLineups([]);
  const eligibleCount = useMemo(() => fighters.filter(f => !f.excluded && (f.startTime === null || f.startTime > now)).length, [fighters, now]);

  const importFile = async (file?: File) => {
    setError("");
    setLineups([]);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setError("Choose an official DraftKings .csv salary file.");
    if (file.size > MMA_MAX_FILE_BYTES) return setError("CSV is too large. The maximum file size is 2 MB.");
    try {
      const parsed = parseDraftKingsMmaCsv(await file.text());
      setFighters(parsed);
      setFilename(file.name);
    } catch (cause) {
      setFighters([]);
      setFilename("");
      setError(cause instanceof Error ? cause.message : "The salary CSV could not be read.");
    }
  };

  const update = (id: string, patch: Partial<MmaFighter>) => {
    setFighters(current => current.map(f => f.id === id ? { ...f, ...patch } : f));
    invalidate();
    setError("");
  };
  const generate = () => {
    setError("");
    try { setLineups(optimizeMmaLineups(fighters, count, avoidOpponents)); }
    catch (cause) { setLineups([]); setError(cause instanceof Error ? cause.message : "Lineups could not be generated."); }
  };
  const download = () => {
    try {
      const csv = exportMmaLineups(lineups, fighters, Date.now());
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "draftkings-mma-lineups.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Export failed."); }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-400"><Swords className="h-3.5 w-3.5" /> DraftKings Classic</div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">UFC / MMA Lineup Optimizer</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Bring the official DraftKings MMA salary CSV, enter your own projections, then optimize 6 unique fighters under the $50,000 cap.</p>
          </div>
          <Button onClick={() => inputRef.current?.click()} className="bg-emerald-500 font-bold text-slate-950 hover:bg-emerald-400">
            <FileUp className="mr-2 h-4 w-4" /> {fighters.length ? "Replace salary CSV" : "Import salary CSV"}
          </Button>
          <input ref={inputRef} className="hidden" type="file" accept=".csv,text/csv" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        {error && <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" /><span>{error}</span></div>}

        {!fighters.length ? (
          <Card className="border-slate-700 bg-slate-900/60 p-6 sm:p-10">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10"><FileUp className="h-7 w-7 text-emerald-400" /></div>
              <h2 className="text-xl font-black text-white">Start with a DraftKings salary file</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Download the CSV from the DraftKings contest lobby’s player list, then import it here. The public lobby does not provide a dependable live MMA slate, so this tool never invents salaries or fighters.</p>
              <p className="mt-3 text-xs text-amber-300">AvgPointsPerGame is historical data—not a projection—and is intentionally ignored. You must enter a projection for every included fighter.</p>
            </div>
          </Card>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="font-black">Fighter pool</h2><p className="text-xs text-slate-500">{filename} · {eligibleCount} eligible of {fighters.length}</p></div>
                <div className="text-xs text-slate-400">Official IDs preserved from upload</div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/50">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-700 bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-400"><tr><th className="p-3">Fighter</th><th className="p-3">Salary</th><th className="p-3">Fight</th><th className="p-3">Projection</th><th className="p-3 text-center">Lock</th><th className="p-3 text-center">Exclude</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {fighters.map(f => {
                      const started = f.startTime !== null && f.startTime <= now;
                      return <tr key={f.id} className={f.excluded || started ? "opacity-45" : "hover:bg-slate-800/30"}>
                        <td className="p-3"><div className="font-bold text-white">{f.name}</div><div className="text-[11px] text-slate-500">DK ID {f.id}</div></td>
                        <td className="p-3 font-mono font-bold">${f.salary.toLocaleString()}</td>
                        <td className="max-w-[230px] p-3 text-xs text-slate-400">{f.gameInfo || "Time not supplied"}{started && <div className="mt-1 font-bold text-red-400">Already started — blocked</div>}</td>
                        <td className="p-3"><input aria-label={`${f.name} projection`} type="number" min="0" step="0.1" value={f.projection ?? ""} disabled={f.excluded || started} placeholder="Required" onChange={e => update(f.id, { projection: e.target.value === "" ? null : Number(e.target.value) })} className="w-28 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-white outline-none focus:border-emerald-500 disabled:cursor-not-allowed" /></td>
                        <td className="p-3 text-center"><button aria-label={`${f.locked ? "Unlock" : "Lock"} ${f.name}`} disabled={f.excluded || started} onClick={() => update(f.id, { locked: !f.locked })} className={`rounded-lg p-2 ${f.locked ? "bg-emerald-500 text-slate-950" : "text-slate-500 hover:bg-slate-800 hover:text-white"} disabled:cursor-not-allowed`}>{f.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</button></td>
                        <td className="p-3 text-center"><button aria-label={`${f.excluded ? "Include" : "Exclude"} ${f.name}`} disabled={f.locked || started} onClick={() => update(f.id, { excluded: !f.excluded })} className={`rounded-lg p-2 ${f.excluded ? "bg-red-500 text-white" : "text-slate-500 hover:bg-slate-800 hover:text-red-400"} disabled:cursor-not-allowed`}><Ban className="h-4 w-4" /></button></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className="space-y-4">
              <Card className="border-slate-700 bg-slate-900/70 p-5">
                <h2 className="mb-5 flex items-center gap-2 font-black text-white"><Zap className="h-4 w-4 text-emerald-400" /> Build settings</h2>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Lineups (1–20)</label>
                <input aria-label="Number of lineups" type="number" min="1" max="20" value={count} onChange={e => { setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1))); invalidate(); }} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" />
                <div className="my-5 flex items-start justify-between gap-4"><div><div className="text-sm font-bold text-white">Avoid opponents</div><div className="mt-1 text-xs text-slate-500">Applied only when a recognizable matchup separator appears in the CSV.</div></div><Switch aria-label="Avoid opponents in the same lineup" checked={avoidOpponents} onCheckedChange={value => { setAvoidOpponents(value); invalidate(); }} /></div>
                <div className="mb-5 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-slate-950 p-3"><div className="text-lg font-black text-white">{eligibleCount}</div><div className="text-[10px] uppercase text-slate-500">Pool</div></div><div className="rounded-lg bg-slate-950 p-3"><div className="text-lg font-black text-emerald-400">${MMA_SALARY_CAP.toLocaleString()}</div><div className="text-[10px] uppercase text-slate-500">Budget</div></div></div>
                <Button className="w-full bg-emerald-500 font-black text-slate-950 hover:bg-emerald-400" onClick={generate}>Generate lineups</Button>
              </Card>
              <Card className="border-slate-700 bg-slate-900/70 p-5 text-xs leading-5 text-slate-400"><div className="mb-2 flex items-center gap-2 font-bold text-slate-200"><ShieldCheck className="h-4 w-4 text-emerald-400" /> CSV scope</div>Dates, IDs, salaries, fight times, and recognizable matchups come only from your file. This does not verify that the upload is current or valid for a particular contest.{fighters.some(f => f.startTime === null) && <div className="mt-2 text-amber-300">One or more fight times could not be parsed. Their start status cannot be determined from this CSV.</div>}</Card>
            </aside>
          </div>
        )}

        {lineups.length > 0 && <section className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-xl font-black">Optimized lineups</h2><p className="text-xs text-slate-500">{lineups.length} unique result{lineups.length === 1 ? "" : "s"}</p></div><Button variant="outline" onClick={download} className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"><Download className="mr-2 h-4 w-4" /> Export DK CSV</Button></div>
          <div className="grid gap-3 lg:grid-cols-2">{lineups.map((lineup, index) => <Card key={lineup.fighters.map(f => f.id).join("-")} className="border-slate-700 bg-slate-900/60 p-4"><div className="mb-3 flex items-center justify-between"><span className="font-black text-white">Lineup {index + 1}</span><div className="text-right"><div className="font-mono font-bold text-emerald-400">{lineup.projection.toFixed(1)} pts</div><div className="text-[11px] text-slate-500">${lineup.salary.toLocaleString()} · ${(MMA_SALARY_CAP - lineup.salary).toLocaleString()} left</div></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{lineup.fighters.map(f => <div key={f.id} className="rounded-lg bg-slate-950 p-2"><div className="truncate text-xs font-bold text-white">{f.name}</div><div className="mt-1 text-[10px] text-slate-500">${f.salary.toLocaleString()} · {f.projection?.toFixed(1)}</div></div>)}</div></Card>)}</div>
        </section>}
      </div>
    </div>
  );
}