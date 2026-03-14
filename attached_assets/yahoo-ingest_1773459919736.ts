// ============================================================
// server/yahoo-ingest.ts
//
// Fetches Yahoo DFS slates and player pools for NBA, NFL,
// MLB, NHL, and GOLF and upserts them into the local database.
//
// HOW YAHOO DFS DATA WORKS:
//   Yahoo DFS exposes data through two channels:
//
//   1. PRIMARY — Yahoo DFS readonly JSON API (no auth for contest list)
//      Contest discovery:
//        GET https://dfyql-ro.sports.yahoo.com/v2/external/contracts/json
//             ?sport={sport}&status=open&type=standard
//      Player pool per contest:
//        GET https://dfyql-ro.sports.yahoo.com/v2/players
//             ?sport={sport}&contractId={contractId}
//      These endpoints are unauthenticated and return JSON.
//      They are the same endpoints Yahoo's own DFS lobby uses.
//
//   2. FALLBACK — Yahoo Fantasy Sports OAuth API
//      Full DFS data including salaries requires an OAuth 2.0
//      token from developer.yahoo.com. Use this when the
//      readonly endpoint doesn't include salary data.
//        Token endpoint: https://api.login.yahoo.com/oauth2/get_token
//        Players: https://fantasysports.yahooapis.com/fantasy/v2/
//                 league/{league_key}/players;player_keys={keys}/stats
//
//   3. CSV IMPORT FALLBACK
//      Yahoo provides a player export from their contest page.
//      We accept that CSV through POST /api/ingest/yahoo/csv
//
// SETUP:
//   Env vars (at least one of these pairs):
//     YAHOO_CLIENT_ID + YAHOO_CLIENT_SECRET   — OAuth 2.0 from developer.yahoo.com
//     YAHOO_ACCESS_TOKEN                       — pre-obtained OAuth token (simpler)
//   The readonly contest endpoint works without any auth.
//
// POSITION MAPPING:
//   Yahoo positions differ from DK on some sports:
//     NHL: uses LW/RW (unlike DK's generic W)
//     MLB: uses SP (like our config — already normalized)
//     NFL: uses K  (kicker — unique to Yahoo)
//   We map Yahoo API positions to EliteLineup canonical.
// ============================================================

import { storage } from "./storage";
import type { InsertSlate, InsertPlayer } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export type YahooSport = "NBA" | "NFL" | "MLB" | "NHL" | "GOLF";

interface YahooContest {
  contractId: string;
  label: string;
  sport: YahooSport;
  startTime: Date;
  salaryCap: number;
  isMain: boolean;
}

interface YahooPlayerRow {
  name: string;
  position: string;
  team: string;
  opponent: string;
  gameInfo: string;
  salary: number;
  fppg: number;
  projectedPoints: number;
  injuryStatus: string | null;
  yahooPlayerId: string | null;
}

// ── Sport slug mapping ────────────────────────────────────────────────────────

const YAHOO_SPORT_SLUGS: Record<YahooSport, string> = {
  NBA: "nba",
  NFL: "nfl",
  MLB: "mlb",
  NHL: "nhl",
  GOLF: "pga",
};

// ── Position normalization (Yahoo API → EliteLineup canonical) ────────────────

function normalizeYahooPosition(pos: string, sport: YahooSport): string {
  const p = pos?.toUpperCase().trim();
  switch (sport) {
    case "NHL":
      // Yahoo uses LW and RW natively — these match our config exactly
      if (p === "LW" || p === "RW" || p === "C" || p === "D" || p === "G") return p;
      if (p === "W") return "LW"; // generic W → LW as default
      return p;
    case "MLB":
      // Yahoo uses SP — already matches our config
      if (p === "SP" || p === "RP") return "SP";
      if (p === "P") return "SP";
      return p;
    case "NFL":
      // Yahoo includes K (kicker) — matches our config
      if (p === "DEF" || p === "D") return "DEF";
      return p; // QB, WR, RB, TE, K all pass through unchanged
    case "NBA":
      // Yahoo NBA: PG, SG, SF, PF, C, G, F, UTIL — identical to DK structure
      return p;
    case "GOLF":
      return "G";
    default:
      return p;
  }
}

// ── OAuth token management ────────────────────────────────────────────────────

let cachedYahooToken: { token: string; expiresAt: number } | null = null;

