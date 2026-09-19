export const MMA_ROSTER_SIZE = 6;
export const MMA_SALARY_CAP = 50_000;
export const MMA_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MMA_MAX_FIGHTERS = 100;

export interface MmaFighter {
  id: string;
  name: string;
  position: string;
  salary: number;
  gameInfo: string;
  team: string;
  startTime: number | null;
  boutKey: string | null;
  projection: number | null;
  locked: boolean;
  excluded: boolean;
}

export interface MmaLineup {
  fighters: MmaFighter[];
  salary: number;
  projection: number;
}

function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseCsvRows(text: string): string[][] {
  if (new TextEncoder().encode(text).byteLength > MMA_MAX_FILE_BYTES) {
    throw new Error("CSV is too large. The maximum file size is 2 MB.");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += char;
      }
    } else if (char === '"') {
      if (field.length > 0 || closedQuote) throw new Error(`Malformed CSV near row ${rows.length + 1}: unexpected quote.`);
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
    } else {
      if (closedQuote && !/\s/.test(char)) {
        throw new Error(`Malformed CSV near row ${rows.length + 1}: unexpected text after a closing quote.`);
      }
      field += char;
    }
  }
  if (quoted) throw new Error("Malformed CSV: an opening quote is not closed.");
  row.push(field);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);
  return rows;
}

function parseDkTime(gameInfo: string): number | null {
  const match = gameInfo.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*(ET|EST|EDT)?/i,
  );
  if (!match) return null;
  const [, month, day, year, rawHour, minute, meridiem, zone] = match;
  let hour = Number(rawHour) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;
  // DK salary files use ET. Explicit EST/EDT are respected; generic ET uses
  // Intl's DST-aware conversion by comparing the formatted UTC candidates.
  const offset = zone?.toUpperCase() === "EST" ? 5 : zone?.toUpperCase() === "EDT" ? 4 : null;
  if (offset !== null) return Date.UTC(Number(year), Number(month) - 1, Number(day), hour + offset, Number(minute));
  const desired = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${String(hour).padStart(2, "0")}:${minute}`;
  for (const candidateOffset of [4, 5]) {
    const candidate = Date.UTC(Number(year), Number(month) - 1, Number(day), hour + candidateOffset, Number(minute));
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(candidate);
    const get = (type: string) => parts.find(part => part.type === type)?.value || "";
    if (`${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}` === desired) return candidate;
  }
  return null;
}

function boutKey(gameInfo: string): string | null {
  if (!gameInfo.trim()) return null;
  const beforeDate = gameInfo.split(/\s+\d{1,2}\/\d{1,2}\/\d{4}/)[0].trim().toLowerCase();
  const matchup = beforeDate.match(/^(.+?)\s*(?:@|\bvs?\.?\b)\s*(.+?)$/i);
  if (!matchup || !matchup[1].trim() || !matchup[2].trim()) return null;
  return matchup.slice(1).map(side => side.trim().replace(/\s+/g, " ")).sort().join("|");
}

export function parseDraftKingsMmaCsv(text: string): MmaFighter[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("The CSV has no fighter rows.");
  const headers = rows[0].map(cleanHeader);
  if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column headers.");
  const find = (...names: string[]) => headers.findIndex(header => names.includes(header));
  const positionIndex = find("position", "rosterposition");
  const nameIndex = find("name");
  const nameIdIndex = find("nameid");
  const idIndex = find("id");
  const salaryIndex = find("salary");
  const gameIndex = find("gameinfo");
  const teamIndex = find("teamabbrev", "team");
  if (positionIndex < 0 || salaryIndex < 0 || (nameIndex < 0 && nameIdIndex < 0) || (idIndex < 0 && nameIdIndex < 0)) {
    throw new Error("This is not a DraftKings MMA salary CSV. Required columns are Position, Name, ID, and Salary.");
  }
  const fighters: MmaFighter[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row.length !== rows[0].length) {
      throw new Error(`Malformed CSV row ${rowIndex + 1}: expected ${rows[0].length} columns but found ${row.length}.`);
    }
    const position = (row[positionIndex] || "").trim().toUpperCase();
    if (position !== "F" && position !== "FIGHTER") {
      throw new Error(`Non-MMA position "${position || "blank"}" found on CSV row ${rowIndex + 1}.`);
    }
    const combined = nameIdIndex >= 0 ? (row[nameIdIndex] || "").trim() : "";
    const combinedMatch = combined.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const explicitName = nameIndex >= 0 ? (row[nameIndex] || "").trim() : "";
    const explicitId = idIndex >= 0 ? (row[idIndex] || "").trim() : "";
    if (combined && !combinedMatch) throw new Error(`Invalid Name + ID value on CSV row ${rowIndex + 1}.`);
    if (combinedMatch && explicitId && combinedMatch[2].trim() !== explicitId) {
      throw new Error(`Conflicting DraftKings IDs on CSV row ${rowIndex + 1}.`);
    }
    if (combinedMatch && explicitName && combinedMatch[1].trim().toLocaleLowerCase() !== explicitName.toLocaleLowerCase()) {
      throw new Error(`Conflicting fighter names on CSV row ${rowIndex + 1}.`);
    }
    const name = (explicitName || combinedMatch?.[1] || "").trim();
    const id = (explicitId || combinedMatch?.[2] || "").trim();
    const salaryText = (row[salaryIndex] || "").replace(/[$,\s]/g, "");
    const salary = Number(salaryText);
    if (!name || !id) throw new Error(`Missing fighter name or official DraftKings ID on CSV row ${rowIndex + 1}.`);
    if (!/^\d+$/.test(id)) throw new Error(`Invalid DraftKings ID on CSV row ${rowIndex + 1}.`);
    if (!Number.isInteger(salary) || salary <= 0 || salary > MMA_SALARY_CAP) {
      throw new Error(`Invalid salary for ${name} on CSV row ${rowIndex + 1}.`);
    }
    const nameKey = name.toLocaleLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate DraftKings ID ${id} in the salary CSV.`);
    if (names.has(nameKey)) throw new Error(`Duplicate fighter "${name}" in the salary CSV.`);
    ids.add(id);
    names.add(nameKey);
    const gameInfo = gameIndex >= 0 ? (row[gameIndex] || "").trim() : "";
    fighters.push({
      id, name, position, salary, gameInfo,
      team: teamIndex >= 0 ? (row[teamIndex] || "").trim() : "",
      startTime: parseDkTime(gameInfo),
      boutKey: boutKey(gameInfo),
      projection: null,
      locked: false,
      excluded: false,
    });
  }
  if (fighters.length > MMA_MAX_FIGHTERS) throw new Error(`The CSV exceeds the ${MMA_MAX_FIGHTERS}-fighter safety limit.`);
  if (fighters.length < MMA_ROSTER_SIZE) throw new Error("The CSV needs at least 6 unique MMA fighters.");
  const dates = new Set(
    fighters.filter(f => f.startTime !== null).map(f =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(f.startTime!),
    ),
  );
  if (dates.size > 1) throw new Error("The CSV contains fights from multiple event dates. Import one DraftKings slate at a time.");
  return fighters;
}

