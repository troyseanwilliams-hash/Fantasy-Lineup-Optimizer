import { useMemo, useRef, useState, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { parseClassicInputs, classicInputHeaderCsv } from "@shared/nfl-classic-inputs";
import { classicLogicSchema, hasRole, rushingQualified, type ClassicLogic } from "@shared/nfl-classic-logic";
import { DEFAULT_NFL_PORTFOLIO, nflPortfolioSettingsSchema, type NflPortfolioSettings, type NflPortfolioReport } from "@shared/nfl-portfolio";
import { QualitySearchDiagnostics } from "@/components/QualitySearchDiagnostics";

export function useNflPortfolio(userId?: string | number, slateId?: number | null) {
  const key = userId && Number.isInteger(slateId) && Number(slateId) > 0 ? `nfl-classic:v1:${userId}:${slateId}` : "";
  const defaults = () => ({ ...structuredClone(DEFAULT_NFL_PORTFOLIO), enabled: true });
  const restored = useMemo(() => {
    try {
      const parsed = key ? nflPortfolioSettingsSchema.safeParse(JSON.parse(localStorage.getItem(key) || "null")) : null;
      if (parsed?.success) return { ...parsed.data, enabled: true };
    } catch { /* Invalid or unavailable browser storage never supplies evidence. */ }
    return defaults();
  }, [key, slateId]);
  const [state, setState] = useState({ key, value: restored });
  // A new scope gets its own settings during render, before any request can run.
  const settings = state.key === key ? state.value : restored;
  const scope = useRef(key);
  scope.current = key;
  const setSettings = (update: SetStateAction<NflPortfolioSettings>) => {
    if (scope.current !== key) return;
    const next = { ...(typeof update === "function" ? update(settings) : update), enabled: true };
    setState({ key, value: next });
    try { if (key) localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session state still works. */ }
  };
  const [report, setReport] = useState<NflPortfolioReport | undefined>();
  const error = settings.enabled ? nflPortfolioSettingsSchema.safeParse(settings) : null;
  const scopeError = settings.classic && settings.classic.slateId !== slateId ? "Classic evidence belongs to a different slate. Clear it or import evidence for this exact slate before building." : "";
  return { settings, setSettings, report, setReport, error: scopeError || (error && !error.success ? error.error.issues.map(i => i.message).join(" ") : ""), reset: () => { setSettings(defaults()); setReport(undefined); } };
}

export function ClassicInputGuide() {
  return <details className="space-y-2"><summary className="cursor-pointer font-bold">Exact input format / Recent JSON example</summary>
    <p>CSV matches Name + Team exactly to the current pool. JSON uses the full ClassicLogic object with projectionSource: "DFS Army", this exact slateId, and players keyed by pool IDs. No fuzzy IDs or alternate-player guesses.</p>
    <p>Required per player: projection, ownership (0–100), status, statusCheckedAt, depthChartNotes, weatherNotes, weatherCheckedAt. Timestamps must be ISO date-times. Status: ACTIVE, QUESTIONABLE, OUT, INACTIVE, IR, PUP, EXEMPT, SUSPENDED or DOUBTFUL.</p>
    <p>Recent is a JSON array of the last 2–3 chronological games, oldest first. Each game supports targets, carries, routes, snaps, rushYards and actualPoints. Omit unknown fields; missing evidence is not guessed.</p>
    <pre className="overflow-auto rounded border border-slate-700 bg-slate-950 p-2 text-[11px]">{'[{"targets":5,"carries":0,"routes":24,"snaps":41,"rushYards":0,"actualPoints":12.6},{"targets":7,"carries":1,"routes":29,"snaps":48,"rushYards":6,"actualPoints":17.3}]'}</pre>
    <p>In CSV, quote the Recent cell and double its internal quotes. Opportunity: producing / opening / fading / none. Boolean columns accept yes/no, true/false or 1/0.</p>
    <p>Optional evidence: Punt, ValueTier, Chalk, RushingQB, RoadUnderdogSpread, OpponentImpliedTotal, OpponentSackRate, OpponentFumbleRate, OpponentIntRate, EliteTurnoverMatchup, TopDefense, Ceiling. Role-dependent eligibility requires recent workload and opportunity evidence. Defensive matchup fields are not inferred.</p>
    <button type="button" className="rounded border border-amber-500/40 px-3 py-2 text-amber-300" onClick={() => {
      const url = URL.createObjectURL(new Blob([classicInputHeaderCsv()], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = "classic-formula-input-header.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Download exact CSV header</button>
  </details>;
}

interface ClassicInputPoolPlayer {
  id: number;
  slateId: number;
  name: string;
  team: string;
  position: string;
  salary: number;
  injuryStatus: string | null;
}

export function NflPortfolioControls({ settings: s, onChange, supported, slateId, single = false }: {
  settings: NflPortfolioSettings; onChange: (s: NflPortfolioSettings) => void; supported: boolean;
  players: Array<{ id: number; name: string; position: string; team?: string; slateId?: number }>; slateId: number; single?: boolean;
}) {
  const [importError, setImportError] = useState("");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const inputPool = useQuery<ClassicInputPoolPlayer[]>({
    queryKey: ["/api/nfl/classic-input-pool", slateId, user?.id],
    enabled: supported && !!user && Number.isInteger(slateId) && slateId > 0,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/nfl/classic-input-pool/${slateId}`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || !rows.length || rows.some(p =>
        !p || !Number.isSafeInteger(p.id) || p.id <= 0 || p.slateId !== slateId ||
        typeof p.name !== "string" || typeof p.team !== "string" || typeof p.position !== "string"
      ) || new Set(rows.map(p => p.id)).size !== rows.length) {
        throw new Error("The full Classic input pool is empty, invalid, or belongs to a different slate. Import is blocked until the complete pool can be verified.");
      }
      return rows as ClassicInputPoolPlayer[];
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const currentSlate = useRef(slateId); currentSlate.current = slateId;
  const classic: ClassicLogic = s.classic ?? { projectionSource: "App data", slateId, players: {}, anchors: {}, fullArchitecturePct: 34, doubleStackPct: 65, bringBackPct: 45, nakedPct: 0 };
  const appData = classic.projectionSource === "App data";
  const update = (next: ClassicLogic) => onChange({ ...s, enabled: true, classic: next });
  // Never use the visible optimizer pool: it omits unavailable players.
  const poolReady = !!user && inputPool.isSuccess && !inputPool.isFetching;
  const pool = poolReady ? inputPool.data ?? [] : [];
  const slateMismatch = classic.slateId !== slateId;
  const unknownIds = poolReady ? Object.keys(classic.players).filter(id => !pool.some(p => String(p.id) === id)) : [];
  const unknownAnchors = poolReady ? Object.keys(classic.anchors).filter(id => !pool.some(p => String(p.id) === id)) : [];
  const evidenceError = slateMismatch ? `Evidence slate #${classic.slateId} does not match current slate #${slateId}. Clear it or import the exact current-slate file.`
    : unknownIds.length || unknownAnchors.length ? `Evidence contains player or anchor IDs outside the full current slate pool: ${Array.from(new Set([...unknownIds, ...unknownAnchors])).join(", ")}. Clear it or import corrected evidence; these IDs cannot be matched or guessed.` : "";
  const covered = slateMismatch ? [] : pool.filter(p => classic.players[String(p.id)]);
  const anchors = Object.keys(classic.anchors);
  const parsed = classicLogicSchema.safeParse(classic);
  if (!supported) return null;
  return <details className="rounded-lg border border-amber-500/30 bg-slate-900 p-3 text-xs space-y-4" data-testid="nfl-portfolio-controls">
    <summary className="cursor-pointer font-bold text-amber-300">NFL Classic Logic · Always enabled · {classic.projectionSource} · Slate #{slateId}</summary>
    <p>{appData ? "No upload needed. Uses current slate projections, app ownership estimates and recorded injury statuses. Weather, injury-review freshness, role-based minimums and defensive matchup screens are not verified. Naked QBs are disabled; anchors are optional manual targets." : "Using imported DFS Army evidence. Fresh full-pool evidence and 2–3 verified anchors are required."}</p>
    {!appData && <button type="button" className="rounded border border-slate-600 px-3 py-2" onClick={() => onChange({ ...s, enabled: true, classic: { ...classic, projectionSource: "App data", players: {}, anchors: {}, nakedPct: 0 } })}>Use current app data instead</button>}
    <p>Legacy Ceiling, Leverage, Outperformer, Simulation and settings controls remain available above this logic. Classic rules always apply to supported DraftKings Classic GPP builds.</p>
    <div className="rounded border border-slate-700 p-3 space-y-2">
      <p><strong>115%</strong> total lineup ownership cap · <strong>4 points</strong> minimum skill-player projection · <strong>3 uniques</strong> between lineups.</p>
      <p>Position exposure caps: QB 27% / RB 35% / WR 30% / TE 25% / DST 27%. Counts round down. Batch count must be at least 4 for cap feasibility; pool restrictions can require more.</p>
      {single && <p className="text-amber-200">Normal Optimizer builds one lineup and cannot certify a single lineup under Classic portfolio caps. The backend requires at least 4 lineups. Use batch Pro / Sim; your existing 150-lineup and simulation controls are unchanged.</p>}
      <p>Double stacks lead. Full architecture is an overlapping target, not an additional bucket. No naked pocket QBs: naked builds require imported rushing evidence (at least 4 carries and 25 rushing yards in each of the last 2–3 games).</p>
    </div>
    {inputPool.isFetching && <div role="status" className="animate-pulse rounded border border-slate-700 p-3">Verifying the full Classic player pool, including OUT / IR / PUP players…</div>}
    {!user && <p role="alert" className="text-amber-200">Sign in to load the complete authenticated Classic input pool. Importing is disabled.</p>}
    {inputPool.isError && <div role="alert" className="space-y-2 rounded border border-red-400/40 p-3 text-red-300"><p>Could not verify the full Classic input pool. {inputPool.error instanceof Error ? inputPool.error.message : "Please retry."} Importing and anchor editing are disabled; the filtered optimizer list will not be substituted.</p><button type="button" className="rounded border border-red-300/40 px-3 py-2" disabled={inputPool.isFetching} onClick={() => { void inputPool.refetch(); }}>Retry full pool</button></div>}
    {evidenceError && <p role="alert" className="rounded border border-red-400/40 p-3 text-red-300">{evidenceError}</p>}
    <fieldset disabled={!!evidenceError} className="grid md:grid-cols-2 gap-3">{([
      ["fullArchitecturePct", "Full architecture %", 0, 45],
      ["doubleStackPct", "Double stack %", 51, 100],
      ["bringBackPct", "Bring-back %", 35, 55],
      ["nakedPct", "Verified rushing naked %", 0, 10],
    ] as const).map(([key, label, min, max]) => <label key={key} className="flex items-center justify-between gap-2">{label}<input className="w-20 rounded bg-slate-950 border border-slate-700 p-2" type="number" aria-label={label} min={min} max={max} value={classic[key]} onChange={e => update({ ...classic, [key]: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>)}</fieldset>
    <label className="block space-y-2 font-semibold">Optional: switch to strict imported evidence CSV / JSON
      <input className="block w-full text-xs" type="file" accept=".csv,.json,text/csv,application/json" disabled={busy || !poolReady || !pool.length} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
        const importingSlate = slateId; setBusy(true); setImportError("");
        try {
          const imported = parseClassicInputs(await file.text(), pool, importingSlate);
          if (currentSlate.current === importingSlate) update(imported);
        } catch (error) { if (currentSlate.current === importingSlate) setImportError(error instanceof Error ? error.message : "Import failed. Choose corrected evidence and retry."); }
        finally { setBusy(false); }
      }} />
    </label>
    {busy && <p role="status" className="animate-pulse">Validating exact player matches and evidence…</p>}
    {importError && <p role="alert" className="text-red-300">{importError} Select a corrected file to retry.</p>}
    {poolReady && <p role="status">Full-pool imported coverage (including OUT / IR / PUP): {covered.length} / {pool.length} players · Missing evidence: {pool.length - covered.length} · Recent 2–3 games: {covered.filter(p => classic.players[String(p.id)].recent.length >= 2).length} · Role-qualified: {covered.filter(p => hasRole(classic.players[String(p.id)])).length} · Verified rushing QBs: {covered.filter(p => p.position.includes("QB") && rushingQualified(classic.players[String(p.id)])).length}</p>}
    {appData && <p className="rounded border border-amber-500/30 p-3 text-amber-200">App data is refreshed on each generation request. No separate Classic file is required. Missing review evidence is reported, not fabricated.</p>}
    <ClassicInputGuide />
    <details className="space-y-3"><summary className="cursor-pointer font-bold">Weekly anchors · {anchors.length} / 2–3 selected</summary>
      <p>{appData ? "Optional: select up to 3 manual anchors at 35–45%. These override position caps but do not certify recent workload or role." : "Select 2–3 role-verified anchors at 35–45%. Imported evidence is required; top-defense matchups trim exposure to 30%."} These are exposure targets, not lineup locks.</p>
      <fieldset disabled={!poolReady || !!evidenceError} className="max-h-56 overflow-auto space-y-2">{pool.map(p => {
        const id = String(p.id), selected = anchors.includes(id), evidence = classic.players[id];
        return <div key={id} className="flex flex-wrap items-center gap-2 border-b border-slate-800 py-1">
          <label className="flex flex-1 gap-2"><input type="checkbox" checked={selected} disabled={!selected && (anchors.length >= 3 || (!appData && !evidence))} onChange={e => { const next = { ...classic.anchors }; if (e.target.checked) next[id] = 40; else delete next[id]; update({ ...classic, anchors: next }); }} />{p.name} · {p.position} / {p.team} · #{id}{p.injuryStatus ? ` · ${p.injuryStatus}` : ""}</label>
          {selected && <input aria-label={`Anchor exposure ${p.name}`} className="w-20 rounded border border-slate-700 bg-slate-950 p-2" type="number" min={35} max={45} value={classic.anchors[id]} onChange={e => update({ ...classic, anchors: { ...classic.anchors, [id]: Number(e.target.value) } })} />}
          {selected && evidence?.topDefense && <span className="text-amber-300">Top-defense matchup · Effective max 30%</span>}
        </div>;
      })}</fieldset>
      {!appData && anchors.length !== 2 && anchors.length !== 3 && <p className="text-amber-200">Choose 2–3 weekly anchors to complete the portfolio setup.</p>}
    </details>
    <button type="button" className="rounded border border-slate-600 px-3 py-2" onClick={() => { onChange({ ...s, enabled: true, classic: undefined }); setImportError(""); }}>Clear Classic evidence and anchors</button>
    {!parsed.success && <p role="alert" className="text-red-300">{parsed.error.issues.map(i => i.message).join(" ")}</p>}
    <p className="font-bold text-amber-200">Final review required before DraftKings upload: confirm exact contest IDs, availability, evidence freshness, caps and every revised lineup.</p>
  </details>;
}

export function NflPortfolioReportView({ report, target }: { report?: NflPortfolioReport; target: string }) {
  if (!report) return null;
  const classic = (report as NflPortfolioReport & { classicLogic?: boolean }).classicLogic === true;
  const vegasSource = report.dataSources?.vegas === "odds_api" ? "primary odds source"
    : report.dataSources?.vegas === "espn" ? "ESPN"
    : "unavailable";
  const vegasTime = report.dataSources?.vegasFetchedAt
    ? `, fetched ${new Date(report.dataSources.vegasFetchedAt).toLocaleString()}`
    : "";
  const eventTimes = report.dataSources?.vegasEventTimes?.length
    ? ` · events ${report.dataSources.vegasEventTimes.map(time => new Date(time).toLocaleString()).join(", ")}`
    : "";
  return <section data-testid="nfl-portfolio-report" className="border border-amber-500/30 rounded-lg p-3 bg-slate-900 text-xs space-y-2">
    <h3 className="font-bold text-amber-300">{classic ? "NFL Classic Logic" : "NFL GPP target"} report · {target}</h3>
    <p>{report.partial || report.generatedCount < report.requestedCount ? "Partial portfolio" : "Portfolio generated"}: {report.generatedCount} / {report.requestedCount} lineups · {report.candidateCount} candidates · seed {report.seed}</p>
    {(report.fallbackCount ?? 0) > 0 && <p className="text-amber-200"><strong>Adjusted formula:</strong> {report.normalFormulaCount ?? report.generatedCount - report.fallbackCount!} standard target lineups + {report.fallbackCount} {report.fallbackMode === "projection_low_ownership" ? "high-projection, low-ownership" : "projection-ranked"} fallback lineups.</p>}
    {!!report.adjustedTargets?.length && <div><strong>Softened portfolio targets</strong><ul className="list-disc pl-5">{report.adjustedTargets.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {classic ? <p>Sources: {report.dataSources?.ownership === "estimated" ? "current app projections, estimated ownership and recorded injury statuses. Additional checks are unverified; see warnings below." : "DFS Army projections and imported evidence."} Final review before DraftKings upload is required.</p> : <p>Sources: ownership {report.dataSources?.ownership === "estimated" ? "model estimates" : report.dataSources?.ownership ?? "unavailable"} · Vegas {vegasSource}{report.dataSources?.vegasProvider ? ` (${report.dataSources.vegasProvider}${vegasTime})` : vegasTime}{eventTimes} · rushing role manual (not verified)</p>}
    <QualitySearchDiagnostics
      diagnostics={report.searchDiagnostics}
      partial={report.partial}
      mode={target.includes("Sim") ? "sim" : "projection"}
      testId="portfolio-quality-report"
    />
    {!!report.limitingCriteria?.length && <div><strong>Limiting criteria</strong><ul className="list-disc pl-5">{report.limitingCriteria.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {!!report.suggestions?.length && <div><strong>To generate more lineups</strong><ul className="list-disc pl-5">{report.suggestions.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    <div className="overflow-auto"><table className="w-full text-left [&_th]:pr-3 [&_td]:pr-3 [&_td]:py-1"><thead><tr><th>Metric</th><th>Target</th><th>Achieved</th><th>Status / detail</th></tr></thead><tbody>{(report.metrics || []).map(m => <tr key={m.key}><td>{m.label} ({m.unit})</td><td>{m.target ?? "Unavailable"}</td><td>{m.achieved ?? "Unavailable"}</td><td className={m.status === "shortfall" ? "text-amber-300" : ""}>{m.status} {m.detail}</td></tr>)}</tbody></table></div>
    {(report.warnings || []).map((w, i) => <p key={i} className="text-amber-300">{w}</p>)}
  </section>;
}