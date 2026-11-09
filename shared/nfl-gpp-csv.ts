import type { ClassicUpload, GppPlayer, GppPosition, OfficialPlayer, StrategyLineup } from "./nfl-gpp-types";

export function readCsv(text: string): string[][] {
  if (text.length > 3_000_000) throw new Error("CSV exceeds the 3 MB limit.");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(cell.replace(/\r$/, "").trim()); cell = "";
      if (c === "\n") { if (row.some(Boolean)) rows.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell.replace(/\r$/, "").trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export const csvText = (rows: (string | number)[][]) =>
  rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const get = (row: string[], header: string[], names: string[]) => {
  const index = header.findIndex(h => names.includes(key(h)));
  return index < 0 ? "" : row[index] || "";
};
function numeric(value: string, label: string, max = Infinity): number {
  if (!value.trim()) throw new Error(`Missing ${label}. Supply it explicitly, including zero ownership.`);
  const n = Number(value.replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`Invalid ${label}: ${value}`);
  return n;
}
const positions = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
export function parseCheatSheet(text: string): GppPlayer[] {
  const records = new Map<string, Partial<GppPlayer>>();
  let header: string[] = [];
  for (const row of readCsv(text)) {
    if (row.some(c => ["player", "name"].includes(key(c))) &&
        row.some(c => ["position", "pos"].includes(key(c)))) { header = row; continue; }
    if (!header.length || row.length < 3) continue;
    const name = get(row, header, ["player", "name"]);
    const pos = get(row, header, ["position", "pos"]).toUpperCase().replace("D/ST", "DST");
    if (!name) continue;
    if (!positions.has(pos)) throw new Error(`Invalid position for ${name}: ${pos}. Use QB/RB/WR/TE/K/DST.`);
    const team = get(row, header, ["team", "teamabbrev"]).toUpperCase();
    if (!team) throw new Error(`Missing team for ${name}.`);
    const id = `${nameKey(name)}|${team}`;
    const prior = records.get(id) || { id, name, pos: pos as GppPosition, team };
    const slot = get(row, header, ["rosterposition", "slottype", "slot"]).toUpperCase();
    const projection = numeric(get(row, header, ["projection", "proj", "projectedpoints"]), `${name} projection`);
    if (slot === "CPT" || slot === "FLEX") {
      const salary = numeric(get(row, header, ["salary", slot === "CPT" ? "cptsalary" : "flexsalary"]), `${name} ${slot} salary`, 50000);
      const own = numeric(get(row, header, ["ownership", "ownershippercent", "ownershippct", slot === "CPT" ? "cptownership" : "flexownership"]), `${name} ${slot} ownership`, 100);
      if (slot === "CPT") {
        if (prior.cptSalary !== undefined) throw new Error(`Duplicate CPT row for ${name}.`);
        prior.cptSalary = salary; prior.cptOwn = own;
      } else {
        if (prior.flexSalary !== undefined) throw new Error(`Duplicate FLEX row for ${name}.`);
        prior.flexSalary = salary; prior.flexOwn = own; prior.projection = projection;
      }
    } else {
      if (prior.flexSalary !== undefined) throw new Error(`Duplicate player row for ${name}.`);
      prior.flexSalary = numeric(get(row, header, ["flexsalary", "flexsal"]), `${name} FLEX salary`, 50000);
      prior.cptSalary = numeric(get(row, header, ["cptsalary", "captainsalary", "cptsal"]), `${name} CPT salary`, 50000);
      prior.cptOwn = numeric(get(row, header, ["cptownership", "cptown", "captainownership"]), `${name} CPT ownership`, 100);
      prior.flexOwn = numeric(get(row, header, ["flexownership", "flexown"]), `${name} FLEX ownership`, 100);
      prior.projection = projection;
    }
    records.set(id, prior);
  }
  const players = Array.from(records.values());
  if (players.length < 6 || players.length > 60) throw new Error("A Showdown sheet must contain 6–60 unique players.");
  for (const p of players) {
    if ([p.flexSalary, p.cptSalary, p.projection, p.cptOwn, p.flexOwn].some(v => v === undefined)) throw new Error(`Missing CPT or FLEX data for ${p.name}.`);
    if (p.flexSalary! <= 0 || p.cptSalary !== p.flexSalary! * 1.5) throw new Error(`${p.name}: CPT salary must equal 1.5 × FLEX salary.`);
  }
  if (new Set(players.map(p => p.team)).size !== 2) throw new Error("Showdown requires exactly two teams.");
  return players as GppPlayer[];
}

export function parseOfficialTemplate(text: string): OfficialPlayer[] {
  const records = new Map<string, OfficialPlayer>();
  const ids = new Set<string>();
  let header: string[] = [];
  for (const row of readCsv(text)) {
    if (row.some(c => key(c) === "id") && row.some(c => key(c) === "name") && row.some(c => key(c) === "salary")) {
      header = row; continue;
    }
    if (!header.length) continue;
    const name = get(row, header, ["name"]);
    const id = get(row, header, ["id"]);
    if (!name && !id) continue;
    if (!name || !/^\d+$/.test(id)) throw new Error("Official template contains an invalid name or draftable ID.");
    if (ids.has(id)) throw new Error(`Duplicate official draftable ID ${id}.`);
    ids.add(id);
    const team = get(row, header, ["teamabbrev", "team"]).toUpperCase();
    const pos = get(row, header, ["position"]).toUpperCase().replace("D/ST", "DST");
    if (!team || !positions.has(pos)) throw new Error(`Missing team or invalid NFL position for ${name}.`);
    const slot = get(row, header, ["rosterposition"]).toUpperCase();
    const salary = numeric(get(row, header, ["salary"]), `${name} official salary`, 50000);
    if (salary <= 0) throw new Error(`${name} has no published salary.`);
    const k = `${nameKey(name)}|${team}`;
    const p = records.get(k) || { name, team, pos, flexId: "", flexSalary: 0, gameInfo: get(row, header, ["gameinfo", "game"]) };
    if (slot === "CPT") {
      if (p.cptId) throw new Error(`Ambiguous captain ID for ${name}.`);
      p.cptId = id; p.cptSalary = salary;
    } else {
      // Classic exports may have positional and FLEX entries: do not guess IDs.
      if (p.flexId && p.flexId !== id) throw new Error(`Multiple FLEX/position IDs for ${name}. Use the exact contest's salary template.`);
      p.flexId = id; p.flexSalary = salary;
    }
    records.set(k, p);
  }
  if (!records.size) throw new Error("No DraftKings salary table found. Upload a template with Name, ID, Position, Salary and TeamAbbrev columns.");
  for (const p of Array.from(records.values())) if (!p.flexId) throw new Error(`Missing FLEX row for ${p.name}.`);
  return Array.from(records.values());
}
export function exportShowdownReport(lineups: StrategyLineup[], players: GppPlayer[]): string {
  const names = new Map(players.map(p => [p.id, p.name]));
  return csvText([["Lineup", "CPT", "FLEX1", "FLEX2", "FLEX3", "FLEX4", "FLEX5", "Salary", "Proj", "TotOwn%"],
    ...lineups.map((l, i) => [i + 1, names.get(l.captain)!, ...l.flex.map(id => names.get(id)!), l.salary, l.projection.toFixed(2), l.ownership.toFixed(2)])]);
}
export function exportShowdownUpload(lineups: StrategyLineup[], players: GppPlayer[], official: OfficialPlayer[]): string {
  const byId = new Map(players.map(p => [p.id, p]));
  const exact = new Map(official.map(p => [`${nameKey(p.name)}|${p.team}`, p]));
  const resolve = (id: string, captain: boolean) => {
    const p = byId.get(id);
    const o = p && exact.get(`${nameKey(p.name)}|${p.team}`);
    if (!p || !o) throw new Error(`No exact official name/team match for ${p?.name || id}. IDs will not be guessed.`);
    if (!o.cptId || o.cptId === o.flexId || o.cptSalary !== o.flexSalary * 1.5) throw new Error(`Missing or invalid slot-specific captain ID/salary for ${p.name}.`);
    if (o.flexSalary !== p.flexSalary || o.cptSalary !== p.cptSalary) throw new Error(`Official salary changed for ${p.name}. Update the sheet and regenerate.`);
    return { id: captain ? o.cptId : o.flexId, salary: captain ? o.cptSalary : o.flexSalary };
  };
  return csvText([["Entry ID", "CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"],
    ...lineups.map(l => {
      const ps = [resolve(l.captain, true), ...l.flex.map(id => resolve(id, false))];
      if (new Set([l.captain, ...l.flex]).size !== 6 || ps.reduce((s, p) => s + p.salary, 0) > 50000) throw new Error("Official-template salary or unique-roster validation failed.");
      return ["", ...ps.map(p => p.id)];
    })]);
}
export function parseClassicUpload(text: string, official: OfficialPlayer[]): ClassicUpload {
  if (official.some(p => p.cptId)) throw new Error("Use a Classic salary template, not a Showdown template.");
  const rows = readCsv(text);
  const start = rows.findIndex(r => r.filter(c => c.trim().toUpperCase() === "RB").length === 2 && r.some(c => c.toUpperCase() === "DST"));
  if (start < 0) throw new Error("Classic CSV needs QB,RB,RB,WR,WR,WR,TE,FLEX,DST roster columns.");
  const header = rows[start];
  const slotIndices = header.flatMap((h, i) => /^(QB|RB|WR|TE|FLEX|DST)$/i.test(h) ? [i] : []);
  if (slotIndices.map(i => header[i].toUpperCase()).join(",") !== "QB,RB,RB,WR,WR,WR,TE,FLEX,DST") throw new Error("Invalid DraftKings NFL Classic roster columns.");
  const ids = new Set(official.map(p => p.flexId));
  const entryIndex = header.findIndex(h => key(h) === "entryid");
  const entries = [];
  for (const row of rows.slice(start + 1)) {
    if (row.some(c => key(c) === "rosterposition")) break;
    if (!slotIndices.some(i => row[i])) continue;
    const playerIds = slotIndices.map(i => {
      const value = row[i] || "";
      const id = value.match(/\((\d+)\)\s*$/)?.[1] || value.trim();
      if (!ids.has(id)) throw new Error(`Unknown player ID "${value}" on entry ${entries.length + 1}. Use its exact contest template.`);
      return id;
    });
    if (new Set(playerIds).size !== 9) throw new Error(`Duplicate players on entry ${entries.length + 1}.`);
    entries.push({ entryId: entryIndex < 0 ? "" : row[entryIndex] || "", cells: row, playerIds });
  }
  if (!entries.length || entries.length > 150) throw new Error("Audit supports 1–150 populated Classic entries.");
  return { header, slotIndices, entries };
}
export function exportClassicUpload(upload: ClassicUpload): string {
  return csvText([upload.header, ...upload.entries.map(e => e.cells)]);
}
