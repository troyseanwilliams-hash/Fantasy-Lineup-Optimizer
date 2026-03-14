// ============================================================
// server/fanduel-ingest.ts
//
// Fetches FanDuel DFS slates and player pools for NBA, NFL,
// MLB, NHL, and GOLF and upserts them into the local database.
//
// HOW FANDUEL DATA WORKS:
//   FanDuel has no public API. We use two approaches:
//
//   1. PRIMARY — FD CSV export per contest
//      Each FD contest exposes a downloadable player CSV at:
//        https://www.fanduel.com/contests/{contestId}/download-csv
//      The contestId is discovered via the FD slate API endpoint
//      which is readable without auth:
//        https://api.fanduel.com/fixture-lists?sport={sport}&_format=json
//
//   2. FALLBACK — SportsData.io (paid, reliable)
//      If SPORTSDATA_API_KEY is in env, we use their FanDuel
//      player data endpoints instead. SportsData.io supports
//      FD salaries and projections natively.
//
// SETUP:
//   Required env vars (at least one pair):
//     FD_SESSION_COOKIE   — your FD "_dfs_session" cookie value
//                           (allows CSV download without a full login)
//   OR:
//     SPORTSDATA_API_KEY  — SportsData.io API key
//
// POSITION MAPPING:
//   FD uses different position labels than DK on some sports:
//     NFL: D  → DEF
//     NBA: G  → PG or SG (inferred from FPPG tier)
//   We normalize all positions to EliteLineup's canonical set.
// ============================================================

import { storage } from "./storage";
import type { InsertSlate, InsertPlayer } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FDSport = "NBA" | "NFL" | "MLB" | "NHL" | "GOLF";

