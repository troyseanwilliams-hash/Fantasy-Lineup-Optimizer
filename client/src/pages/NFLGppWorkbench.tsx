import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Download, FileSpreadsheet, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePageMeta } from "@/hooks/use-page-meta";
import { parseCheatSheet, parseOfficialTemplate, exportShowdownReport, exportShowdownUpload } from "@shared/nfl-gpp-csv";
import { defaultShowdownConfig, buildShowdownPortfolio } from "@shared/nfl-showdown-strategy";
import type { GppPlayer, OfficialPlayer, ShowdownStrategyConfig, StrategyResult } from "@shared/nfl-gpp-types";
import NFLClassicAudit from "./NFLClassicAudit";
import { applyStandingExclusions, useWorkbenchExclusions, type WorkbenchExclusionProps } from "./use-workbench-exclusions";
import "./nfl-gpp.css";

function download(text: string, filename: string, markdown = false) {
  const url = URL.createObjectURL(new Blob([text], { type: markdown ? "text/markdown;charset=utf-8" : "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const countValue = (value: string, max: number) => Math.max(0, Math.min(max, Math.trunc(Number(value) || 0)));

function ShowdownSheet({ standingNames, onStandingChange }: WorkbenchExclusionProps) {
  const [players, setPlayers] = useState<GppPlayer[]>([]);
  const [config, setConfig] = useState<ShowdownStrategyConfig | null>(null);
  const [count, setCount] = useState(20);
  const [official, setOfficial] = useState<OfficialPlayer[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [officialName, setOfficialName] = useState("");
  const [custom, setCustom] = useState(false);
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const buildVersion = useRef(0);
  useEffect(() => {
    buildVersion.current++;
    setResult(null);
  }, [config, standingNames]);
  useEffect(() => {
    setConfig(old => {
      if (!old) return old;
      const next = applyStandingExclusions(old, players, standingNames);
      if (old.excludedIds.length === next.excludedIds.length && old.excludedIds.every(id => next.excludedIds.includes(id))) return old;
      return next;
    });
    setResult(null);
  }, [standingNames, players]);
  const byId = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const exposures = useMemo(() => players.map(p => {
    const captain = result?.lineups.filter(l => l.captain === p.id).length || 0;
    const flex = result?.lineups.filter(l => l.flex.includes(p.id)).length || 0;
    return { ...p, captain, flex, total: captain + flex };
  }).sort((a, b) => b.total - a.total), [players, result]);
  function edit(patch: Partial<ShowdownStrategyConfig>) {
    setConfig(old => old ? { ...old, ...patch } : old);
    setCustom(true); setResult(null); setError("");
  }
  function defaults(nextCount: number) {
    try {
      const next = applyStandingExclusions(defaultShowdownConfig(players, nextCount), players, standingNames);
      setConfig(config ? { ...next, seed: config.seed } : next); setCount(nextCount); setCustom(false); setResult(null); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create defaults."); }
  }
  async function load(file: File, kind: "sheet" | "official") {
    setError(""); setBusy(true);
    if (kind === "sheet") { setResult(null); setConfig(null); setPlayers([]); setSheetName(""); setCustom(false); setOfficial([]); setOfficialName(""); }
    else { setOfficial([]); setOfficialName(""); }
    try {
      const text = await file.text();
      if (kind === "sheet") {
        const parsed = parseCheatSheet(text);
        if (!parsed.length) throw new Error("No players found. Upload a cheat sheet with player, team, position, salaries, projection and CPT/FLEX ownership.");
        const next = applyStandingExclusions(defaultShowdownConfig(parsed, count), parsed, standingNames);
        setPlayers(parsed); setConfig(next); setSheetName(file.name);
      } else {
        const parsed = parseOfficialTemplate(text);
        if (!parsed.length) throw new Error("No official draftable players found in this CSV.");
        setOfficial(parsed); setOfficialName(file.name);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read CSV. Please choose the file again."); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!config) return;
    const version = buildVersion.current;
    setBusy(true); setResult(null); setError("");
    try {
      await new Promise(resolve => setTimeout(resolve, 40));
      const next = await buildShowdownPortfolio(players, config);
      if (!next.lineups.length) throw new Error("No valid lineups found. Review your targets and exclusions, then retry.");
      if (buildVersion.current === version) setResult(next);
      else setError("Settings or shared exclusions changed during the build. Generate again with the current settings.");
    } catch (e) { setError(e instanceof Error ? e.message : "Build failed. Review the configuration and retry."); }
    finally { setBusy(false); }
  }
  function exportFile(kind: "csv" | "md" | "dk") {
    if (!result) return;
    setError("");
    try {
      if (kind === "csv") download(exportShowdownReport(result.lineups, players), "elitelineup-showdown-report.csv");
      else if (kind === "dk") download(exportShowdownUpload(result.lineups, players, official), "elitelineup-showdown-dk.csv");
      else {
        const safe = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
        const markdown = `# EliteLineup — offline Showdown portfolio\n\nNot a live simulation. Not automatically saved. No DraftKings submission.\n\nSeed: ${result.seed}\n\n${result.summary}\n\n## Configuration\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n\n## Lineups\n\n| # | CPT | FLEX | Salary | RAW projection | Ownership |\n|---|---|---|---|---|---|\n${result.lineups.map((l, i) => `| ${i + 1} | ${safe(byId.get(l.captain)?.name || l.captain)} | ${l.flex.map(id => safe(byId.get(id)?.name || id)).join(", ")} | ${l.salary} | ${l.projection.toFixed(2)} | ${l.ownership.toFixed(1)}% |`).join("\n")}\n\n## Exposures\n\n| Player | CPT count | FLEX count | Total count |\n|---|---|---|---|\n${exposures.map(p => `| ${safe(p.name)} | ${p.captain} | ${p.flex} | ${p.total} |`).join("\n")}\n`;
        download(markdown, "elitelineup-showdown-summary.md", true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Export failed. Verify the official template and try again."); }
  }
  const captainTotal = config ? Object.values(config.captainPlan).reduce((a, b) => a + b, 0) : 0;
  const splitTotal = config ? Object.values(config.splitTargets).reduce((a, b) => a + b, 0) : 0;
  return <div className="space-y-5">
    <div className="gpp-note"><strong>Sheet-based strategy, not a live simulation.</strong> One CPT + five FLEX, six unique players, both teams, $50,000 cap. RAW projections are reported; correlation boosts only affect selection. Files stay in this browser session; results are not saved automatically.</div>
    <fieldset disabled={busy} className="space-y-5">
      <section className="gpp-panel grid md:grid-cols-[1fr_1.2fr] gap-5 items-center">
        <div><p className="gpp-kicker">01 / Start with your sheet</p><h2 className="text-lg font-bold mt-2">Your slate. Your assumptions.</h2><p className="gpp-muted text-xs mt-2 leading-relaxed">CSV needs player, position, team, CPT/FLEX salary, raw projection and CPT/FLEX ownership. Separate CPT and FLEX sections are merged. A new sheet clears prior results and the official template.</p></div>
        <div className="space-y-3"><label className="gpp-field"><span>Showdown cheat sheet CSV</span><input type="file" accept=".csv,text/csv" aria-label="Showdown cheat sheet CSV" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f, "sheet"); }} /><span>{sheetName || "No sheet selected"} {players.length > 0 && `· ${players.length} players`}</span></label><button type="button" className="gpp-button" onClick={() => download("Player,Position,Team,CPT salary,FLEX salary,Projection,CPT ownership %,FLEX ownership %\n", "showdown-cheat-sheet-header.csv")}><Download size={14} />Sample cheat-sheet header</button><p className="gpp-muted text-xs">Header only — add your own rows. Position: QB, RB, WR, TE, K or DST; salaries and projection numeric; ownership in percentage points (e.g. 12.4).</p></div>
      </section>
      <section className="gpp-panel space-y-5">
        <div className="flex flex-wrap justify-between gap-3 items-start"><div><p className="gpp-kicker">02 / Portfolio blueprint</p><h2 className="text-lg font-bold mt-2">Set the shape of your build.</h2></div><span className="text-xs rounded-full bg-emerald-400/10 px-3 py-1 text-emerald-300">{custom ? "Custom configuration" : "Generated defaults"}</span></div>
        <div className="grid md:grid-cols-4 gap-4">
          <label className="gpp-field">Lineup count · 1–150<input type="number" min={1} max={150} value={count} onChange={e => { const n = Math.max(1, countValue(e.target.value, 150)); if (n === count) return; if (custom && !window.confirm("Changing the lineup count regenerates all default targets and replaces your custom configuration. Continue?")) return; if (players.length) defaults(n); else setCount(n); }} /></label>
          <label className="gpp-field">Reproducible seed<input value={config?.seed || ""} disabled={!config} onChange={e => edit({ seed: e.target.value })} placeholder="Available after CSV upload" /></label>
          <label className="gpp-field">Favorite team<select disabled={!config} value={config?.favoriteTeam || ""} onChange={e => edit({ favoriteTeam: e.target.value })}><option value="" disabled>Select team</option>{Array.from(new Set(players.map(p => p.team))).map(team => <option key={team} value={team}>{team}</option>)}</select></label>
          <div className="gpp-field"><span>Restore sheet-driven targets</span><button className="gpp-button" disabled={!config} onClick={() => { if (!custom || window.confirm("Replace custom captain, flex, exclusion and split settings with defaults? Your seed will be preserved.")) defaults(count); }}><RotateCcw size={14} />Reset defaults</button></div>
        </div>
        <div className="gpp-note">Defaults scale with lineup count: captain shares favor projection and leverage without excluding starting QBs by narrative; core FLEX minimums, cheap skill darts and kicker / DST coverage are prefilled. Shared workbench exclusions persist by normalized player name for your signed-in account in this browser, across both modes, new sheets and default resets. Excluded players have zero captain / minimum / target counts. Shares are never silently redistributed — fix captain totals before building. The existing Classic generator is unchanged.</div>
        {config && <><div className="grid md:grid-cols-5 gap-3">{([
          ["favorite42", "Favorite 4–2"], ["underdog42", "Underdog 4–2"], ["balanced33", "Balanced 3–3"], ["fiveOne", "5–1 · either side"],
        ] as const).map(([key, label]) => <label key={key} className="gpp-field">{label}<input type="number" min={0} max={count} value={config.splitTargets[key]} onChange={e => edit({ splitTargets: { ...config.splitTargets, [key]: countValue(e.target.value, count) } })} /></label>)}<label className="gpp-field">Lineups with a kicker<input type="number" min={0} max={count} value={config.kickerTarget} onChange={e => edit({ kickerTarget: countValue(e.target.value, count) })} /></label></div><p className={`text-xs ${splitTotal !== count || captainTotal !== count ? "text-amber-300" : "text-emerald-300"}`}>Captain plan: {captainTotal}/{count} · Exact team splits: {splitTotal}/{count}. Both totals must equal the lineup count.</p></>}
      </section>
      <section className="gpp-panel space-y-4">
        <div className="flex flex-wrap justify-between gap-3"><div><p className="gpp-kicker">03 / Player-level counts</p><h2 className="text-lg font-bold mt-2">Captain shares & FLEX leverage</h2></div><label className="gpp-field"><span className="sr-only">Search sheet players</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find player or team…" /></label></div>
        {!config ? <div className="gpp-empty"><FileSpreadsheet size={28} className="mx-auto mb-3 text-emerald-400" /><p>Upload a cheat sheet to see the generated captain plan, minimums and leverage targets.</p></div> : <div className="gpp-table-wrap"><table><thead><tr><th>Shared workbench exclude</th><th>Player</th><th>Pos / team</th><th>FLEX $</th><th>CPT $</th><th>RAW proj</th><th>CPT own</th><th>FLEX own</th><th>CPT count</th><th>FLEX min</th><th>Leverage FLEX target</th></tr></thead><tbody>{players.filter(p => `${p.name} ${p.team}`.toLowerCase().includes(search.toLowerCase())).map(p => <tr key={p.id} className={config.excludedIds.includes(p.id) ? "opacity-50" : ""}><td><input type="checkbox" aria-label={`Shared workbench exclusion: ${p.name}`} checked={config.excludedIds.includes(p.id)} onChange={e => { onStandingChange(p.name, e.target.checked); setCustom(true); }} /></td><td className="font-semibold">{p.name}</td><td className="gpp-muted">{p.pos} / {p.team}</td><td className="gpp-number">{p.flexSalary.toLocaleString()}</td><td className="gpp-number">{p.cptSalary.toLocaleString()}</td><td className="gpp-number">{p.projection.toFixed(2)}</td><td>{p.cptOwn.toFixed(1)}%</td><td>{p.flexOwn.toFixed(1)}%</td>{(["captainPlan", "flexMinimums", "flexTargets"] as const).map(key => <td key={key}><input type="number" aria-label={`${p.name} ${key}`} disabled={config.excludedIds.includes(p.id)} min={0} max={count} value={config[key][p.id] || 0} onChange={e => edit({ [key]: { ...config[key], [p.id]: countValue(e.target.value, count) } })} /></td>)}</tr>)}</tbody></table>{!players.some(p => `${p.name} ${p.team}`.toLowerCase().includes(search.toLowerCase())) && <p className="p-4 text-sm gpp-muted">No players match this search.</p>}</div>}
        <details className="gpp-note"><summary className="cursor-pointer font-bold">Build laws & hard constraints</summary><ul className="list-disc pl-5 mt-2 space-y-1"><li>QB captain → at least one same-team WR / TE in FLEX.</li><li>WR / TE captain → same-team QB in FLEX.</li><li>RB captain → same-team DST + an opposing QB / RB / WR / TE.</li><li>Ownership ≤ 190%: captain CPT ownership + five FLEX ownership values.</li><li>At most one kicker and one DST; both teams in every lineup.</li><li>No duplicate lineups; any two six-player roster sets must differ by at least two roster spots. A different captain alone is not diversity.</li><li>All counts and exact team splits are audited. Infeasible plans produce a readable error rather than silently relaxing your rules.</li></ul></details>
        <button className="gpp-button gpp-primary" disabled={!config || captainTotal !== count || splitTotal !== count} onClick={() => void generate()}><SlidersHorizontal size={16} />Build {count} offline lineups<ArrowRight size={15} /></button>
      </section>
    </fieldset>
    {busy && <div role="status" aria-live="polite" className="gpp-panel space-y-3"><p className="text-sm text-emerald-300">Working locally — reading sheet or constructing and auditing your portfolio…</p><div className="h-3 bg-emerald-200/10 rounded animate-pulse" /><div className="h-3 w-2/3 bg-emerald-200/10 rounded animate-pulse" /></div>}
    {error && <div role="alert" className="gpp-error"><strong>Action could not be completed.</strong><p className="mt-1">{error}</p><p className="mt-2 text-xs">Review your inputs and retry the build or export. No file has been saved automatically.</p></div>}
    {result && <section className="gpp-panel space-y-5">
      <div className="flex flex-wrap justify-between gap-4"><div><p className="gpp-kicker">04 / Audited output</p><h2 className="text-2xl font-bold mt-2">{result.lineups.length} lineups. Ready for review.</h2><p className="gpp-muted text-xs mt-2">Offline sheet-based build · Seed <span className="gpp-number">{result.seed}</span></p></div><div className="flex flex-wrap gap-2 items-start"><button className="gpp-button" onClick={() => exportFile("csv")}><Download size={14} />Report CSV</button><button className="gpp-button" onClick={() => exportFile("md")}><Download size={14} />Markdown summary</button></div></div>
      <p className="gpp-note whitespace-pre-wrap">{result.summary}</p>
      <div className="gpp-table-wrap"><table><thead><tr><th>#</th><th>Captain · 1.5×</th><th>FLEX × 5</th><th>Salary</th><th>RAW proj</th><th>Ownership</th></tr></thead><tbody>{result.lineups.map((l, i) => <tr key={i}><td className="gpp-number">{i + 1}</td><td className="font-semibold text-emerald-300">{byId.get(l.captain)?.name || l.captain}</td><td className="!whitespace-normal min-w-64 leading-relaxed">{l.flex.map(id => byId.get(id)?.name || id).join(" · ")}</td><td className="gpp-number">${l.salary.toLocaleString()}</td><td className="gpp-number">{l.projection.toFixed(2)}</td><td className="gpp-number">{l.ownership.toFixed(1)}%</td></tr>)}</tbody></table></div>
      <h3 className="font-bold">Portfolio exposures</h3>
      <div className="gpp-table-wrap"><table><thead><tr><th>Player</th><th>CPT count / plan</th><th>FLEX count / min / target</th><th>Total count</th><th>Roster exposure</th></tr></thead><tbody>{exposures.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.captain} / {config?.captainPlan[p.id] || 0}</td><td>{p.flex} / {config?.flexMinimums[p.id] || 0} / {config?.flexTargets[p.id] || 0}</td><td>{p.total}</td><td>{(100 * p.total / result.lineups.length).toFixed(1)}%</td></tr>)}</tbody></table></div>
    </section>}
    <fieldset disabled={busy} className="gpp-panel space-y-4">
      <div><p className="gpp-kicker">Optional / DraftKings upload extract</p><h2 className="text-lg font-bold mt-2">Official IDs only. Never guessed.</h2><p className="gpp-muted text-xs mt-2">Upload the official Showdown draftable CSV for this draft group. CPT and FLEX IDs differ. Changing this template preserves your generated portfolio and only changes export validation. Official salaries and name matches are revalidated at export; mismatches block the download.</p></div>
      <label className="gpp-field"><span>Official DraftKings Showdown template CSV</span><input type="file" accept=".csv,text/csv" aria-label="Showdown official DraftKings template CSV" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f, "official"); }} /><span>{officialName || "No official template selected"} {official.length > 0 && `· ${official.length} players`}</span></label>
      <button className="gpp-button" disabled={!result || !official.length} onClick={() => exportFile("dk")}><Download size={15} />Download DK upload CSV</button>
      <p className="gpp-muted text-xs">Local extract only. Complete entry IDs where required and review in DraftKings yourself. This workbench never submits entries.</p>
    </fieldset>
  </div>;
}

export default function NFLGppWorkbench() {
  const { user, isLoading } = useAuth();
  const standing = useWorkbenchExclusions(user?.id);
  const [tab, setTab] = useState<"showdown" | "classic">(() => new URLSearchParams(window.location.search).get("tab") === "classic" ? "classic" : "showdown");
  usePageMeta({ title: "NFL GPP Workbench | EliteLineup", description: "Offline sheet-based Showdown portfolios and a separate Classic entry exposure audit.", path: "/nfl-gpp" });
  return <div className="gpp-workbench"><div className="max-w-7xl mx-auto px-4 sm:px-6 py-7 sm:py-10 space-y-7">
    <Link href="/showdown" className="inline-flex items-center gap-2 text-xs text-emerald-300"><ArrowLeft size={14} />Back to live Showdown builder</Link>
    <header className="flex flex-col md:flex-row gap-5 md:items-end justify-between"><div><p className="gpp-kicker">EliteLineup / NFL · DraftKings</p><h1 className="text-3xl sm:text-4xl font-black tracking-tight mt-3">GPP workbench<span className="text-emerald-400">.</span></h1><p className="gpp-muted text-sm mt-3 max-w-xl">Turn your sheet into a deliberate portfolio. Give final Classic entries a separate exposure check.</p></div><span className="inline-flex items-center gap-2 text-xs text-emerald-300"><ShieldCheck size={16} />Offline tools · no automatic saves</span></header>
    {isLoading ? <div role="status" className="gpp-panel animate-pulse h-36">Checking your session…</div> : !user ? <section className="gpp-panel max-w-xl mx-auto !py-10 text-center space-y-4"><ShieldCheck size={34} className="mx-auto text-emerald-400" /><h2 className="text-xl font-bold">Your workbench starts with sign-in.</h2><p className="gpp-muted text-sm">Sign in to use the sheet-based Showdown builder and Classic upload audit. Existing optimizer controls remain in their original tools.</p><Link href="/login" className="gpp-button gpp-primary">Sign in to continue<ArrowRight size={14} /></Link></section> : <>
      <div role="tablist" aria-label="NFL workbench mode" className="flex gap-2 border-b border-slate-700 pb-4">{(["showdown", "classic"] as const).map(t => <button key={t} id={`gpp-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls={`gpp-panel-${t}`} tabIndex={tab === t ? 0 : -1} onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const next = t === "classic" ? "showdown" : "classic"; setTab(next); document.getElementById(`gpp-tab-${next}`)?.focus(); } }} onClick={() => setTab(t)} className={`gpp-button flex-1 md:flex-none ${tab === t ? "gpp-primary" : ""}`}>{t === "showdown" ? "Showdown / sheet build" : "Classic / upload audit"}</button>)}</div>
      {standing.storageError && <div role="alert" className="gpp-error">{standing.storageError}</div>}
      <div role="tabpanel" id="gpp-panel-showdown" aria-labelledby="gpp-tab-showdown" hidden={tab !== "showdown"}><ShowdownSheet key={`showdown-${user.id}`} standingNames={standing.names} onStandingChange={standing.setName} /></div>
      <div role="tabpanel" id="gpp-panel-classic" aria-labelledby="gpp-tab-classic" hidden={tab !== "classic"}><NFLClassicAudit key={`classic-${user.id}`} standingNames={standing.names} onStandingChange={standing.setName} /></div>
    </>}
    <footer className="gpp-muted text-xs border-t border-slate-700 pt-5 leading-relaxed">No live player feed, simulation, automatic save, or DraftKings submission. Recheck injuries, salaries and contest rules before entering.</footer>
  </div></div>;
}
