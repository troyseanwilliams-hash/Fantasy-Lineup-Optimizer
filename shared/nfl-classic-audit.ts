import type { ClassicAudit, ClassicUpload, ClassicViolation, OfficialPlayer } from "./nfl-gpp-types";

export function auditClassicUpload(upload: ClassicUpload, official: OfficialPlayer[], excludedIds: string[]): ClassicAudit {
  if (!upload.entries.length || upload.entries.length > 150) throw new Error("Audit supports 1–150 populated Classic entries.");
  if (official.some(p => p.cptId)) throw new Error("Classic audit cannot use a Showdown salary template.");
  const byId = new Map(official.map(p => [p.flexId, p]));
  if (byId.size !== official.length) throw new Error("Ambiguous official player IDs.");
  const excluded = new Set(excludedIds);
  if (excludedIds.some(id => !byId.has(id))) throw new Error("An exclusion does not belong to the uploaded official player pool.");
  const n = upload.entries.length;
  const caps = new Map(official.map(p => [p.flexId, Math.floor(n * (["QB", "DST"].includes(p.pos) ? 0.20 : 0.25) + 1e-9)]));
  const slots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
  const legal = (ids: string[]) => {
    if (ids.length !== 9 || new Set(ids).size !== 9 || ids.some(id => !byId.has(id))) return false;
    const ps = ids.map(id => byId.get(id)!);
    return ps.every((p, i) => slots[i] === "FLEX" ? ["RB", "WR", "TE"].includes(p.pos) : p.pos === slots[i]) &&
      ps.reduce((s, p) => s + p.flexSalary, 0) <= 50000 && new Set(ps.map(p => p.team)).size >= 2;
  };
  upload.entries.forEach((e, i) => {
    if (!legal(e.playerIds)) throw new Error(`Entry ${i + 1} has an invalid roster, official salary over $50,000, or players from only one team.`);
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
        !e.playerIds.includes(p.flexId) && (counts.get(p.flexId) || 0) < caps.get(p.flexId)! &&
        (p.pos !== "RB" || p.flexSalary >= 4500))
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
    "Suggestions use official salaries and positional eligibility, not current projections, injuries or game correlation. Review every swap before approval.",
    "No saved lineup, original CSV or DraftKings entry has been modified. Downloading an approved file does not submit it to DraftKings.",
  ];
  if (n < 5) warnings.push("Fewer than five lineups cannot satisfy a 20% QB/DST cap: the allowed count rounds down to zero.");
  const unresolved = violations();
  if (unresolved.length) warnings.push("Some exposures remain over cap. Add eligible alternatives or change the entry set and audit again.");
  // Audit proposals again against official salaries, original slot constraints and actual batch size.
  if (revised.entries.some(e => !legal(e.playerIds))) throw new Error("Proposed changes failed the final salary/roster audit.");
  return { violations: original, proposals, unresolved, warnings, revised };
}
