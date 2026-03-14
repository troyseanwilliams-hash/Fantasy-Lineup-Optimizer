// ============================================================
// server/yahoo-ingest.ts
//
// Fetches Yahoo DFS main slate data and upserts it into DB.
//
// DATA SOURCES (tried in priority order):
//
//   1. RotoWire API (ROTOWIRE_API_KEY env var)
//      Provides Yahoo DFS salaries + projections in structured JSON.
//      More reliable than scraping Yahoo directly.
//
//   2. Yahoo DFS Lobby API (no auth required for contest list)
//      Contest list:
//        GET https://dfyql-ro.sports.yahoo.com/v2/external/contracts/json
//             ?sport={slug}&status=open
//      Player pool:
//        GET https://dfyql-ro.sports.yahoo.com/v2/players
//             ?sport={slug}&contest_key={key}   ← was wrong param name before
//      Player positions come as an ARRAY, not a string.
//      FPPG field is "average_points" not "average_draft_position".
//
//   3. CSV upload (POST /api/admin/ingest/yahoo/:sport/csv)
//      Yahoo exports player CSVs from their contest page.
//
// ENV VARS:
//   ROTOWIRE_API_KEY    — RotoWire API key (preferred)
//   YAHOO_CLIENT_ID     — Yahoo OAuth app client ID
//   YAHOO_CLIENT_SECRET — Yahoo OAuth app client secret
//   YAHOO_ACCESS_TOKEN  — pre-obtained bearer token (simplest)
// ============================================================

import { storage } from "./storage";
import type { InsertSlate, InsertPlayer } from "@shared/schema";

export type YahooSport = "NBA" | "NFL" | "MLB" | "NHL" | "GOLF";

// ── Constants ─────────────────────────────────────────────────────────────────

// Yahoo DFS API uses lowercase sport slugs; GOLF uses "pga"
const YAHOO_SPORT_SLUGS: Record<YahooSport, string> = {
  NBA: "nba", NFL: "nfl", MLB: "mlb", NHL: "nhl", GOLF: "pga",
};

// RotoWire sport slugs
const RW_SPORT_SLUGS: Record<YahooSport, string> = {
  NBA: "nba", NFL: "nfl", MLB: "mlb", NHL: "nhl", GOLF: "golf",
};

// Yahoo's $200 salary cap
const YAHOO_SALARY_CAP = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

interface YahooContest {
  contestKey: string;       // Yahoo's contest identifier
  gameKey: string;          // Yahoo's game/slate key
  label: string;
  sport: YahooSport;
  startTime: Date;
  salaryCap: number;
  isMain: boolean;
}

interface YahooPlayerRow {
  name: string;
  position: string;         // normalized canonical position
  team: string;
  opponent: string;
  gameInfo: string;
  salary: number;           // in Yahoo units ($10–$60 scale)
  fppg: number;
  projectedPoints: number;
  injuryStatus: string | null;
  yahooPlayerId: string | null;
}

// ── Position normalization ────────────────────────────────────────────────────
// Yahoo positions come as arrays from the API (e.g. ["PG","SG"]).
// We take the first position and normalize to EliteLineup canonical.

function normalizeYahooPosition(positions: string | string[], sport: YahooSport): string {
  const raw = Array.isArray(positions) ? (positions[0] ?? "") : (positions ?? "");
  const p = raw.toUpperCase().trim();

  switch (sport) {
    case "NHL":
      // Yahoo NHL splits LW/RW — pass through unchanged, they match our config
      if (["LW","RW","C","D","G"].includes(p)) return p;
      if (p === "W") return "LW"; // generic W → LW
      return p;
    case "MLB":
      // Yahoo uses SP for starting pitchers
      if (p === "SP" || p === "P") return "SP";
      if (p === "RP") return "SP"; // treat relief pitchers as SP for Yahoo DFS
      return p;
    case "NFL":
      // Yahoo includes K (kicker) — already matches our config
      if (p === "DEF" || p === "D") return "DEF";
      return p;
    case "NBA":
      // PG, SG, SF, PF, C, G, F, UTIL — identical to DK structure
      return p;
    case "GOLF":
      return "G";
    default:
      return p;
  }
}

// ── OAuth token ───────────────────────────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getYahooToken(): Promise<string | null> {
  const staticToken = process.env.YAHOO_ACCESS_TOKEN;
  if (staticToken) return staticToken;

  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 300_000) {
    return _cachedToken.token;
  }

  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    });
    if (!res.ok) { console.error(`[Yahoo] Token request ${res.status}`); return null; }
    const d = await res.json();
    _cachedToken = { token: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
    return _cachedToken.token;
  } catch (err: any) {
    console.error("[Yahoo] OAuth error:", err.message);
    return null;
  }
}

