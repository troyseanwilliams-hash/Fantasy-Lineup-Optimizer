// ============================================================
// server/fanduel-ingest.ts
//
// Fetches FanDuel DFS main slate data and upserts it into DB.
//
// DATA SOURCES (tried in priority order):
//
//   1. SportsData.io (SPORTSDATA_API_KEY env var)
//      Most reliable. Returns structured JSON with projections.
//      Date format must be YYYY-MMM-DD (e.g. 2024-JAN-15) —
//      NOT "/today" which was the bug in the previous version.
//
//   2. FanDuel JSON API (FD_SESSION_COOKIE or FD_AUTH_TOKEN)
//      Tries https://api.fanduel.com/fixture-lists/{id}/players
//
//   3. FanDuel CSV download (same auth)
//      Tries two known CSV URL patterns as final fallback.
//
// ENV VARS:
//   SPORTSDATA_API_KEY  — SportsData.io subscription key
//   FD_SESSION_COOKIE   — value of _fanduel_session browser cookie
//   FD_AUTH_TOKEN       — FD API bearer token (alternative)
// ============================================================

import { storage } from "./storage";
import type { InsertSlate, InsertPlayer } from "@shared/schema";

export type FDSport = "NBA" | "NFL" | "MLB" | "NHL" | "GOLF";

// ── Constants ─────────────────────────────────────────────────────────────────

const FD_SPORT_SLUGS: Record<FDSport, string> = {
  NBA: "NBA", NFL: "NFL", MLB: "MLB", NHL: "NHL", GOLF: "PGA",
};

const SD_SPORT_SLUGS: Record<FDSport, string> = {
  NBA: "nba", NFL: "nfl", MLB: "mlb", NHL: "nhl", GOLF: "golf",
};

// Default salary caps by sport when not returned by API
const FD_SALARY_CAPS: Record<FDSport, number> = {
  NBA: 60000, NFL: 60000, MLB: 35000, NHL: 55000, GOLF: 60000,
};

const SD_MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ── Types ─────────────────────────────────────────────────────────────────────

interface FDSlateInfo {
  id: string;
  label: string;
  sport: FDSport;
  startTime: Date;
  salaryCap: number;
  isMain: boolean;
  draftGroupId: number | null;
}

interface FDPlayerRow {
  name: string;
  position: string;
  team: string;
  opponent: string;
  gameInfo: string;
  salary: number;
  fppg: number;
  projectedPoints: number;
  injuryStatus: string | null;
  fanDuelPlayerId: number | null;
}

// ── Position normalization ────────────────────────────────────────────────────

function normalizeFDPosition(raw: string, sport: FDSport): string {
  const p = (raw || "").trim().toUpperCase();
  if (sport === "NFL" && p === "D") return "DEF";
  if (sport === "MLB" && (p === "P" || p === "RP")) return "SP";
  return p;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function getFDHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.fanduel.com",
    "Referer": "https://www.fanduel.com/",
    ...extraHeaders,
  };
  const token = process.env.FD_AUTH_TOKEN;
  if (token) h["Authorization"] = `Bearer ${token}`;
  const cookie = process.env.FD_SESSION_COOKIE;
  if (cookie) h["Cookie"] = `_fanduel_session=${cookie}`;
  return h;
}

async function fdFetch(url: string, extra: Record<string, string> = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: getFDHeaders(extra), signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res;
  } catch (err: any) {
    clearTimeout(t);
    if (err.name === "AbortError") throw new Error(`Timeout: ${url}`);
    throw err;
  }
}

async function fdFetchRetry(url: string, extra: Record<string, string> = {}): Promise<Response> {
  let last!: Error;
  for (let i = 1; i <= 3; i++) {
    try { return await fdFetch(url, extra); }
    catch (err: any) {
      last = err;
      if (i < 3) await new Promise(r => setTimeout(r, i * 1500));
    }
  }
  throw last;
}

// ── Slate discovery ───────────────────────────────────────────────────────────