async function getYahooAccessToken(): Promise<string | null> {
  // Use pre-obtained token if available
  const staticToken = process.env.YAHOO_ACCESS_TOKEN;
  if (staticToken) return staticToken;

  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Return cached token if still valid (with 5-minute buffer)
  if (cachedYahooToken && cachedYahooToken.expiresAt > Date.now() + 300_000) {
    return cachedYahooToken.token;
  }

  // Client credentials grant (works for app-level access, not user-specific)
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  try {
    const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }).toString(),
    });

    if (!res.ok) {
      console.error(`[Yahoo Ingest] Token request failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const token = data.access_token;
    const expiresIn = (data.expires_in || 3600) * 1000;

    cachedYahooToken = { token, expiresAt: Date.now() + expiresIn };
    return token;
  } catch (err: any) {
    console.error("[Yahoo Ingest] OAuth error:", err.message);
    return null;
  }
}

async function yahooFetch(url: string, requiresAuth = false): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; EliteLineup/1.0)",
    "Accept": "application/json",
  };

  if (requiresAuth) {
    const token = await getYahooAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Yahoo fetch ${res.status} ${res.statusText} — ${url}`);
  }
  return res;
}

// ── Contest discovery ─────────────────────────────────────────────────────────

async function fetchYahooContests(sport: YahooSport): Promise<YahooContest[]> {
  const slug = YAHOO_SPORT_SLUGS[sport];
  // Yahoo DFS readonly contest list — no auth required
  const url = `https://dfyql-ro.sports.yahoo.com/v2/external/contracts/json?sport=${slug}&status=open&type=standard`;

  let data: any;
  try {
    const res = await yahooFetch(url, false);
    data = await res.json();
  } catch (err: any) {
    console.error(`[Yahoo Ingest] Contest fetch failed for ${sport}:`, err.message);
    return [];
  }

  const contests: YahooContest[] = [];
  const contractList = data?.contracts || data?.result?.contracts || [];

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));

  for (const contract of contractList) {
    const startRaw = contract.start_time || contract.startTime || contract.draft_start;
    if (!startRaw) continue;

    const startTime = new Date(startRaw);
    const startET = new Date(startTime.toLocaleString("en-US", { timeZone: "America/New_York" }));

    // Only today's contests
    if (
      startET.getFullYear() !== nowET.getFullYear() ||
      startET.getMonth() !== nowET.getMonth() ||
      startET.getDate() !== nowET.getDate()
    ) {
      continue;
    }

    const label = contract.name || contract.title || `${sport} ${startTime.toLocaleDateString()}`;
    const isMain = label.toLowerCase().includes("main") ||
                   contract.featured === true ||
                   contract.is_primary === true;

    contests.push({
      contractId: String(contract.contract_id || contract.id),
      label,
      sport,
      startTime,
      salaryCap: contract.salary_cap || 200,
      isMain,
    });
  }

  return contests;
}

// ── Player pool fetch ─────────────────────────────────────────────────────────

async function fetchYahooPlayers(contractId: string, sport: YahooSport): Promise<YahooPlayerRow[]> {
  const slug = YAHOO_SPORT_SLUGS[sport];
  // Yahoo DFS player endpoint — returns salary + FPPG per contest
  const url = `https://dfyql-ro.sports.yahoo.com/v2/players?sport=${slug}&contractId=${contractId}`;

  let data: any;
  try {
    const res = await yahooFetch(url, false);
    data = await res.json();
  } catch (err: any) {
    console.error(`[Yahoo Ingest] Player fetch failed for contest ${contractId}:`, err.message);
    return [];
  }

  // Try authenticated endpoint if the base returns empty or an error
  const players = data?.players || data?.result?.players || [];
  if (players.length === 0) {
    console.warn(`[Yahoo Ingest] No players from unauthenticated endpoint for ${contractId}, trying auth…`);
    try {
      const authUrl = `https://fantasysports.yahooapis.com/fantasy/v2/dfs/players?contractId=${contractId}&format=json`;
      const res = await yahooFetch(authUrl, true);
      const authData = await res.json();
      const authPlayers = authData?.fantasy_content?.players || [];
      if (authPlayers.length > 0) {
        return parseYahooPlayersFromFantasyAPI(authPlayers, sport);
      }
    } catch (err: any) {
      console.error("[Yahoo Ingest] Auth fallback also failed:", err.message);
    }
    return [];
  }

  return parseYahooPlayersFromDFSAPI(players, sport);
}

