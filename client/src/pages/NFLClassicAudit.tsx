import { useEffect, useMemo, useRef, useState } from "react";
import { parseClassicInputs } from "@shared/nfl-classic-inputs";
import type { ClassicLogic } from "@shared/nfl-classic-logic";
import { ClassicInputGuide } from "@/components/NflPortfolio";
import { ShieldCheck, Download, ArrowRight } from "lucide-react";
import { parseOfficialTemplate, parseClassicUpload, exportClassicUpload } from "@shared/nfl-gpp-csv";
import { auditClassicUpload } from "@shared/nfl-classic-audit";
import type { OfficialPlayer, ClassicUpload, ClassicAudit } from "@shared/nfl-gpp-types";
import { normalizeWorkbenchName, type WorkbenchExclusionProps } from "./use-workbench-exclusions";

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function NFLClassicAudit({ standingNames, onStandingChange }: WorkbenchExclusionProps) {
  const [official, setOfficial] = useState<OfficialPlayer[]>([]);
  const [upload, setUpload] = useState<ClassicUpload | null>(null);
  const excluded = useMemo(() => official.filter(p => standingNames.includes(normalizeWorkbenchName(p.name))).map(p => p.flexId), [official, standingNames]);
  const [audit, setAudit] = useState<ClassicAudit | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [entryName, setEntryName] = useState("");
  const [classic, setClassic] = useState<ClassicLogic | undefined>();
  const [evidenceName, setEvidenceName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const templateVersion = useRef(0);
  useEffect(() => { setAudit(null); setApproved(false); setReviewed(false); setError(""); }, [excluded]);
  function invalidate() { setAudit(null); setApproved(false); setReviewed(false); setError(""); }
  async function load(file: File, kind: "official" | "entries") {
    invalidate(); setBusy(true); setUpload(null); setEntryName("");
    if (kind === "official") { templateVersion.current++; setOfficial([]); setTemplateName(""); setClassic(undefined); setEvidenceName(""); }
    try {
      const text = await file.text();
      if (kind === "official") {
        const parsed = parseOfficialTemplate(text);
        if (!parsed.length) throw new Error("No official draftable players found. Choose a DraftKings Classic salary CSV.");
        setOfficial(parsed); setTemplateName(file.name);
      } else {
        const parsed = parseClassicUpload(text, official);
        if (!parsed.entries.length) throw new Error("No entries found in this CSV.");
        setUpload(parsed); setEntryName(file.name);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read this CSV. Please choose it again."); }
    finally { setBusy(false); }
  }
  async function loadEvidence(file: File) {
    invalidate(); setBusy(true); setClassic(undefined); setEvidenceName("");
    const version = templateVersion.current;
    try {
      const pool = official.map(p => ({ id: Number(p.flexId), name: p.name, team: p.team }));
      if (pool.some(p => !Number.isSafeInteger(p.id) || p.id <= 0) || new Set(pool.map(p => p.id)).size !== pool.length) throw new Error("Official flex IDs must be unique positive numeric DraftKings IDs.");
      // Offline audit has no server slate: 1 is its explicit local scope.
      const parsed = parseClassicInputs(await file.text(), pool, 1);
      if (version !== templateVersion.current) return;
      setClassic(parsed); setEvidenceName(file.name);
    } catch (e) { setError(e instanceof Error ? e.message : "Evidence import failed. Choose corrected inputs and retry."); }
    finally { setBusy(false); }
  }
  function runAudit() {
    if (!upload) return;
    invalidate();
    try {
      if (!classic) throw new Error("Import Classic formula evidence for this exact official template before auditing.");
      const originalCopy = { ...upload, header: [...upload.header], slotIndices: [...upload.slotIndices], entries: upload.entries.map(entry => ({ ...entry, cells: [...entry.cells], playerIds: [...entry.playerIds] })) };
      setAudit(auditClassicUpload(originalCopy, official, excluded, classic));
    }
    catch (e) { setError(e instanceof Error ? e.message : "Audit failed. Review the inputs and retry."); }
  }
  return <div className="space-y-5">
    <div className="gpp-note"><strong>Review your final Classic entries — not a new generator.</strong> Position caps: QB 27% / RB 35% / WR 30% / TE 25% / DST 27%. Integer caps round down; at least 4 entries are required for cap feasibility. Classic Logic checks 115% total ownership, a 4-point skill projection floor, 3 uniques and the latest double-stack architecture. Exclusions are hard constraints. Formula evidence for this exact official pool is required; missing data is never guessed. Your original files remain untouched.</div>
    <details className="gpp-note"><summary className="cursor-pointer font-bold">Accepted CSV formats / download sample headers</summary><div className="space-y-3 mt-3"><p>The official salary CSV needs Name, ID, Position, TeamAbbrev, Roster Position and Salary. Use DraftKings-issued IDs and salaries for the exact contest; sample headers contain no players or IDs.</p><p>The entry CSV needs the nine roster columns in this exact order: QB, RB, RB, WR, WR, WR, TE, FLEX, DST. Optional Entry ID and contest metadata are preserved. Player cells must resolve to official draftable IDs. Keep duplicate RB / WR column names.</p><div className="flex flex-wrap gap-2"><button className="gpp-button" onClick={() => download("Name,ID,Position,TeamAbbrev,Roster Position,Salary\n", "dk-official-salary-header.csv")}><Download size={14} />Official salary header</button><button className="gpp-button" onClick={() => download("Entry ID,Contest Name,Contest ID,Entry Fee,QB,RB,RB,WR,WR,WR,TE,FLEX,DST\n", "classic-entry-header.csv")}><Download size={14} />Classic entry header</button></div></div></details>
    <fieldset disabled={busy} className="grid md:grid-cols-2 gap-5">
      <label className="gpp-panel gpp-field"><span className="gpp-kicker">01 / Official player IDs</span><strong className="text-base text-emerald-50">DraftKings Classic salary template</strong><span>Use the exact contest / draft-group salary CSV.</span><input aria-label="Classic official salary CSV" type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f, "official"); }} /><span>{templateName || "No template selected"} {official.length > 0 && `· ${official.length} players`}</span></label>
      <label className="gpp-panel gpp-field"><span className="gpp-kicker">02 / Your final portfolio</span><strong className="text-base text-emerald-50">Final entry CSV</strong><span>Load the official template first. Entry metadata is preserved.</span><input aria-label="Classic final entry CSV" type="file" disabled={!official.length} accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f, "entries"); }} /><span>{entryName || "No entry file selected"} {upload && `· ${upload.entries.length} entries`}</span></label>
    </fieldset>
    <section className="gpp-panel space-y-3">
      <label className="gpp-field"><span className="gpp-kicker">03 / Classic formula evidence</span><strong>DFS Army projections + per-player evidence</strong><span>Load the exact official template first. CSV matches name/team; JSON players must use official numeric flex IDs, not app IDs. Offline JSON uses slateId: 1 and projectionSource: "DFS Army". Replacing the template clears this import.</span><input aria-label="Classic formula evidence CSV or JSON" type="file" disabled={busy || !official.length} accept=".csv,.json,text/csv,application/json" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void loadEvidence(f); }} /><span>{evidenceName || "No evidence selected"} · Imported {official.filter(p => classic?.players[String(Number(p.flexId))]).length} / {official.length} · Missing {official.filter(p => !classic?.players[String(Number(p.flexId))]).length}</span></label>
      <p className="gpp-muted text-xs">JSON may include anchors (2–3 official IDs at 35–45%, default 40%) and architecture targets: fullArchitecturePct 34, doubleStackPct 65, bringBackPct 45, nakedPct 3. Anchors explicitly override positional caps except any anchor facing a top defense (TopDefense), at any position, is trimmed to 30%. Naked pocket QBs are not allowed; rushing eligibility requires recent-game evidence.</p>
      {classic && <div className="space-y-2"><strong>Weekly anchors — select 2–3</strong>{official.map(p => <label key={p.flexId} className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={classic.anchors[p.flexId] !== undefined} disabled={classic.anchors[p.flexId] === undefined && Object.keys(classic.anchors).length >= 3} onChange={e => {
          invalidate(); const anchors = { ...classic.anchors }; if(e.target.checked) anchors[p.flexId]=40; else delete anchors[p.flexId]; setClassic({...classic,anchors});
        }} />{p.name}
        {classic.anchors[p.flexId] !== undefined && <input aria-label={`Anchor target ${p.name}`} type="number" min={35} max={45} className="w-20 bg-slate-900 p-1" value={classic.anchors[p.flexId]} onChange={e=>{invalidate();setClassic({...classic,anchors:{...classic.anchors,[p.flexId]:Number(e.target.value)}});}} />}
      </label>)}</div>}
      <ClassicInputGuide />
    </section>
    {busy && <div role="status" className="gpp-panel animate-pulse">Reading and validating CSV…</div>}
    {error && <div role="alert" className="gpp-error">{error} Choose corrected inputs or retry the audit.</div>}
    {official.length > 0 && <section className="gpp-panel space-y-4">
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-bold">Shared workbench exclusions <span className="text-emerald-300">/ {excluded.length}</span></h2><p className="gpp-muted text-xs mt-1">Saved by normalized player name for your account in this browser, shared with Showdown. Matched to this template's official IDs. This audit does not change your saved lineups.</p></div><label className="gpp-field"><span className="sr-only">Find official players</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find player, team or ID…" /></label></div>
      <div className="grid md:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
        {official.filter(p => `${p.name} ${p.team} ${p.flexId}`.toLowerCase().includes(search.toLowerCase())).map(p => <label key={p.flexId} className="flex items-center gap-3 text-xs p-2 rounded bg-slate-900/40"><input type="checkbox" checked={excluded.includes(p.flexId)} disabled={busy} onChange={e => { invalidate(); onStandingChange(p.name, e.target.checked); }} /><span className="flex-1">{p.name} <span className="gpp-muted">· {p.pos} / {p.team}</span></span><span className="gpp-number gpp-muted">{p.flexId}</span></label>)}
        {!official.some(p => `${p.name} ${p.team} ${p.flexId}`.toLowerCase().includes(search.toLowerCase())) && <p className="gpp-muted text-sm">No players match this search.</p>}
      </div>
      <button className="gpp-button gpp-primary" disabled={!upload || !classic || busy} onClick={runAudit}><ShieldCheck size={16} />Audit final entries</button>
    </section>}
    {!audit && !busy && <div className="gpp-empty"><ShieldCheck className="mx-auto mb-3 text-emerald-400" size={28} /><h2 className="font-bold text-emerald-50 mb-2">A second look before lock.</h2><p className="text-sm">Load the official template, final entries and formula evidence, set exclusions, then audit. Review is required before download. Proposed swaps are never applied without your approval.</p></div>}
    {audit && <section className="gpp-panel space-y-5">
      <div className="flex flex-wrap gap-6"><div><span className="gpp-kicker">Entries reviewed</span><p className="text-3xl font-bold gpp-number">{upload?.entries.length}</p></div><div><span className="gpp-kicker">Violations</span><p className="text-3xl font-bold gpp-number">{audit.violations.length}</p></div><div><span className="gpp-kicker">Proposed swaps</span><p className="text-3xl font-bold gpp-number">{audit.proposals.length}</p></div><div><span className="gpp-kicker">Unresolved</span><p className="text-3xl font-bold gpp-number">{audit.unresolved.length}</p></div></div>
      {audit.warnings.map((w, i) => <p key={i} className="gpp-note">{w}</p>)}
      <h3 className="font-bold">Original exposure violations</h3>
      {audit.violations.length ? <div className="gpp-table-wrap"><table><thead><tr><th>Player</th><th>ID</th><th>Appearances</th><th>Exposure</th><th>Count cap</th><th>Reason</th></tr></thead><tbody>{audit.violations.map(v => <tr key={v.id}><td>{v.name}</td><td>{v.id}</td><td>{v.count}</td><td>{v.percent.toFixed(1)}%</td><td>{v.cap}</td><td>{v.excluded ? "Hard excluded" : "Over exposure cap"}</td></tr>)}</tbody></table></div> : <p className="text-sm text-emerald-300">No exposure or exclusion violations found.</p>}
      <h3 className="font-bold">Proposed changes — review before approval</h3>
      {audit.proposals.length ? <div className="gpp-table-wrap"><table><thead><tr><th>Entry / lineup</th><th>Slot</th><th>Remove</th><th></th><th>Replace with</th></tr></thead><tbody>{audit.proposals.map((p, i) => <tr key={i}><td>{upload?.entries[p.entry - 1]?.entryId || `Lineup ${p.entry}`}</td><td>{upload ? upload.header[upload.slotIndices[p.slot]] : `Roster slot ${p.slot + 1}`}</td><td>{p.fromName} <span className="gpp-muted">({p.fromId})</span></td><td><ArrowRight size={14} /></td><td>{p.toName} <span className="gpp-muted">({p.toId})</span></td></tr>)}</tbody></table></div> : <p className="gpp-muted text-sm">No swaps proposed.</p>}
      {audit.unresolved.length > 0 && <div className="gpp-error"><strong>Unresolved violations: approval and revised download are blocked. Adjust your entries or exclusions, then audit again.</strong><ul className="mt-2 space-y-1">{audit.unresolved.map(v => <li key={v.id}>{v.name} ({v.id}): {v.count} appearances / cap {v.cap}{v.excluded ? " · excluded" : ""}</li>)}</ul></div>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={audit.unresolved.length > 0} onChange={e => { setReviewed(e.target.checked); setApproved(false); }} />I reviewed every final lineup, official contest ID, evidence timestamp and audit finding before DraftKings upload.</label>
      <div className="flex flex-wrap gap-3"><button className="gpp-button gpp-primary" disabled={approved || !reviewed || audit.unresolved.length > 0} onClick={() => { if (reviewed && !audit.unresolved.length) setApproved(true); }}>{approved && !audit.unresolved.length ? "Revision approved" : audit.proposals.length ? `Approve ${audit.proposals.length} proposed swaps` : "Approve reviewed portfolio"}</button><button className="gpp-button" disabled={!approved || !reviewed || audit.unresolved.length > 0} onClick={() => { if (!approved || !reviewed || audit.unresolved.length) return; try { download(exportClassicUpload(audit.revised), "elitelineup-classic-revised.csv"); } catch (e) { setError(e instanceof Error ? e.message : "Could not export revised entries."); } }}><Download size={15} />Download revised CSV</button></div>
      <p className="gpp-muted text-xs">Approval only enables a local download. Nothing is uploaded to DraftKings. Originals are not overwritten. Changing any file or exclusion clears approval.</p>
    </section>}
  </div>;
}