async function fetchFDSlates(sport: FDSport): Promise<FDSlateInfo[]> {
  const url = `https://api.fanduel.com/fixture-lists?sport=${FD_SPORT_SLUGS[sport]}&_format=json`;
  let data: any;
  try {
    const res = await fdFetchRetry(url);
    data = await res.json();
  } catch (err: any) {
    console.error(`[FD Ingest] Slate fetch failed for ${sport}: ${err.message}`);
    return [];
  }

  const fixtureLists: any[] = data?.fixture_lists ?? [];

  // Build today's ET window for filtering
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStart = new Date(nowET); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(nowET); todayEnd.setHours(23,59,59,999);

  const slates: FDSlateInfo[] = [];

  for (const fl of fixtureLists) {
    const rawDate = fl.start_date ?? fl.start_time ?? fl.date;
    if (!rawDate) continue;

    const startTime = new Date(rawDate);
    const startET = new Date(startTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
    if (startET < todayStart || startET > todayEnd) continue;

    const label = fl.label ?? `${sport} ${startET.toLocaleDateString()}`;
    const isMain =
      fl.is_guaranteed === true ||
      fl.is_primary === true ||
      /\b(main|classic|slam)\b/i.test(label);

    slates.push({
      id: String(fl.id),
      label,
      sport,
      startTime,
      salaryCap: fl.salary_cap ?? FD_SALARY_CAPS[sport],
      isMain,
      draftGroupId: fl.draft_group_id ?? (fl.id ? Number(fl.id) : null),
    });
  }

  // Main slates first, earliest start first
  slates.sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    return a.startTime.getTime() - b.startTime.getTime();
  });
  return slates;
}

// ── Player fetch — JSON then CSV ──────────────────────────────────────────────

async function fetchFDPlayersJSON(slateId: string): Promise<any[] | null> {
  try {
    const res = await fdFetchRetry(`https://api.fanduel.com/fixture-lists/${slateId}/players`);
    const data = await res.json();
    return data?.fixture_list_players ?? data?.players ?? null;
  } catch {
    return null;
  }
}

async function fetchFDPlayersCSV(slateId: string): Promise<string | null> {
  const urls = [
    `https://www.fanduel.com/lineup-builder/fixture-list/${slateId}/download`,
    `https://www.fanduel.com/contests/${slateId}/download-csv`,
  ];
  for (const url of urls) {
    try {
      const res = await fdFetchRetry(url, { Accept: "text/csv, */*" });
      const text = await res.text();
      if (text.trim().length > 50 && text.includes(",")) return text;
    } catch { /* try next */ }
  }
  return null;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { fields.push(cur.trim()); cur = ""; }
      else cur += c;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseFDCSV(csv: string, sport: FDSport): FDPlayerRow[] {
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const hdrs = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const col = (...names: string[]) => hdrs.findIndex(h => names.some(n => h.includes(n)));

  const nameIdx = col("nickname", "name");
  const salIdx  = col("salary");
  const posIdx  = col("position");
  const fppgIdx = col("fppg");
  const projIdx = col("projection", "projected");
  const gameIdx = col("game");
  const teamIdx = col("team");
  const injIdx  = col("injury");
  const idIdx   = col("id");

  if (nameIdx < 0 || salIdx < 0 || posIdx < 0) {
    console.error(`[FD Ingest] Unrecognized CSV headers: ${hdrs.join(", ")}`);
    return [];
  }

  const rows: FDPlayerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 4) continue;
    const name = cols[nameIdx]?.trim();
    if (!name) continue;
    const salary = parseInt((cols[salIdx] ?? "0").replace(/[$,]/g, "")) || 0;
    if (!salary) continue;
    const fppg = fppgIdx >= 0 ? parseFloat(cols[fppgIdx]) || 0 : 0;
    const projectedPoints = projIdx >= 0 ? parseFloat(cols[projIdx]) || fppg : fppg;
    const rawPos = posIdx >= 0 ? cols[posIdx]?.trim() : "";
    const position = normalizeFDPosition(rawPos, sport);
    const team = teamIdx >= 0 ? cols[teamIdx]?.trim() : "";
    const gameInfo = gameIdx >= 0 ? cols[gameIdx]?.trim() : "";
    const injuryRaw = injIdx >= 0 ? cols[injIdx]?.trim() : "";
    const injuryStatus = injuryRaw && !["","none","—","-"].includes(injuryRaw.toLowerCase()) ? injuryRaw : null;
    const fdId = idIdx >= 0 ? parseInt(cols[idIdx]) || null : null;

    let opponent = "";
    if (gameInfo && team) {
      const matchPart = gameInfo.split(" ")[0] ?? "";
      if (matchPart.includes("@")) {
        const [away, home] = matchPart.split("@");
        opponent = team.toUpperCase() === away?.toUpperCase() ? (home ?? "") : (away ?? "");
      }
    }

    rows.push({ name, position, team, opponent, gameInfo, salary, fppg, projectedPoints, injuryStatus, fanDuelPlayerId: fdId });
  }
  return rows;
}

