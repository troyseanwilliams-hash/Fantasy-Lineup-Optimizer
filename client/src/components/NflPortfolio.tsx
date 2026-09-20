import { useState } from "react";
import { DEFAULT_NFL_PORTFOLIO, nflPortfolioSettingsSchema, type NflPortfolioSettings, type NflPortfolioReport } from "@shared/nfl-portfolio";

export function useNflPortfolio() {
  const [settings, setSettings] = useState<NflPortfolioSettings>(() => structuredClone(DEFAULT_NFL_PORTFOLIO));
  const [report, setReport] = useState<NflPortfolioReport | undefined>();
  const error = settings.enabled ? nflPortfolioSettingsSchema.safeParse(settings) : null;
  return { settings, setSettings, report, setReport, error: error && !error.success ? error.error.issues.map(i => i.message).join(" ") : "", reset: () => { setSettings(structuredClone(DEFAULT_NFL_PORTFOLIO)); setReport(undefined); } };
}

export function NflPortfolioControls({ settings: s, onChange, supported, players, single = false }: {
  settings: NflPortfolioSettings; onChange: (s: NflPortfolioSettings) => void; supported: boolean;
  players: Array<{ id: number; name: string; position: string }>; single?: boolean;
}) {
  const set = <K extends keyof NflPortfolioSettings>(key: K, value: NflPortfolioSettings[K]) => onChange({ ...s, [key]: value });
  const numeric = (key: keyof NflPortfolioSettings, label: string, min: number, max: number, step = 1) => (
    <label className="flex items-center justify-between gap-2">{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={s[key] as number} onChange={e => set(key, e.target.value === "" ? NaN : Number(e.target.value))} className="w-24 rounded bg-slate-950 border border-slate-700 p-1" /></label>
  );
  const toggle = (key: keyof NflPortfolioSettings, label: string) => <label className="flex gap-2 items-center"><input type="checkbox" checked={s[key] as boolean} onChange={e => set(key, e.target.checked)} />{label}</label>;
  const mix = (key: "stackMix" | "flexMix" | "qbSalaryMix", title: string) => <fieldset className="space-y-2"><legend className="font-bold">{title} (total 100%)</legend><div className="flex flex-wrap gap-3">{Object.entries(s[key]).map(([k, v]) => <label key={k}>{k} % <input type="number" aria-label={`${title} ${k}`} min={0} max={100} step={0.1} value={v} onChange={e => set(key, { ...s[key], [k]: e.target.value === "" ? NaN : Number(e.target.value) })} className="w-16 bg-slate-950 border border-slate-700 rounded p-1" /></label>)}</div></fieldset>;
  const parsed = nflPortfolioSettingsSchema.safeParse(s);
  return <details className="rounded-lg border border-amber-500/30 bg-slate-900 p-3 text-xs space-y-3" data-testid="nfl-portfolio-controls">
    <summary className="cursor-pointer font-bold text-amber-300">NFL GPP Strategy · {supported && s.enabled ? "On" : "Off"}</summary>
    <label className="flex gap-2 items-center"><input data-testid="nfl-portfolio-enabled" type="checkbox" disabled={!supported} checked={supported && s.enabled} onChange={e => set("enabled", e.target.checked)} />Enable NFL GPP Strategy</label>
    {!supported && <p>Available only for NFL DraftKings Classic GPP. Select a supported slate and GPP contest.</p>}
    {supported && s.enabled && <div className="space-y-4">
      <p>Portfolio targets, not guarantees. {single ? "Normal Optimizer still builds one lineup. " : ""}Percentages use per-batch rounding. Existing locks, exclusions and allowed FLEX positions take priority; compatible FLEX targets are normalized.</p>
      {mix("stackMix", "QB stack")}
      <div className="grid sm:grid-cols-2 gap-3">{numeric("bringBackPct", "Bring-back %", 0, 100, 0.1)}{numeric("secondaryStackPct", "Secondary stack %", 0, 100, 0.1)}</div>
      {mix("flexMix", "FLEX mix")}
      {numeric("rbMinSalary", "RB minimum salary", 0, 50000)}
      {toggle("allowLockedCheapRb", "Explicitly exempt locked RBs below minimum salary")}
      <details className="space-y-3"><summary className="cursor-pointer font-bold">Advanced strategy settings</summary>
        <label>Ownership mode <select aria-label="Ownership mode" className="bg-slate-950 p-1" value={s.ownershipMode} onChange={e => set("ownershipMode", e.target.value as NflPortfolioSettings["ownershipMode"])}><option value="off">Off</option><option value="estimated">Estimated (model estimates)</option><option value="provided">Provided individually</option></select></label>
        <p>Estimated ownership is a model estimate, not verified contest ownership. Missing provided values are unavailable, not zero.</p>
        {s.ownershipMode !== "off" && <>
          <label>Field size <select aria-label="Field size" className="bg-slate-950 p-1" value={s.fieldSize} onChange={e => set("fieldSize", e.target.value as NflPortfolioSettings["fieldSize"])}>{["100000+", "10000-99999", "1000-9999", "under1000"].map(v => <option key={v}>{v}</option>)}</select></label>
          {numeric("ownershipTolerance", "Ownership tolerance", 0, 100, 0.1)}
          {numeric("minLowOwnedPlayers", "Minimum low-owned players", 0, 8)}
          {numeric("lowOwnershipThreshold", "Low ownership threshold %", 0.1, 100, 0.1)}
          {toggle("preferLowOwnedWr", "Prefer low-owned WR")}
        </>}
        {s.ownershipMode === "provided" && <details><summary>Individual ownership inputs ({players.length} pool players)</summary><div className="max-h-64 overflow-auto space-y-2">{players.map(p => <label key={p.id} className="flex justify-between gap-2">{p.name} · #{p.id}<input aria-label={`Ownership ${p.name} ${p.id}`} className="w-20 bg-slate-950 p-1" type="number" min={0} max={100} step={0.1} value={s.ownershipOverrides[String(p.id)] ?? ""} onChange={e => { const next = { ...s.ownershipOverrides }; if (!e.target.value) delete next[String(p.id)]; else next[String(p.id)] = Number(e.target.value); set("ownershipOverrides", next); }} /></label>)}</div></details>}
        {numeric("minGames", "Minimum games (soft)", 2, 9)}{numeric("maxGames", "Maximum games (soft)", 2, 9)}
        <details><summary>Eligible naked QBs (manual)</summary><p>Choose rushing-role QBs yourself. Rushing role is not automatically verified.</p>{players.filter(p => p.position.split("/").includes("QB")).map(p => <label key={p.id} className="block"><input type="checkbox" checked={s.nakedQbIds.includes(p.id)} onChange={e => set("nakedQbIds", e.target.checked ? [...s.nakedQbIds, p.id] : s.nakedQbIds.filter(id => id !== p.id))} /> {p.name} · #{p.id}</label>)}</details>
        {toggle("preferHomeTe", "Prefer home TE")}{toggle("preferHomeFavoriteDst", "Prefer home-favorite DST")}{toggle("preferLowTotalGames", "Prefer low-total games")}
        {numeric("gameTotalThreshold", "Low game total threshold", 20, 90, 0.1)}
        {toggle("preferValueWr", "Prefer value WR")}{toggle("preferFourXUpside", "Prefer 4x upside")}
        <p>QB salary tiers: punt &lt; $5,000; value $5,000–5,999; mid $6,000–6,999; premium ≥ $7,000.</p>
        {mix("qbSalaryMix", "QB salary mix")}
        {numeric("seed", "Reproducible seed (optional override)", 1, 2147483647)}
      </details>
      {!parsed.success && <p role="alert" className="text-red-400">{parsed.error.issues.map(i => i.message).join(" ")}</p>}
    </div>}
  </details>;
}

export function NflPortfolioReportView({ report, target }: { report?: NflPortfolioReport; target: string }) {
  if (!report) return null;
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
    <h3 className="font-bold text-amber-300">NFL GPP target report · {target}</h3>
    <p>{report.partial || report.generatedCount < report.requestedCount ? "Partial portfolio" : "Portfolio generated"}: {report.generatedCount} / {report.requestedCount} lineups · {report.candidateCount} candidates · seed {report.seed}</p>
    {(report.fallbackCount ?? 0) > 0 && <p className="text-amber-200"><strong>Adjusted formula:</strong> {report.normalFormulaCount ?? report.generatedCount - report.fallbackCount!} standard target lineups + {report.fallbackCount} {report.fallbackMode === "projection_low_ownership" ? "high-projection, low-ownership" : "projection-ranked"} fallback lineups.</p>}
    {!!report.adjustedTargets?.length && <div><strong>Softened portfolio targets</strong><ul className="list-disc pl-5">{report.adjustedTargets.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    <p>Sources: ownership {report.dataSources?.ownership === "estimated" ? "model estimates" : report.dataSources?.ownership ?? "unavailable"} · Vegas {vegasSource}{report.dataSources?.vegasProvider ? ` (${report.dataSources.vegasProvider}${vegasTime})` : vegasTime}{eventTimes} · rushing role manual (not verified)</p>
    {!!report.limitingCriteria?.length && <div><strong>Limiting criteria</strong><ul className="list-disc pl-5">{report.limitingCriteria.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {!!report.suggestions?.length && <div><strong>To generate more lineups</strong><ul className="list-disc pl-5">{report.suggestions.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    <div className="overflow-auto"><table className="w-full text-left [&_th]:pr-3 [&_td]:pr-3 [&_td]:py-1"><thead><tr><th>Metric</th><th>Target</th><th>Achieved</th><th>Status / detail</th></tr></thead><tbody>{(report.metrics || []).map(m => <tr key={m.key}><td>{m.label} ({m.unit})</td><td>{m.target ?? "Unavailable"}</td><td>{m.achieved ?? "Unavailable"}</td><td className={m.status === "shortfall" ? "text-amber-300" : ""}>{m.status} {m.detail}</td></tr>)}</tbody></table></div>
    {(report.warnings || []).map((w, i) => <p key={i} className="text-amber-300">{w}</p>)}
  </section>;
}