function parseYahooPlayersFromDFSAPI(players: any[], sport: YahooSport): YahooPlayerRow[] {
  const rows: YahooPlayerRow[] = [];

  for (const p of players) {
    const name = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
    if (!name) continue;

    const rawPos = p.editorial_team_abbreviation
      ? p.eligible_positions?.[0] || p.position || ""
      : p.position || p.eligible_positions?.[0] || "";

    const position = normalizeYahooPosition(rawPos, sport);
    const salary = parseInt(String(p.salary || p.dfs_salary || "0").replace(/[$,]/g, "")) || 0;
    if (salary === 0) continue;

    const fppg = parseFloat(String(p.average_draft_position || p.fppg || p.stats?.fantasy_points || "0")) || 0;
    const opponent = p.opponent || p.opponent_abbr || "";
    const gameInfo = p.game || p.game_note || `${p.team || ""} vs ${opponent}`;
    const injuryRaw = p.status || p.injury_status || "";
    const injuryStatus = injuryRaw && !["healthy", "active", ""].includes(injuryRaw.toLowerCase())
      ? injuryRaw : null;

    rows.push({
      name,
      position,
      team: p.editorial_team_abbr || p.team || "",
      opponent,
      gameInfo,
      salary,
      fppg,
      projectedPoints: fppg, // Yahoo doesn't publish projections; FPPG is the best proxy
      injuryStatus,
      yahooPlayerId: String(p.player_id || p.id || ""),
    });
  }

  return rows;
}

function parseYahooPlayersFromFantasyAPI(players: any[], sport: YahooSport): YahooPlayerRow[] {
  const rows: YahooPlayerRow[] = [];

  for (const entry of players) {
    const p = entry?.player?.[0]?.player_info || entry;
    if (!p) continue;

    const name = p.full_name || p.name?.full || "";
    if (!name) continue;

    const rawPos = p.primary_position || p.position || "";
    const position = normalizeYahooPosition(rawPos, sport);
    const salary = parseInt(String(p.dfs_salary || "0").replace(/[$,]/g, "")) || 0;
    if (salary === 0) continue;

    rows.push({
      name,
      position,
      team: p.editorial_team_abbr || "",
      opponent: "",
      gameInfo: "",
      salary,
      fppg: parseFloat(p.average_draft_position || "0") || 0,
      projectedPoints: parseFloat(p.average_draft_position || "0") || 0,
      injuryStatus: p.status && p.status !== "Active" ? p.status : null,
      yahooPlayerId: String(p.player_id || ""),
    });
  }

  return rows;
}

// ── CSV import parser (for manual/fallback uploads) ───────────────────────────
// Yahoo CSV format: Name,ID,Position,Team,Opponent,Game,Salary,FPPG,...

export function parseYahooCSV(csvText: string, sport: YahooSport): YahooPlayerRow[] {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""));
  const nameIdx     = headers.findIndex(h => h === "name" || h === "player");
  const idIdx       = headers.findIndex(h => h === "id" || h === "player id");
  const posIdx      = headers.findIndex(h => h === "position" || h === "pos");
  const teamIdx     = headers.findIndex(h => h === "team");
  const opponentIdx = headers.findIndex(h => h === "opponent" || h === "opp");
  const gameIdx     = headers.findIndex(h => h === "game");
  const salaryIdx   = headers.findIndex(h => h === "salary" || h === "sal");
  const fppgIdx     = headers.findIndex(h => h === "fppg" || h === "avg");
  const injuryIdx   = headers.findIndex(h => h.includes("injury") || h === "status");

  if (nameIdx < 0 || salaryIdx < 0) {
    console.error("[Yahoo CSV] Cannot parse: missing Name or Salary column");
    return [];
  }

  const rows: YahooPlayerRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/"/g, ""));
    const name = cols[nameIdx]?.trim();
    if (!name) continue;

    const salaryRaw = cols[salaryIdx]?.replace(/[$,]/g, "") || "0";
    const salary = parseInt(salaryRaw) || 0;
    if (salary === 0) continue;

    const rawPos = posIdx >= 0 ? cols[posIdx]?.trim() : "";
    const position = normalizeYahooPosition(rawPos || "", sport);
    const fppg = fppgIdx >= 0 ? parseFloat(cols[fppgIdx]) || 0 : 0;
    const opponent = opponentIdx >= 0 ? cols[opponentIdx]?.trim() : "";
    const gameInfo = gameIdx >= 0 ? cols[gameIdx]?.trim() : "";
    const injuryRaw = injuryIdx >= 0 ? cols[injuryIdx]?.trim() : "";
    const injuryStatus = injuryRaw && !["", "healthy", "active"].includes(injuryRaw.toLowerCase())
      ? injuryRaw : null;

    rows.push({
      name,
      position,
      team: teamIdx >= 0 ? cols[teamIdx]?.trim() : "",
      opponent: opponent || "",
      gameInfo: gameInfo || "",
      salary,
      fppg,
      projectedPoints: fppg,
      injuryStatus,
      yahooPlayerId: idIdx >= 0 ? cols[idIdx]?.trim() || null : null,
    });
  }

  return rows;
}

// ── Main ingestion function ───────────────────────────────────────────────────