async function yahooFetch(url: string, useAuth = false, timeoutMs = 15000): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; EliteLineup/1.0)",
    "Accept": "application/json",
  };
  if (useAuth) {
    const token = await getYahooToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res;
  } catch (err: any) {
    clearTimeout(t);
    if (err.name === "AbortError") throw new Error(`Timeout: ${url}`);
    throw err;
  }
}

// ── Contest discovery ─────────────────────────────────────────────────────────
//
// Yahoo DFS contest list endpoint (no auth required):
//   https://dfyql-ro.sports.yahoo.com/v2/external/contracts/json?sport={slug}&status=open
//
// Each contest has:
//   contest_key       — unique contest identifier (used to fetch players)
//   game_key          — Yahoo game key for this slate
//   name / title      — human-readable name
//   start_time        — Unix timestamp (seconds) or ISO string
//   salary_cap        — total salary cap (should be 200 for Yahoo DFS)
//   entry_fee         — 0 for free contests, >0 for paid
//   contest_type_name — "Classic", "Single Game", etc.

async function fetchYahooContests(sport: YahooSport): Promise<YahooContest[]> {
  const slug = YAHOO_SPORT_SLUGS[sport];
  const url = `https://dfyql-ro.sports.yahoo.com/v2/external/contracts/json?sport=${slug}&status=open`;

  let data: any;
  try {
    const res = await yahooFetch(url, false);
    data = await res.json();
  } catch (err: any) {
    console.error(`[Yahoo Ingest] Contest fetch failed for ${sport}: ${err.message}`);
    return [];
  }

  // Response shape: { contracts: [...] } or { result: { contracts: [...] } }
  const contractList: any[] = data?.contracts ?? data?.result?.contracts ?? data?.data ?? [];

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStart = new Date(nowET); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(nowET); todayEnd.setHours(23,59,59,999);

  const contests: YahooContest[] = [];

  for (const c of contractList) {
    // start_time may be Unix seconds or ISO string
    const rawStart = c.start_time ?? c.startTime ?? c.draft_start ?? c.lock_time;
    if (!rawStart) continue;

    const startTime = typeof rawStart === "number"
      ? new Date(rawStart * 1000)     // Unix seconds
      : new Date(rawStart);           // ISO string

    const startET = new Date(startTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
    if (startET < todayStart || startET > todayEnd) continue;

    const label = c.name ?? c.title ?? c.contest_name ?? `${sport} Yahoo ${startET.toLocaleDateString()}`;
    const contestTypeName = (c.contest_type_name ?? c.type ?? "").toLowerCase();

    // Main slate: Classic contest type OR largest salary cap OR explicitly labeled "main"
    const isMain =
      contestTypeName.includes("classic") ||
      contestTypeName.includes("main") ||
      label.toLowerCase().includes("main") ||
      c.is_primary === true ||
      c.featured === true;

    contests.push({
      contestKey: String(c.contest_key ?? c.id ?? c.contract_id ?? ""),
      gameKey: String(c.game_key ?? c.game_id ?? ""),
      label,
      sport,
      startTime,
      salaryCap: c.salary_cap ?? YAHOO_SALARY_CAP,
      isMain,
    });
  }

  // Main contests first, then earliest start
  contests.sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    return a.startTime.getTime() - b.startTime.getTime();
  });

  return contests;
}

// ── Player pool fetch ─────────────────────────────────────────────────────────
//
// Yahoo DFS player endpoint (no auth required for salary/FPPG data):
//   https://dfyql-ro.sports.yahoo.com/v2/players?sport={slug}&contest_key={key}
//
// Key fields in each player object:
//   full_name / first_name + last_name
//   eligible_positions    — ARRAY of strings e.g. ["PG", "SG"]  ← was wrong before
//   editorial_team_abbr   — team abbreviation
//   salary / dfs_salary   — player salary
//   average_points        — FPPG (was incorrectly using average_draft_position before)
//   status / injury_status — injury flag
//   player_id             — Yahoo player ID string