interface FDContest {
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

// ── Sport slug mapping (FD API format) ───────────────────────────────────────

const FD_SPORT_SLUGS: Record<FDSport, string> = {
  NBA: "NBA",
  NFL: "NFL",
  MLB: "MLB",
  NHL: "NHL",
  GOLF: "PGA",
};

// ── Position normalization (FD → EliteLineup canonical) ───────────────────────

function normalizeFDPosition(fdPos: string, sport: FDSport): string {
  switch (sport) {
    case "NFL":
      if (fdPos === "D") return "DEF";
      return fdPos;
    case "MLB":
      if (fdPos === "P") return "SP";  // FD only has SP starters in DFS
      return fdPos;
    case "NHL":
      // FD uses W for wings; no LW/RW split on FD
      return fdPos;
    default:
      return fdPos;
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fdFetch(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const sessionCookie = process.env.FD_SESSION_COOKIE;
  const defaultHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; EliteLineup/1.0)",
    "Accept": "application/json",
    ...headers,
  };
  if (sessionCookie) {
    defaultHeaders["Cookie"] = `_dfs_session=${sessionCookie}`;
  }

  const res = await fetch(url, { headers: defaultHeaders });
  if (!res.ok) {
    throw new Error(`FD fetch failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res;
}

// ── Contest discovery ─────────────────────────────────────────────────────────

async function fetchFDContests(sport: FDSport): Promise<FDContest[]> {
  const slug = FD_SPORT_SLUGS[sport];
  // FD's undocumented but stable fixture-list endpoint
  const url = `https://api.fanduel.com/fixture-lists?sport=${slug}&_format=json`;

  let data: any;
  try {
    const res = await fdFetch(url);
    data = await res.json();
  } catch (err: any) {
    console.error(`[FD Ingest] Failed to fetch contests for ${sport}:`, err.message);
    return [];
  }

  const contests: FDContest[] = [];
  const fixtureLists = data?.fixture_lists || [];

  for (const fl of fixtureLists) {
    const startTime = fl?.start_date ? new Date(fl.start_date) : new Date();
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));

    // Only today's contests
    const flDate = new Date(startTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
    if (
      flDate.getFullYear() !== nowET.getFullYear() ||
      flDate.getMonth() !== nowET.getMonth() ||
      flDate.getDate() !== nowET.getDate()
    ) {
      continue;
    }

    contests.push({
      id: String(fl.id),
      label: fl.label || `${sport} ${new Date(startTime).toLocaleDateString()}`,
      sport,
      startTime,
      salaryCap: fl.salary_cap || 60000,
      // FD marks the "feature" (main) slate as `is_featured: true`
      isMain: fl.is_featured === true || fl.label?.toLowerCase().includes("main"),
      draftGroupId: fl.id ? Number(fl.id) : null,
    });
  }

  return contests;
}

// ── CSV player download and parsing ──────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else current += ch;
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current.trim()); current = ""; }
      else current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function fetchFDPlayerCSV(contestId: string, sport: FDSport): Promise<FDPlayerRow[]> {
  const url = `https://www.fanduel.com/contests/${contestId}/download-csv`;

  let csvText: string;
  try {
    const res = await fdFetch(url, { "Accept": "text/csv, application/csv, */*" });
    csvText = await res.text();
  } catch (err: any) {
    console.error(`[FD Ingest] CSV download failed for contest ${contestId}:`, err.message);
    return [];
  }

  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  // FD CSV header: Nickname,FPPG,Played,Salary,Game,Team,Position,Injury Indicator,Id
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const nameIdx      = headers.findIndex(h => h === "nickname");
  const fppgIdx      = headers.findIndex(h => h === "fppg");
  const salaryIdx    = headers.findIndex(h => h === "salary");
  const gameIdx      = headers.findIndex(h => h === "game");
  const teamIdx      = headers.findIndex(h => h === "team");
  const posIdx       = headers.findIndex(h => h === "position");
  const injuryIdx    = headers.findIndex(h => h.includes("injury"));
  const idIdx        = headers.findIndex(h => h === "id");

  if (nameIdx < 0 || salaryIdx < 0 || posIdx < 0) {
    console.error(`[FD Ingest] Unexpected CSV format for contest ${contestId}. Headers: ${headers.join(", ")}`);
    return [];
  }

  const rows: FDPlayerRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 4) continue;

    const name = cols[nameIdx]?.trim();
    if (!name || name === "") continue;

    const salaryStr = cols[salaryIdx]?.replace(/[$,]/g, "") || "0";
    const salary = parseInt(salaryStr) || 0;
    if (salary === 0) continue;

    const fppg = fppgIdx >= 0 ? parseFloat(cols[fppgIdx]) || 0 : 0;
    const rawPos = posIdx >= 0 ? cols[posIdx]?.trim() : "";
    const position = normalizeFDPosition(rawPos || "", sport);
    const team = teamIdx >= 0 ? cols[teamIdx]?.trim() : "";
    const gameInfo = gameIdx >= 0 ? cols[gameIdx]?.trim() : "";
    const injuryRaw = injuryIdx >= 0 ? cols[injuryIdx]?.trim() : "";
    const injuryStatus = injuryRaw && injuryRaw.toLowerCase() !== "none" && injuryRaw !== "" ? injuryRaw : null;
    const fdId = idIdx >= 0 ? parseInt(cols[idIdx]) || null : null;

    // Parse opponent from game info: "BOS@MIA 07:10PM ET" → opponent is the other team
    let opponent = "";
    if (gameInfo && team) {
      const gameParts = gameInfo.split(" ")[0]; // "BOS@MIA"
      if (gameParts.includes("@")) {
        const [away, home] = gameParts.split("@");
        opponent = team === away ? home : away;
      }
    }

    // Project from FPPG if no explicit projection column
    const projectedPoints = fppg;

    rows.push({
      name,
      position,
      team,
      opponent,
      gameInfo,
      salary,
      fppg,
      projectedPoints,
      injuryStatus,
      fanDuelPlayerId: fdId,
    });
  }

  return rows;
}

// ── SportsData.io fallback ────────────────────────────────────────────────────

const SPORTSDATA_SPORT_SLUGS: Record<FDSport, string> = {
  NBA: "nba",
  NFL: "nfl",
  MLB: "mlb",
  NHL: "nhl",
  GOLF: "golf",
};

async function fetchSportsDataFDPlayers(sport: FDSport): Promise<FDPlayerRow[]> {
  const apiKey = process.env.SPORTSDATA_API_KEY;
  if (!apiKey) return [];

  const slug = SPORTSDATA_SPORT_SLUGS[sport];
  // SportsData.io DFS players endpoint for FanDuel
  const url = `https://api.sportsdata.io/v3/${slug}/projections/json/DfsSlatesByDate/today?key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[FD Ingest/SportsData] ${res.status} for ${sport}`);
      return [];
    }
    const slates = await res.json();
    const rows: FDPlayerRow[] = [];

    for (const slate of slates || []) {
      if (slate.Operator !== "FanDuel") continue;
      for (const p of slate.DfsSlatePlayerProjections || []) {
        const player = p.PlayerProfile || {};
        const pos = normalizeFDPosition(player.Position || "", sport);
        rows.push({
          name: `${player.FirstName || ""} ${player.LastName || ""}`.trim(),
          position: pos,
          team: player.Team || "",
          opponent: player.Opponent || "",
          gameInfo: player.GameInfo || "",
          salary: p.Salary || 0,
          fppg: p.FantasyPointsFanDuel || 0,
          projectedPoints: p.FantasyPointsFanDuel || 0,
          injuryStatus: player.InjuryStatus || null,
          fanDuelPlayerId: player.PlayerId || null,
        });
      }
    }
    return rows;
  } catch (err: any) {
    console.error(`[FD Ingest/SportsData] Error for ${sport}:`, err.message);
    return [];
  }
}