export async function ingestYahooSlate(sport: YahooSport): Promise<{
  success: boolean;
  slateId?: number;
  playerCount?: number;
  message: string;
}> {
  console.log(`[Yahoo Ingest] Starting ingestion for ${sport}…`);

  // ── Step 1: Discover today's contests
  const contests = await fetchYahooContests(sport);
  if (contests.length === 0) {
    return {
      success: false,
      message: `[Yahoo/${sport}] No open contests found for today. Check YAHOO_CLIENT_ID/SECRET or try CSV import.`,
    };
  }

  const mainContest = contests.find(c => c.isMain) || contests[0];
  console.log(`[Yahoo Ingest] Using contest: "${mainContest.label}" (id=${mainContest.contractId})`);

  // ── Step 2: Fetch players
  const playerRows = await fetchYahooPlayers(mainContest.contractId, sport);
  if (playerRows.length === 0) {
    return {
      success: false,
      message: `[Yahoo/${sport}] No players returned for contest ${mainContest.contractId}`,
    };
  }

  // ── Step 3: Upsert slate
  const existingSlates = await storage.getSlates();
  const todayStr = new Date().toISOString().split("T")[0];

  let slate = existingSlates.find(s =>
    s.sport === sport &&
    s.platform === "yahoo" &&
    s.startTime.toISOString().startsWith(todayStr)
  );

  if (!slate) {
    const inserted = await storage.createSlate({
      sport,
      platform: "yahoo",
      name: mainContest.label,
      startTime: mainContest.startTime,
      isMain: mainContest.isMain,
      draftGroupId: null,
    } satisfies InsertSlate);
    slate = inserted;
    console.log(`[Yahoo Ingest] Created new ${sport} Yahoo slate id=${slate.id}`);
  } else {
    console.log(`[Yahoo Ingest] Reusing existing ${sport} Yahoo slate id=${slate.id}`);
  }

  // ── Step 4: Upsert players
  const insertPlayers: InsertPlayer[] = playerRows
    .filter(p => p.salary > 0 && p.name.length > 1)
    .map(p => ({
      slateId: slate!.id,
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

  if (insertPlayers.length === 0) {
    return { success: false, slateId: slate.id, message: `[Yahoo/${sport}] No valid players to insert` };
  }

  await storage.deletePlayersBySlate(slate.id);
  await storage.bulkCreatePlayers(insertPlayers);

  console.log(`[Yahoo Ingest] Upserted ${insertPlayers.length} players for ${sport} Yahoo slate ${slate.id}`);

  return {
    success: true,
    slateId: slate.id,
    playerCount: insertPlayers.length,
    message: `Ingested ${insertPlayers.length} Yahoo players for ${sport}`,
  };
}

// ── CSV import path (called from admin route for manual uploads) ───────────────

export async function ingestYahooCSV(csvText: string, sport: YahooSport): Promise<{
  success: boolean;
  slateId?: number;
  playerCount?: number;
  message: string;
}> {
  const playerRows = parseYahooCSV(csvText, sport);
  if (playerRows.length === 0) {
    return { success: false, message: "CSV parse returned no valid players" };
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const existingSlates = await storage.getSlates();

  let slate = existingSlates.find(s =>
    s.sport === sport &&
    s.platform === "yahoo" &&
    s.startTime.toISOString().startsWith(todayStr)
  );

  if (!slate) {
    const inserted = await storage.createSlate({
      sport,
      platform: "yahoo",
      name: `${sport} Yahoo — ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`,
      startTime: new Date(),
      isMain: true,
      draftGroupId: null,
    } satisfies InsertSlate);
    slate = inserted;
  }

  const insertPlayers: InsertPlayer[] = playerRows
    .filter(p => p.salary > 0 && p.name.length > 1)
    .map(p => ({
      slateId: slate!.id,
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

  await storage.deletePlayersBySlate(slate.id);
  await storage.bulkCreatePlayers(insertPlayers);

  return {
    success: true,
    slateId: slate.id,
    playerCount: insertPlayers.length,
    message: `CSV imported ${insertPlayers.length} Yahoo ${sport} players`,
  };
}

// ── Ingest all sports ─────────────────────────────────────────────────────────

export async function ingestAllYahooSlates(): Promise<Record<YahooSport, { success: boolean; message: string }>> {
  const sports: YahooSport[] = ["NBA", "NFL", "MLB", "NHL", "GOLF"];
  const results = {} as Record<YahooSport, { success: boolean; message: string }>;

  for (const sport of sports) {
    try {
      const r = await ingestYahooSlate(sport);
      results[sport] = { success: r.success, message: r.message };
    } catch (err: any) {
      results[sport] = { success: false, message: err.message || "Unknown error" };
    }
  }

  return results;
}