function conflicts(a: MmaFighter, b: MmaFighter): boolean {
  return !!a.boutKey && a.boutKey === b.boutKey;
}

export function optimizeMmaLineups(
  fighters: MmaFighter[],
  count: number,
  avoidOpponents: boolean,
  now = Date.now(),
): MmaLineup[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Lineup count must be between 1 and 20.");
  const suppliedStarts = fighters.flatMap(f => f.startTime === null ? [] : [f.startTime]);
  if (suppliedStarts.length > 0 && Math.min(...suppliedStarts) <= now) {
    throw new Error("This MMA slate has started. DraftKings Classic MMA lineups cannot be changed after the slate's earliest supplied start time.");
  }
  const available = fighters.filter(f => !f.excluded && (f.startTime === null || f.startTime > now));
  if (available.some(f => f.projection === null || !Number.isFinite(f.projection) || f.projection < 0)) {
    throw new Error("Enter a valid manual projection for every included fighter. DraftKings AvgPointsPerGame is not used.");
  }
  const locked = available.filter(f => f.locked);
  if (fighters.some(f => f.locked && (f.excluded || (f.startTime !== null && f.startTime <= now)))) {
    throw new Error("A locked fighter is excluded or has an already-started fight.");
  }
  if (locked.length > MMA_ROSTER_SIZE) throw new Error("No more than 6 fighters can be locked.");
  if (available.length < MMA_ROSTER_SIZE) throw new Error("Fewer than 6 eligible fighters remain.");
  if (avoidOpponents && locked.some((a, i) => locked.slice(i + 1).some(b => conflicts(a, b)))) {
    throw new Error("Locked fighters include opponents while Avoid opponents is enabled.");
  }
  const lockedIds = new Set(locked.map(f => f.id));
  const candidates = available
    .filter(f => !lockedIds.has(f.id))
    .sort((a, b) => (b.projection! - a.projection!) || a.salary - b.salary || a.id.localeCompare(b.id));
  const need = MMA_ROSTER_SIZE - locked.length;
  const baseSalary = locked.reduce((sum, f) => sum + f.salary, 0);
  const baseProjection = locked.reduce((sum, f) => sum + f.projection!, 0);
  const results: MmaLineup[] = [];
  let nodes = 0;
  const NODE_LIMIT = 2_000_000;
  const insert = (chosen: MmaFighter[], salary: number, projection: number) => {
    const lineup = { fighters: [...locked, ...chosen].sort((a, b) => a.name.localeCompare(b.name)), salary, projection };
    results.push(lineup);
    results.sort((a, b) => b.projection - a.projection || b.salary - a.salary);
    if (results.length > count) results.pop();
  };
  const search = (start: number, chosen: MmaFighter[], salary: number, projection: number) => {
    if (++nodes > NODE_LIMIT) throw new Error("This player pool is too complex to solve safely in the browser. Exclude additional fighters and retry.");
    if (chosen.length === need) {
      if (salary <= MMA_SALARY_CAP) insert(chosen, salary, projection);
      return;
    }
    const remaining = need - chosen.length;
    if (candidates.length - start < remaining) return;
    if (results.length === count) {
      let optimistic = projection;
      for (let i = 0; i < remaining; i++) optimistic += candidates[start + i]?.projection || 0;
      if (optimistic < results[results.length - 1].projection) return;
    }
    for (let i = start; i <= candidates.length - remaining; i++) {
      const fighter = candidates[i];
      const nextSalary = salary + fighter.salary;
      if (nextSalary > MMA_SALARY_CAP) continue;
      if (avoidOpponents && [...locked, ...chosen].some(other => conflicts(fighter, other))) continue;
      search(i + 1, [...chosen, fighter], nextSalary, projection + fighter.projection!);
    }
  };
  search(0, [], baseSalary, baseProjection);
  if (results.length < count) {
    const detail = results.length ? `Only ${results.length} unique feasible lineup${results.length === 1 ? "" : "s"} exist.` : "No feasible lineup exists.";
    throw new Error(`${detail} Check salary, locks, exclusions, started fights, and opponent rules.`);
  }
  return results;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportMmaLineups(lineups: MmaLineup[], importedFighters: MmaFighter[], now = Date.now()): string {
  if (!lineups.length) throw new Error("Generate at least one lineup before exporting.");
  const suppliedStarts = importedFighters.flatMap(f => f.startTime === null ? [] : [f.startTime]);
  if (suppliedStarts.length > 0 && Math.min(...suppliedStarts) <= now) {
    throw new Error("This MMA slate has started. Export is blocked after the slate's earliest supplied start time.");
  }
  const currentById = new Map(importedFighters.map(f => [f.id, f]));
  for (const lineup of lineups) {
    if (lineup.fighters.length !== MMA_ROSTER_SIZE || new Set(lineup.fighters.map(f => f.id)).size !== MMA_ROSTER_SIZE) {
      throw new Error("An export lineup does not contain 6 unique official fighter IDs.");
    }
    const current = lineup.fighters.map(f => currentById.get(f.id));
    if (current.some(f => !f)) throw new Error("An export lineup contains a fighter outside the imported salary file.");
    const salary = current.reduce((sum, f) => sum + f!.salary, 0);
    if (salary > MMA_SALARY_CAP) throw new Error("An export lineup exceeds the $50,000 salary cap.");
  }
  const header = Array.from({ length: MMA_ROSTER_SIZE }, () => "F").map(csvCell).join(",");
  const rows = lineups.map(lineup => lineup.fighters.map(f => csvCell(`${f.name} (${f.id})`)).join(","));
  return [header, ...rows].join("\n");
}