async function fetchYahooPlayers(contest: YahooContest): Promise<YahooPlayerRow[]> {
  const slug = YAHOO_SPORT_SLUGS[contest.sport];

  // Primary: use contest_key param (correct parameter name)
  const primaryUrl = `https://dfyql-ro.sports.yahoo.com/v2/players?sport=${slug}&contest_key=${contest.contestKey}`;

  let data: any;
  let usedAuth = false;

  try {
    const res = await yahooFetch(primaryUrl, false);
    data = await res.json();
  } catch (err: any) {
    console.warn(`[Yahoo Ingest] Unauthenticated player fetch failed: ${err.message}, trying auth…`);
    try {
      const res = await yahooFetch(primaryUrl, true);
      data = await res.json();
      usedAuth = true;
    } catch (err2: any) {
      console.error(`[Yahoo Ingest] Auth player fetch also failed: ${err2.message}`);
      return [];
    }
  }

  // Response shape variants Yahoo has used:
  //   { players: [...] }
  //   { result: { players: [...] } }
  //   { data: { players: [...] } }
  //   Array of players directly
  const playerList: any[] =
    data?.players ??
    data?.result?.players ??
    data?.data?.players ??
    (Array.isArray(data) ? data : []);

  if (playerList.length === 0) {
    console.warn(`[Yahoo Ingest] No players in response for contest ${contest.contestKey}${usedAuth ? " (with auth)" : ""}`);
    return [];
  }

  return parseYahooAPIPlayers(playerList, contest.sport);
}

function parseYahooAPIPlayers(players: any[], sport: YahooSport): YahooPlayerRow[] {
  const rows: YahooPlayerRow[] = [];

  for (const p of players) {
    // Name
    const name = p.full_name
      ?? (p.first_name && p.last_name ? `${p.first_name} ${p.last_name}`.trim() : null)
      ?? p.name
      ?? "";
    if (!name || name.trim().length < 2) continue;

    // Position — Yahoo returns an ARRAY, not a single string
    const eligiblePositions: string[] = p.eligible_positions ?? p.positions ?? [];
    const position = normalizeYahooPosition(
      eligiblePositions.length > 0 ? eligiblePositions : (p.position ?? p.primary_position ?? ""),
      sport
    );
    if (!position) continue;

    // Salary
    const salary = parseInt(
      String(p.salary ?? p.dfs_salary ?? p.contract_salary ?? "0").replace(/[$,]/g, "")
    ) || 0;
    if (!salary) continue;

    // FPPG — Yahoo's field is "average_points", NOT "average_draft_position"
    // "average_draft_position" is ADP (season-long fantasy), completely unrelated to scoring
    const fppg =
      parseFloat(p.average_points ?? p.fppg ?? p.average_fantasy_points ?? p.points_per_game ?? "0") || 0;

    // Team and opponent
    const team = p.editorial_team_abbr ?? p.team_abbr ?? p.team ?? "";
    const opponent = p.opponent_abbr ?? p.opponent ?? "";

    // Game info — reconstruct if not provided
    const gameInfo = p.game ?? p.game_info ?? p.matchup ?? (team && opponent ? `${team} vs ${opponent}` : "");

    // Injury status
    const injuryRaw = p.status ?? p.injury_status ?? p.injury_note ?? "";
    const injuryStatus =
      injuryRaw && !["", "Active", "Healthy", "DTD"].includes(injuryRaw)
        ? injuryRaw : null;
    // "DTD" (Day-to-Day) on Yahoo maps to "Questionable"
    const normalizedInjury = injuryRaw === "DTD" ? "Questionable" : injuryStatus;

    rows.push({
      name: name.trim(),
      position,
      team,
      opponent,
      gameInfo,
      salary,
      fppg,
      projectedPoints: fppg, // Yahoo doesn't publish projections; FPPG is the proxy
      injuryStatus: normalizedInjury,
      yahooPlayerId: String(p.player_id ?? p.id ?? ""),
    });
  }

  return rows;
}

// ── RotoWire fallback ─────────────────────────────────────────────────────────
//
// RotoWire provides Yahoo DFS salaries and projections via their API.
// Endpoint: https://api.rotowire.com/dfs/yahoo/projections.php
//   Params: sport={slug}&type=main
//   Auth: ?key={ROTOWIRE_API_KEY}