// ── Main ingestion function ───────────────────────────────────────────────────

export async function ingestFanDuelSlate(sport: FDSport): Promise<{
  success: boolean;
  slateId?: number;
  playerCount?: number;
  message: string;
}> {
  console.log(`[FD Ingest] Starting ingestion for ${sport}…`);

  // ── Step 1: Try SportsData.io first if key is available (more reliable)
  const hasSportsData = !!process.env.SPORTSDATA_API_KEY;
  const hasSessionCookie = !!process.env.FD_SESSION_COOKIE;

  if (!hasSportsData && !hasSessionCookie) {
    return {
      success: false,
      message: "No FanDuel data source configured. Set FD_SESSION_COOKIE or SPORTSDATA_API_KEY in env.",
    };
  }

  // ── Step 2: Discover contests for today
  let playerRows: FDPlayerRow[] = [];
  let slateLabel = `${sport} Main — ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`;
  let startTime = new Date();
  let salaryCap = 60000;
  let draftGroupId: number | null = null;
  let isMain = true;

  if (hasSportsData) {
    // SportsData.io path — player list only, no contest discovery needed
    playerRows = await fetchSportsDataFDPlayers(sport);
    if (playerRows.length === 0) {
      return { success: false, message: `[FD/${sport}] SportsData.io returned no players` };
    }
  } else {
    // Direct FD CSV path — discover contest first
    const contests = await fetchFDContests(sport);
    if (contests.length === 0) {
      return { success: false, message: `[FD/${sport}] No today's contests found from FD API` };
    }

    // Prefer main slate
    const mainContest = contests.find(c => c.isMain) || contests[0];
    slateLabel = mainContest.label;
    startTime = mainContest.startTime;
    salaryCap = mainContest.salaryCap;
    draftGroupId = mainContest.draftGroupId;
    isMain = mainContest.isMain;

    playerRows = await fetchFDPlayerCSV(mainContest.id, sport);
    if (playerRows.length === 0) {
      return { success: false, message: `[FD/${sport}] CSV download returned no players for contest ${mainContest.id}` };
    }
  }

  // ── Step 3: Upsert slate into DB
  const existingSlates = await storage.getSlates();
  const todayStr = new Date().toISOString().split("T")[0];

  let slate = existingSlates.find(s =>
    s.sport === sport &&
    s.platform === "fanduel" &&
    s.startTime.toISOString().startsWith(todayStr)
  );

  if (!slate) {
    const insertedSlate = await storage.createSlate({
      sport,
      platform: "fanduel",
      name: slateLabel,
      startTime,
      isMain,
      draftGroupId,
    } satisfies InsertSlate);
    slate = insertedSlate;
    console.log(`[FD Ingest] Created new ${sport} FD slate id=${slate.id}`);
  } else {
    console.log(`[FD Ingest] Reusing existing ${sport} FD slate id=${slate.id}`);
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
    return { success: false, slateId: slate.id, message: `[FD/${sport}] No valid players to insert` };
  }

  // Delete stale players for this slate then bulk insert
  await storage.deletePlayersBySlate(slate.id);
  await storage.bulkCreatePlayers(insertPlayers);

  console.log(`[FD Ingest] Upserted ${insertPlayers.length} players for ${sport} FD slate ${slate.id}`);

  return {
    success: true,
    slateId: slate.id,
    playerCount: insertPlayers.length,
    message: `Ingested ${insertPlayers.length} FD players for ${sport}`,
  };
}

// ── Ingest all sports ─────────────────────────────────────────────────────────

export async function ingestAllFanDuelSlates(): Promise<Record<FDSport, { success: boolean; message: string }>> {
  const sports: FDSport[] = ["NBA", "NFL", "MLB", "NHL", "GOLF"];
  const results = {} as Record<FDSport, { success: boolean; message: string }>;

  for (const sport of sports) {
    try {
      const r = await ingestFanDuelSlate(sport);
      results[sport] = { success: r.success, message: r.message };
    } catch (err: any) {
      results[sport] = { success: false, message: err.message || "Unknown error" };
    }
  }

  return results;
}