function parseFDJSON(jsonPlayers: any[], sport: FDSport): FDPlayerRow[] {
  const rows: FDPlayerRow[] = [];
  for (const entry of jsonPlayers) {
    const p = entry.player ?? entry;
    const salary = entry.salary ?? entry.starting_salary ?? p.salary ?? 0;
    if (!salary) continue;
    const name = p.first_name && p.last_name
      ? `${p.first_name} ${p.last_name}`.trim()
      : (p.name ?? p.full_name ?? "");
    if (!name) continue;
    const rawPos = (p.position ?? p.positions?.[0] ?? "").toUpperCase();
    const position = normalizeFDPosition(rawPos, sport);
    const fppg = parseFloat(p.fppg ?? p.score ?? p.fantasy_points ?? "0") || 0;
    const injuryRaw = p.injury_status ?? p.injury_indicator ?? p.status ?? "";
    const injuryStatus = injuryRaw && !["","none","active","healthy"].includes(injuryRaw.toLowerCase()) ? injuryRaw : null;
    const team = p.team ?? p.team_abbreviation ?? "";
    const opponent = p.opponent ?? p.opponent_team_abbreviation ?? "";
    rows.push({
      name, position, team, opponent,
      gameInfo: p.game ?? p.game_info ?? `${team}@${opponent}`,
      salary, fppg, projectedPoints: fppg, injuryStatus,
      fanDuelPlayerId: p.id ?? p.fanduel_id ?? null,
    });
  }
  return rows;
}

// ── SportsData.io ─────────────────────────────────────────────────────────────

async function fetchSportsDataPlayers(sport: FDSport): Promise<FDPlayerRow[]> {
  const apiKey = process.env.SPORTSDATA_API_KEY;
  if (!apiKey) return [];

  const now = new Date();
  // SportsData.io date format: YYYY-MMM-DD  (e.g. 2024-JAN-15)
  const dateStr = `${now.getFullYear()}-${SD_MONTHS[now.getMonth()]}-${String(now.getDate()).padStart(2,"0")}`;
  const slug = SD_SPORT_SLUGS[sport];
  const url = `https://api.sportsdata.io/v3/${slug}/projections/json/DfsSlatesByDate/${dateStr}?key=${apiKey}`;

  let data: any;
  try {
    const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": apiKey } });
    if (!res.ok) { console.warn(`[FD/SportsData] ${res.status} for ${sport}`); return []; }
    data = await res.json();
  } catch (err: any) {
    console.error(`[FD/SportsData] Request error for ${sport}: ${err.message}`);
    return [];
  }

  const slates: any[] = Array.isArray(data) ? data : (data?.DfsSlates ?? []);

  // Pick FanDuel main or classic slate
  const fdSlate =
    slates.find(s => s.Operator === "FanDuel" && (s.OperatorSlateType === "Main" || s.OperatorSlateType === "Classic")) ??
    slates.find(s => s.Operator === "FanDuel");

  if (!fdSlate) {
    console.warn(`[FD/SportsData] No FanDuel slate for ${sport} on ${dateStr}`);
    return [];
  }

  const projections: any[] = fdSlate.DfsSlatePlayerProjections ?? fdSlate.Players ?? [];
  const rows: FDPlayerRow[] = [];

  for (const entry of projections) {
    const player = entry.PlayerProfile ?? entry.Player ?? entry;
    const name = player.Name ?? `${player.FirstName ?? ""} ${player.LastName ?? ""}`.trim();
    if (!name) continue;
    const salary = entry.Salary ?? 0;
    if (!salary) continue;

    const projectedPoints =
      entry.FantasyPointsFanDuel ?? entry.ProjectedPoints ?? entry.FantasyPointsDraftKings ?? 0;
    const fppg = entry.AverageFantasyPointsFanDuel ?? projectedPoints;
    const rawPos = player.Position ?? entry.Position ?? "";
    const injuryRaw = player.InjuryStatus ?? player.Status ?? "";

    rows.push({
      name,
      position: normalizeFDPosition(rawPos, sport),
      team: player.Team ?? player.TeamAbbreviation ?? "",
      opponent: player.Opponent ?? player.OpponentAbbreviation ?? "",
      gameInfo: player.GameInfo ?? player.GameChannel ?? "",
      salary,
      fppg,
      projectedPoints,
      injuryStatus: injuryRaw && !["","Active","Healthy"].includes(injuryRaw) ? injuryRaw : null,
      fanDuelPlayerId: player.FantasyDraftPlayerId ?? player.PlayerId ?? null,
    });
  }

  console.log(`[FD/SportsData] ${sport}: ${rows.length} players from "${fdSlate.OperatorSlate ?? "FanDuel slate"}"`);
  return rows;
}

// ── Main ingest ───────────────────────────────────────────────────────────────

