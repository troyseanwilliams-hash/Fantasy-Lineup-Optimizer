import type { ClassicAudit, ClassicUpload, ClassicViolation, OfficialPlayer } from "./nfl-gpp-types";
import { CLASSIC_POSITION_CAPS, classicLogicSchema, classicMinimum, hasRole, rushingQualified, type ClassicLogic } from "./nfl-classic-logic";
import { parseGameInfo } from "./game-info";

export function auditClassicUpload(upload: ClassicUpload, official: OfficialPlayer[], excludedIds: string[], evidence?: ClassicLogic): ClassicAudit {
  if (!evidence) throw new Error("Import current Classic formula evidence before auditing. The old 25%/20% caps have been superseded.");
  const classic = classicLogicSchema.parse(evidence);
  if (classic.projectionSource !== "DFS Army") throw new Error("Offline upload certification requires strict imported evidence. App-data generation reports its unverified checks separately.");
  if (!upload.entries.length || upload.entries.length > 150) throw new Error("Audit supports 1–150 populated Classic entries.");
  if (official.some(p => p.cptId)) throw new Error("Classic audit cannot use a Showdown salary template.");
  const byId = new Map(official.map(p => [p.flexId, p]));
  if (byId.size !== official.length) throw new Error("Ambiguous official player IDs.");
  const excluded = new Set(excludedIds);
  if (excludedIds.some(id => !byId.has(id))) throw new Error("An exclusion does not belong to the uploaded official player pool.");
  const n = upload.entries.length;
  for (const p of official) {
    const e = classic.players[p.flexId];
    if (!e) throw new Error(`Full-list review missing for ${p.name}. Include inactive players in the evidence.`);
    for (const date of [e.statusCheckedAt, e.weatherCheckedAt]) {
      const age = Date.now() - Date.parse(date ?? "");
      if (!Number.isFinite(age) || age < -300000 || age > 6 * 3600000) throw new Error(`${p.name}: refresh injury and weather evidence (six-hour limit).`);
    }
  }
  const eligible = (p: OfficialPlayer) => {
    const e = classic.players[p.flexId];
    return ["ACTIVE","QUESTIONABLE"].includes(e.status) &&
      (p.pos === "DST" ? e.opponentImpliedTotal !== undefined && e.opponentImpliedTotal <= 21 &&
        [e.opponentSackRate,e.opponentFumbleRate,e.opponentIntRate].every(v=>v !== undefined) &&
        (p.flexSalary >= 2500 || e.eliteTurnoverMatchup) : e.projection >= 4) &&
      !(p.pos === "RB" && e.roadUnderdogSpread >= 10);
  };
  const anchorIds = Object.keys(classic.anchors);
  if (anchorIds.length < 2 || anchorIds.length > 3) throw new Error("Classic audit requires two or three weekly anchors in the evidence configuration.");
  for (const id of anchorIds) if (!byId.has(id) || !hasRole(classic.players[id])) throw new Error("An anchor is absent from the template or has no verified recent role.");
  const capPercent = (p: OfficialPlayer) => {
    if (!eligible(p) || excluded.has(p.flexId)) return 0;
    return Math.min(classic.anchors[p.flexId] ?? CLASSIC_POSITION_CAPS[p.pos] ?? 25, classic.players[p.flexId].topDefense ? 30 : 100);
  };
  const caps = new Map(official.map(p => [p.flexId, Math.floor(n * capPercent(p) / 100 + 1e-9)]));
  const slots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
  const rosterLegal = (ids: string[]) => {
    if (ids.length !== 9 || new Set(ids).size !== 9 || ids.some(id => !byId.has(id))) return false;
    const ps = ids.map(id => byId.get(id)!);
    return ps.every((p, i) => slots[i] === "FLEX" ? ["RB", "WR", "TE"].includes(p.pos) : p.pos === slots[i]) &&
      ps.reduce((s, p) => s + p.flexSalary, 0) <= 50000 && new Set(ps.map(p => p.team)).size >= 2;
  };
  const legal = (ids: string[]) => {
    if (!rosterLegal(ids)) return false;
    const ps = ids.map(id=>byId.get(id)!), qb = ps.find(p=>p.pos==="QB")!;
    return ps.every(eligible) &&
      ps.reduce((sum,p)=>sum+classic.players[p.flexId].ownership,0) <= 115 &&
      (ps.some(p=>p.team===qb.team && ["WR","TE"].includes(p.pos)) || rushingQualified(classic.players[qb.flexId]));
  };
  upload.entries.forEach((e, i) => {
    if (!rosterLegal(e.playerIds)) throw new Error(`Entry ${i + 1} has an invalid roster, official salary over $50,000, or players from only one team.`);
  });
  const revised: ClassicUpload = {
    header: [...upload.header], slotIndices: [...upload.slotIndices],
    entries: upload.entries.map(e => ({ ...e, cells: [...e.cells], playerIds: [...e.playerIds] })),
  };
  const counts = new Map<string, number>();
  for (const e of revised.entries) for (const id of e.playerIds) counts.set(id, (counts.get(id) || 0) + 1);
  const violations = (): ClassicViolation[] => Array.from(counts).flatMap(([id, count]) => {
    const cap = excluded.has(id) ? 0 : caps.get(id)!;
    return count > cap ? [{ id, name: byId.get(id)!.name, count, cap, percent: count / n * 100, excluded: excluded.has(id) }] : [];
  });
  const original = violations();
  const proposals: ClassicAudit["proposals"] = [];
  for (const violation of original.sort((a, b) => Number(b.excluded) - Number(a.excluded) || b.count - b.cap - (a.count - a.cap))) {
    for (let entry = 0; entry < revised.entries.length && (counts.get(violation.id) || 0) > violation.cap; entry++) {
      const e = revised.entries[entry];
      const slot = e.playerIds.indexOf(violation.id);
      if (slot < 0) continue;
      const from = byId.get(violation.id)!;
      // Keep the original position, even at FLEX; prefer the closest salary.
      const alternatives = official.filter(p => p.pos === from.pos && !excluded.has(p.flexId) &&
        !e.playerIds.includes(p.flexId) && (counts.get(p.flexId) || 0) < caps.get(p.flexId)!)
        .sort((a, b) => Math.abs(a.flexSalary - from.flexSalary) - Math.abs(b.flexSalary - from.flexSalary) || a.name.localeCompare(b.name));
      const replacement = alternatives.find(p => {
        const ids = [...e.playerIds]; ids[slot] = p.flexId;
        return legal(ids);
      });
      if (!replacement) continue;
      proposals.push({ entry: entry + 1, slot, fromId: from.flexId, toId: replacement.flexId, fromName: from.name, toName: replacement.name });
      counts.set(from.flexId, counts.get(from.flexId)! - 1);
      counts.set(replacement.flexId, (counts.get(replacement.flexId) || 0) + 1);
      e.playerIds[slot] = replacement.flexId;
      e.cells[upload.slotIndices[slot]] = replacement.flexId;
    }
  }
  const warnings = [
    "Suggestions validate supplied DFS Army projections, ownership, full-list availability and official salaries. Final role, game architecture and FLEX ceiling review still require approval.",
    "No saved lineup, original CSV or DraftKings entry has been modified. Downloading an approved file does not submit it to DraftKings.",
  ];
  if (n < 4) warnings.push("Fewer than four lineups cannot satisfy the position caps: some allowed counts round down to zero.");
  const unresolved = violations();
  const problem = (id: string, name: string) => unresolved.push({id,name,count:1,cap:0,percent:100,excluded:false});
  for (const [i,e] of Array.from(revised.entries.entries())) {
    if (!legal(e.playerIds)) problem(`lineup-${i}`,`Lineup ${i+1}: availability, 4-point floor, DST script, 115% ownership or naked-QB rule failed`);
    for (let j=0;j<i;j++) if (e.playerIds.filter(id=>revised.entries[j].playerIds.includes(id)).length>6)
      problem(`unique-${i}-${j}`,`Lineups ${j+1} and ${i+1} differ by fewer than three players`);
  }
  for (const p of official) {
    const e = classic.players[p.flexId];
    if (!eligible(p) || excluded.has(p.flexId)) continue;
    const min = Math.max(classicMinimum(e,p.pos), classic.anchors[p.flexId] ? Math.min(classic.anchors[p.flexId], e.topDefense?30:100) : 0);
    if ((counts.get(p.flexId)||0) < Math.ceil(min*n/100-1e-8)) problem(`min-${p.flexId}`,`${p.name}: below required ${min}% role/anchor exposure`);
  }
  const usedDst = official.filter(p=>p.pos==="DST"&&(counts.get(p.flexId)||0)>0);
  if (usedDst.length < 4 || usedDst.length > 6) problem("dst-room",`DST concentration: ${usedDst.length} defenses used; require 4–6`);
  if (official.some(p=>eligible(p) && !parseGameInfo(p.gameInfo).matchup)) {
    problem("matchups","Official Game Info is required to certify full Classic architecture");
  } else {
    const shapes = revised.entries.map(entry=>{
      const ps=entry.playerIds.map(id=>byId.get(id)!), qb=ps.find(p=>p.pos==="QB")!;
      const game=(p:OfficialPlayer)=>parseGameInfo(p.gameInfo).matchup;
      const catchers=ps.filter(p=>p.team===qb.team&&["WR","TE"].includes(p.pos)).length;
      const back=ps.some(p=>game(p)===game(qb)&&p.team!==qb.team&&["RB","WR","TE"].includes(p.pos));
      const others=ps.filter(p=>game(p)!==game(qb)&&["RB","WR","TE"].includes(p.pos));
      const secondary=others.some(p=>others.filter(q=>game(q)===game(p)).length>=2);
      return {qb:qb.flexId,catchers,back,full:catchers>=2&&back&&secondary};
    });
    const doubles=shapes.filter(s=>s.catchers>=2).length, doubleTarget=Math.round(n*classic.doubleStackPct/100);
    const backs=shapes.filter(s=>s.back).length, backTarget=Math.round(n*classic.bringBackPct/100);
    if(doubles<doubleTarget||doubles>doubleTarget+1) problem("doubles",`Double-stack count ${doubles}; target ${doubleTarget}–${doubleTarget+1}`);
    if(backs<Math.max(1,backTarget-1)||backs>Math.min(n-1,backTarget+1)) problem("backs",`Bring-back count ${backs}; target about ${classic.bringBackPct}%`);
    if(shapes.filter(s=>s.full).length<Math.round(n*classic.fullArchitecturePct/100)) problem("architecture","Too few QB+2 + run-back + secondary-game lineups");
    if(shapes.filter(s=>!s.catchers).length>Math.floor(n*classic.nakedPct/100)) problem("naked","Too many naked-QB lineups");
    for(const id of Array.from(new Set(shapes.map(s=>s.qb)))) {
      const own=shapes.filter(s=>s.qb===id);
      if(own.filter(s=>!s.catchers).length>own.length*.14) problem(`naked-${id}`,"Naked exception exceeds 14% of this QB's lineups");
    }
    const qbRoom=new Set(shapes.map(s=>s.qb)).size;
    if(n>=150&&(qbRoom<12||qbRoom>19)) problem("qb-room","150-entry portfolio requires 12–19 distinct QBs");
  }
  if (unresolved.length) warnings.push("Some exposures remain over cap. Add eligible alternatives or change the entry set and audit again.");
  // Audit proposals again against official salaries, original slot constraints and actual batch size.
  if (revised.entries.some(e => !rosterLegal(e.playerIds))) throw new Error("Proposed changes failed the final salary/roster audit.");
  return { violations: original, proposals, unresolved, warnings, revised };
}