async function fetchRotoWirePlayers(sport: YahooSport): Promise<YahooPlayerRow[]> {
  const apiKey = process.env.ROTOWIRE_API_KEY;
  if (!apiKey) return [];

  const slug = RW_SPORT_SLUGS[sport];
  const url = `https://api.rotowire.com/dfs/yahoo/projections.php?sport=${slug}&type=main&key=${apiKey}`;

  let data: any;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "EliteLineup/1.0", Accept: "application/json" },
    });
    if (!res.ok) { console.warn(`[Yahoo/RotoWire] ${res.status} for ${sport}`); return []; }
    data = await res.json();
  } catch (err: any) {
    console.error(`[Yahoo/RotoWire] Request error for ${sport}: ${err.message}`);
    return [];
  }

  const players: any[] = data?.players ?? data ?? [];
  const rows: YahooPlayerRow[] = [];

  for (const p of players) {
    const name = p.player ?? p.name ?? p.full_name ?? "";
    if (!name) continue;
    const salary = parseInt(String(p.salary ?? "0").replace(/[$,]/g, "")) || 0;
    if (!salary) continue;
    const rawPos = p.position ?? p.pos ?? "";
    const position = normalizeYahooPosition(rawPos, sport);
    const fppg = parseFloat(p.proj_pts ?? p.fppg ?? p.points ?? "0") || 0;
    const injuryRaw = p.injury_status ?? p.status ?? "";
    rows.push({
      name: name.trim(),
      position,
      team: p.team ?? p.team_abbr ?? "",
      opponent: p.opponent ?? p.opp ?? "",
      gameInfo: p.game ?? `${p.team ?? ""} vs ${p.opponent ?? ""}`,
      salary,
      fppg,
      projectedPoints: fppg,
      injuryStatus: injuryRaw && !["","Active","Healthy"].includes(injuryRaw) ? injuryRaw : null,
      yahooPlayerId: String(p.player_id ?? p.yahoo_id ?? ""),
    });
  }

  console.log(`[Yahoo/RotoWire] ${sport}: ${rows.length} players`);
  return rows;
}

// ── CSV parser (for manual uploads via admin route) ───────────────────────────
// Yahoo CSV format: Name,ID,Position,Team,Opponent,Game,Salary,FPPG,...

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

export function parseYahooCSV(csvText: string, sport: YahooSport): YahooPlayerRow[] {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const hdrs = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/"/g, "").trim());
  const col = (...names: string[]) => hdrs.findIndex(h => names.some(n => h.includes(n)));

  const nameIdx  = col("name", "player");
  const idIdx    = col("id", "player id", "yahoo id");
  const posIdx   = col("position", "pos");
  const teamIdx  = col("team");
  const oppIdx   = col("opponent", "opp");
  const gameIdx  = col("game");
  const salIdx   = col("salary", "sal");
  const fppgIdx  = col("fppg", "avg", "points");
  const injIdx   = col("injury", "status");

  if (nameIdx < 0 || salIdx < 0) {
    console.error("[Yahoo CSV] Missing Name or Salary column");
    return [];
  }

  const rows: YahooPlayerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const name = cols[nameIdx]?.trim();
    if (!name) continue;
    const salary = parseInt((cols[salIdx] ?? "0").replace(/[$,]/g, "")) || 0;
    if (!salary) continue;
    const rawPos = posIdx >= 0 ? cols[posIdx]?.trim() : "";
    const position = normalizeYahooPosition(rawPos, sport);
    const fppg = fppgIdx >= 0 ? parseFloat(cols[fppgIdx]) || 0 : 0;
    const injuryRaw = injIdx >= 0 ? cols[injIdx]?.trim() : "";
    const injuryStatus = injuryRaw && !["","healthy","active"].includes(injuryRaw.toLowerCase()) ? injuryRaw : null;
    rows.push({
      name,
      position,
      team: teamIdx >= 0 ? cols[teamIdx]?.trim() : "",
      opponent: oppIdx >= 0 ? cols[oppIdx]?.trim() : "",
      gameInfo: gameIdx >= 0 ? cols[gameIdx]?.trim() : "",
      salary,
      fppg,
      projectedPoints: fppg,
      injuryStatus,
      yahooPlayerId: idIdx >= 0 ? cols[idIdx]?.trim() || null : null,
    });
  }
  return rows;
}

// ── Shared slate upsert helper ────────────────────────────────────────────────