export async function ingestFanDuelSlate(sport: FDSport): Promise<{
  success: boolean; slateId?: number; playerCount?: number; message: string; source?: string;
}> {
  console.log(`[FD Ingest] Starting ${sport}…`);

  const hasSportsData = !!process.env.SPORTSDATA_API_KEY;
  const hasFDAuth = !!(process.env.FD_SESSION_COOKIE || process.env.FD_AUTH_TOKEN);

  if (!hasSportsData && !hasFDAuth) {
    return { success: false, message: "Set SPORTSDATA_API_KEY or FD_SESSION_COOKIE to enable FanDuel ingestion." };
  }

  let playerRows: FDPlayerRow[] = [];
  let slateLabel = `${sport} FanDuel Main — ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`;
  let startTime = new Date();
  let salaryCap = FD_SALARY_CAPS[sport];
  let draftGroupId: number | null = null;
  let isMain = true;
  let source = "none";

  // 1 — SportsData.io
  if (hasSportsData) {
    playerRows = await fetchSportsDataPlayers(sport);
    if (playerRows.length > 0) source = "sportsdata.io";
  }

  // 2 — FD API (JSON → CSV)
  if (playerRows.length === 0 && hasFDAuth) {
    const slates = await fetchFDSlates(sport);
    if (slates.length > 0) {
      const main = slates.find(s => s.isMain) ?? slates[0];
      slateLabel = main.label;
      startTime = main.startTime;
      salaryCap = main.salaryCap;
      draftGroupId = main.draftGroupId;
      isMain = main.isMain;

      const json = await fetchFDPlayersJSON(main.id);
      if (json && json.length > 0) {
        playerRows = parseFDJSON(json, sport);
        source = "fd-api-json";
      }
      if (playerRows.length === 0) {
        const csv = await fetchFDPlayersCSV(main.id);
        if (csv) { playerRows = parseFDCSV(csv, sport); source = "fd-csv"; }
      }
    }
  }

  if (playerRows.length === 0) {
    return { success: false, message: `[FD/${sport}] No player data retrieved from any source.` };
  }

  // Slate upsert — match by sport + platform + today ET
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayET = `${nowET.getFullYear()}-${String(nowET.getMonth()+1).padStart(2,"0")}-${String(nowET.getDate()).padStart(2,"0")}`;

  const allSlates = await storage.getSlates();
  let slate = allSlates.find(s => {
    if (s.sport !== sport || s.platform !== "fanduel" || !s.isMain) return false;
    const sET = new Date(s.startTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return `${sET.getFullYear()}-${String(sET.getMonth()+1).padStart(2,"0")}-${String(sET.getDate()).padStart(2,"0")}` === todayET;
  });

  if (!slate) {
    slate = await storage.createSlate({ sport, platform: "fanduel", name: slateLabel, startTime, isMain, draftGroupId } satisfies InsertSlate);
    console.log(`[FD Ingest] Created FD ${sport} slate id=${slate.id}`);
  } else {
    console.log(`[FD Ingest] Refreshing FD ${sport} slate id=${slate.id}`);
  }

  const insertPlayers: InsertPlayer[] = playerRows
    .filter(p => p.salary > 0 && p.name.length > 1)
    .map(p => ({
      slateId: slate!.id, name: p.name, team: p.team, position: p.position,
      salary: p.salary, fppg: String(p.fppg), projectedPoints: String(p.projectedPoints),
      opponent: p.opponent || null, gameInfo: p.gameInfo || null,
      injuryStatus: p.injuryStatus, injuryDetail: null,
      boostScore: null, boostReason: null, draftKingsPlayerId: null, isConfirmedStarter: false,
    } satisfies InsertPlayer));

  if (insertPlayers.length === 0) {
    return { success: false, slateId: slate.id, message: `[FD/${sport}] Players all filtered (bad salary data?)` };
  }

  await storage.deletePlayersBySlate(slate.id);
  await storage.bulkCreatePlayers(insertPlayers);

  console.log(`[FD Ingest] ✓ ${sport}: ${insertPlayers.length} players (${source})`);
  return { success: true, slateId: slate.id, playerCount: insertPlayers.length, message: `Loaded ${insertPlayers.length} FanDuel ${sport} players via ${source}`, source };
}

export async function ingestAllFanDuelSlates(): Promise<Record<FDSport, { success: boolean; message: string; source?: string }>> {
  const results = {} as Record<FDSport, { success: boolean; message: string; source?: string }>;
  for (const sport of ["NBA","NFL","MLB","NHL","GOLF"] as FDSport[]) {
    try {
      const r = await ingestFanDuelSlate(sport);
      results[sport] = { success: r.success, message: r.message, source: r.source };
    } catch (err: any) {
      results[sport] = { success: false, message: err.message ?? "Unknown error" };
    }
  }
  return results;
}