async function upsertYahooSlate(sport: YahooSport, label: string, startTime: Date): Promise<Awaited<ReturnType<typeof storage.createSlate>>> {
  const allSlates = await storage.getSlates();
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayET = `${nowET.getFullYear()}-${String(nowET.getMonth()+1).padStart(2,"0")}-${String(nowET.getDate()).padStart(2,"0")}`;

  const existing = allSlates.find(s => {
    if (s.sport !== sport || s.platform !== "yahoo" || !s.isMain) return false;
    const sET = new Date(s.startTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return `${sET.getFullYear()}-${String(sET.getMonth()+1).padStart(2,"0")}-${String(sET.getDate()).padStart(2,"0")}` === todayET;
  });

  if (existing) {
    console.log(`[Yahoo Ingest] Refreshing ${sport} Yahoo slate id=${existing.id}`);
    return existing;
  }

  const created = await storage.createSlate({
    sport, platform: "yahoo", name: label, startTime, isMain: true, draftGroupId: null,
  } satisfies InsertSlate);
  console.log(`[Yahoo Ingest] Created ${sport} Yahoo slate id=${created.id}`);
  return created;
}

function buildInsertPlayers(rows: YahooPlayerRow[], slateId: number): InsertPlayer[] {
  return rows
    .filter(p => p.salary > 0 && p.name.length > 1)
    .map(p => ({
      slateId,
      name: p.name,
      team: p.team,
      position: p.position,
      salary: p.salary,
      fppg: String(p.fppg),
      projectedPoints: String(p.projectedPoints),
      opponent: p.opponent || null,
      gameInfo: p.gameInfo || null,
      injuryStatus: p.injuryStatus,
      injuryDetail: null,
      boostScore: null,
      boostReason: null,
      draftKingsPlayerId: null,
      isConfirmedStarter: false,
    } satisfies InsertPlayer));
}

// ── Main ingest ───────────────────────────────────────────────────────────────

export async function ingestYahooSlate(sport: YahooSport): Promise<{
  success: boolean; slateId?: number; playerCount?: number; message: string; source?: string;
}> {
  console.log(`[Yahoo Ingest] Starting ${sport}…`);

  let playerRows: YahooPlayerRow[] = [];
  let slateLabel = `${sport} Yahoo Main — ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`;
  let startTime = new Date();
  let source = "none";

  // 1 — RotoWire (if key available)
  if (process.env.ROTOWIRE_API_KEY) {
    playerRows = await fetchRotoWirePlayers(sport);
    if (playerRows.length > 0) source = "rotowire";
  }

  // 2 — Yahoo DFS API
  if (playerRows.length === 0) {
    const contests = await fetchYahooContests(sport);
    if (contests.length === 0) {
      return { success: false, message: `[Yahoo/${sport}] No open contests found for today.` };
    }

    const mainContest = contests.find(c => c.isMain) ?? contests[0];
    slateLabel = mainContest.label;
    startTime = mainContest.startTime;

    console.log(`[Yahoo Ingest] ${sport}: using contest "${mainContest.label}" (key=${mainContest.contestKey})`);

    playerRows = await fetchYahooPlayers(mainContest);
    if (playerRows.length > 0) source = "yahoo-api";
  }

  if (playerRows.length === 0) {
    return {
      success: false,
      message: `[Yahoo/${sport}] No player data retrieved. Set ROTOWIRE_API_KEY or check Yahoo API access.`,
    };
  }

  const slate = await upsertYahooSlate(sport, slateLabel, startTime);
  const insertPlayers = buildInsertPlayers(playerRows, slate.id);

  if (insertPlayers.length === 0) {
    return { success: false, slateId: slate.id, message: `[Yahoo/${sport}] All players filtered (no valid salary data)` };
  }

  await storage.deletePlayersBySlate(slate.id);
  await storage.bulkCreatePlayers(insertPlayers);

  console.log(`[Yahoo Ingest] ✓ ${sport}: ${insertPlayers.length} players (${source})`);
  return {
    success: true, slateId: slate.id, playerCount: insertPlayers.length,
    message: `Loaded ${insertPlayers.length} Yahoo ${sport} players via ${source}`, source,
  };
}

// ── CSV import (called from admin upload route) ───────────────────────────────

export async function ingestYahooCSV(csvText: string, sport: YahooSport): Promise<{
  success: boolean; slateId?: number; playerCount?: number; message: string;
}> {
  const playerRows = parseYahooCSV(csvText, sport);
  if (playerRows.length === 0) {
    return { success: false, message: "CSV parse returned no valid players. Check column names." };
  }

  const label = `${sport} Yahoo — ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`;
  const slate = await upsertYahooSlate(sport, label, new Date());
  const insertPlayers = buildInsertPlayers(playerRows, slate.id);

  await storage.deletePlayersBySlate(slate.id);
  await storage.bulkCreatePlayers(insertPlayers);

  return {
    success: true, slateId: slate.id, playerCount: insertPlayers.length,
    message: `CSV imported ${insertPlayers.length} Yahoo ${sport} players`,
  };
}

// ── Ingest all sports ─────────────────────────────────────────────────────────

export async function ingestAllYahooSlates(): Promise<Record<YahooSport, { success: boolean; message: string; source?: string }>> {
  const results = {} as Record<YahooSport, { success: boolean; message: string; source?: string }>;
  for (const sport of ["NBA","NFL","MLB","NHL","GOLF"] as YahooSport[]) {
    try {
      const r = await ingestYahooSlate(sport);
      results[sport] = { success: r.success, message: r.message, source: r.source };
    } catch (err: any) {
      results[sport] = { success: false, message: err.message ?? "Unknown error" };
    }
  }
  return results;
}
