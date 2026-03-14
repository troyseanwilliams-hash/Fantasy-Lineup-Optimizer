import { storage } from "./storage";
import type { InsertSlate, InsertPlayer } from "@shared/schema";
import crypto from "crypto";

export type YahooSport = "NBA" | "NFL" | "MLB" | "NHL" | "GOLF";

const YAHOO_SPORT_SLUGS: Record<YahooSport, string> = {
  NBA: "nba", NFL: "nfl", MLB: "mlb", NHL: "nhl", GOLF: "pga",
};

const RW_SPORT_SLUGS: Record<YahooSport, string> = {
  NBA: "nba", NFL: "nfl", MLB: "mlb", NHL: "nhl", GOLF: "golf",
};

const YAHOO_SALARY_CAP = 200;

interface YahooContest {
  contestKey: string;
  gameKey: string;
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

function normalizeYahooPosition(positions: string | string[], sport: YahooSport): string {
  const raw = Array.isArray(positions) ? (positions[0] ?? "") : (positions ?? "");
  const p = raw.toUpperCase().trim();

  switch (sport) {
    case "NHL":
      if (["LW","RW","C","D","G"].includes(p)) return p;
      if (p === "W") return "LW";
      return p;
    case "MLB":
      if (p === "SP" || p === "P") return "SP";
      if (p === "RP") return "SP";
      return p;
    case "NFL":
      if (p === "DEF" || p === "D") return "DEF";
      return p;
    case "NBA":
      return p;
    case "GOLF":
      return "G";
    default:
      return p;
  }
}

let _cachedToken: { token: string; expiresAt: number } | null = null;

function buildJwtAssertion(clientId: string, clientSecret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: clientId,
    sub: clientId,
    aud: "https://api.login.yahoo.com/oauth2/get_token",
    iat: now,
    exp: now + 600,
    nonce: crypto.randomBytes(16).toString("hex"),
    jti: crypto.randomUUID(),
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", clientSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

async function getYahooToken(): Promise<string | null> {
  const staticToken = process.env.YAHOO_ACCESS_TOKEN;
  if (staticToken) return staticToken;

  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn("[Yahoo] No YAHOO_CLIENT_ID/YAHOO_CLIENT_SECRET set — skipping OAuth");
    return null;
  }

  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 300_000) {
    console.log("[Yahoo] Using cached OAuth token");
    return _cachedToken.token;
  }

  const methods = [
    async () => {
      console.log("[Yahoo] Trying OAuth: JWT client_assertion…");
      const assertion = buildJwtAssertion(clientId, clientSecret);
      const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: assertion,
          client_id: clientId,
        }).toString(),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`JWT assertion ${res.status}: ${body.slice(0, 200)}`);
      }
      return res;
    },
    async () => {
      console.log("[Yahoo] Trying OAuth: Basic auth…");
      const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: buildJwtAssertion(clientId, clientSecret),
        }).toString(),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Basic auth ${res.status}: ${body.slice(0, 200)}`);
      }
      return res;
    },
    async () => {
      console.log("[Yahoo] Trying OAuth: POST body credentials…");
      const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`POST body ${res.status}: ${body.slice(0, 200)}`);
      }
      return res;
    },
  ];

  for (const method of methods) {
    try {
      const res = await method();
      const d = await res.json();
      if (d.access_token) {
        _cachedToken = { token: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
        console.log(`[Yahoo] OAuth token obtained (expires in ${d.expires_in || 3600}s)`);
        return _cachedToken.token;
      }
    } catch (err: any) {
      console.warn(`[Yahoo] OAuth attempt failed: ${err.message}`);
    }
  }

  console.error("[Yahoo] All OAuth methods failed");
  return null;
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

async function fetchYahooContests(sport: YahooSport): Promise<YahooContest[]> {
  const slug = YAHOO_SPORT_SLUGS[sport];
  const hasCredentials = !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);

  const contestUrls = [
    `https://dfyql-ro.sports.yahoo.com/v2/contests?sport=${slug}&status=open`,
    `https://dfyql-ro.sports.yahoo.com/v2/external/contests?sport=${slug}&status=open`,
    `https://dfyql-ro.sports.yahoo.com/v2/external/contracts/json?sport=${slug}&status=open`,
    `https://dfyql-ro.sports.yahoo.com/v2/contestList?sport=${slug}`,
    `https://fantasysports.yahooapis.com/fantasy/v2/game/${slug}/contests?format=json`,
  ];

  let data: any = null;

  for (const url of contestUrls) {
    for (const useAuth of (hasCredentials ? [true, false] : [false])) {
      try {
        console.log(`[Yahoo Ingest] Trying contest URL: ${url} (auth=${useAuth})`);
        const res = await yahooFetch(url, useAuth);
        const raw = await res.text();
        try {
          data = JSON.parse(raw);
        } catch {
          if (raw.includes("<?xml")) {
            console.warn(`[Yahoo Ingest] Got XML response from ${url}, skipping`);
            continue;
          }
          throw new Error("Non-JSON response");
        }
        if (data) {
          console.log(`[Yahoo Ingest] ${sport}: Got response from ${url} (auth=${useAuth})`);
          break;
        }
      } catch (err: any) {
        console.warn(`[Yahoo Ingest] ${url} (auth=${useAuth}): ${err.message}`);
      }
    }
    if (data) break;
  }

  if (!data) {
    console.error(`[Yahoo Ingest] All contest endpoints failed for ${sport}`);
    return [];
  }

  let contractList: any[] = [];

  if (Array.isArray(data)) {
    contractList = data;
  } else if (data && typeof data === "object") {
    console.log(`[Yahoo Ingest] ${sport}: Response keys: ${Object.keys(data).join(", ")}`);

    const candidates = [
      data.contests?.result,
      data.contestsData?.result,
      data.contests,
      data.contestsData,
      data.contracts,
      data.result?.contests,
      data.result?.contracts,
      data.fantasy_content?.contests,
      data.data?.contests,
      data.data?.contracts,
      data.data,
    ];

    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) {
        contractList = c;
        break;
      }
    }

    if (contractList.length === 0) {
      for (const c of candidates) {
        if (Array.isArray(c)) {
          contractList = c;
          break;
        }
      }
    }

    if (contractList.length === 0 && data.contests && typeof data.contests === "object" && !Array.isArray(data.contests)) {
      const vals = Object.values(data.contests);
      if (vals.length > 0 && typeof vals[0] === "object") {
        contractList = vals as any[];
      }
    }
  }

  console.log(`[Yahoo Ingest] ${sport}: Found ${contractList.length} raw contests/contracts`);

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStart = new Date(nowET); todayStart.setHours(0,0,0,0);
  const tomorrowEnd = new Date(nowET); tomorrowEnd.setDate(tomorrowEnd.getDate() + 1); tomorrowEnd.setHours(23,59,59,999);

  const contests: YahooContest[] = [];

  for (const c of contractList) {
    if (!c || typeof c !== "object") continue;
    const rawStart = c.start_time ?? c.startTime ?? c.draft_start ?? c.lock_time
      ?? c.contestStartTime ?? c.startDate ?? c.lockTime ?? c.draftStartTime
      ?? c.contestLockTime ?? c.openTime ?? c.closeTime;
    if (!rawStart) continue;

    let startTime: Date;
    const numericStart = typeof rawStart === "number" ? rawStart : (typeof rawStart === "string" && /^\d+$/.test(rawStart) ? parseInt(rawStart, 10) : NaN);
    if (!isNaN(numericStart)) {
      startTime = numericStart > 1e12 ? new Date(numericStart) : new Date(numericStart * 1000);
    } else {
      startTime = new Date(rawStart);
    }

    const startET = new Date(startTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
    if (startET < todayStart || startET > tomorrowEnd) continue;

    const label = c.name ?? c.title ?? c.contest_name ?? `${sport} Yahoo ${startET.toLocaleDateString()}`;
    const contestTypeName = (c.contest_type_name ?? c.type ?? "").toLowerCase();

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
      salaryCap: c.salaryCap ?? c.salary_cap ?? YAHOO_SALARY_CAP,
      isMain,
    });
  }

  contests.sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    return a.startTime.getTime() - b.startTime.getTime();
  });

  return contests;
}

async function fetchYahooPlayers(contest: YahooContest): Promise<YahooPlayerRow[]> {
  const slug = YAHOO_SPORT_SLUGS[contest.sport];
  const hasCredentials = !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);

  const playerUrls = [
    `https://dfyql-ro.sports.yahoo.com/v2/contestPlayers?contestId=${contest.contestKey}`,
    `https://dfyql-ro.sports.yahoo.com/v2/players?sport=${slug}&contestId=${contest.contestKey}`,
    `https://dfyql-ro.sports.yahoo.com/v2/players?sport=${slug}&contest_key=${contest.contestKey}`,
    `https://dfyql-ro.sports.yahoo.com/v2/contestPlayers?contest_key=${contest.contestKey}&sport=${slug}`,
  ];

  let data: any = null;
  let usedAuth = false;

  for (const url of playerUrls) {
    for (const useAuth of (hasCredentials ? [true, false] : [false])) {
      try {
        console.log(`[Yahoo Ingest] Trying player URL: ${url} (auth=${useAuth})`);
        const res = await yahooFetch(url, useAuth);
        data = await res.json();
        usedAuth = useAuth;
        if (data) {
          console.log(`[Yahoo Ingest] Got player response from ${url}`);
          break;
        }
      } catch (err: any) {
        console.warn(`[Yahoo Ingest] ${url} (auth=${useAuth}): ${err.message}`);
      }
    }
    if (data) break;
  }

  if (!data) {
    console.error(`[Yahoo Ingest] All player endpoints failed for contest ${contest.contestKey}`);
    return [];
  }

  let playerList: any[] = [];
  const plCandidates = [
    data?.players?.result,
    data?.players,
    data?.contestPlayers?.result,
    data?.contestPlayers,
    data?.result?.players,
    data?.data?.players,
  ];
  for (const c of plCandidates) {
    if (Array.isArray(c) && c.length > 0) { playerList = c; break; }
  }
  if (playerList.length === 0 && Array.isArray(data) && data.length > 0) {
    playerList = data;
  }

  if (playerList.length === 0) {
    console.warn(`[Yahoo Ingest] No players in response for contest ${contest.contestKey}${usedAuth ? " (with auth)" : ""}. Response keys: ${data ? Object.keys(data).join(", ") : "null"}`);
    if (data?.players && !Array.isArray(data.players)) {
      console.warn(`[Yahoo Ingest] data.players type: ${typeof data.players}, keys: ${Object.keys(data.players).slice(0, 5).join(", ")}`);
    }
    return [];
  }

  return parseYahooAPIPlayers(playerList, contest.sport);
}

function parseYahooAPIPlayers(players: any[], sport: YahooSport): YahooPlayerRow[] {
  const rows: YahooPlayerRow[] = [];

  for (const p of players) {
    const name = p.full_name
      ?? (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}`.trim() : null)
      ?? (p.first_name && p.last_name ? `${p.first_name} ${p.last_name}`.trim() : null)
      ?? p.name
      ?? "";
    if (!name || name.trim().length < 2) continue;

    const eligiblePositions: string[] = p.eligiblePositions ?? p.eligible_positions ?? p.positions ?? [];
    const position = normalizeYahooPosition(
      eligiblePositions.length > 0 ? eligiblePositions : (p.primaryPosition ?? p.position ?? p.primary_position ?? ""),
      sport
    );
    if (!position) continue;

    const salary = parseInt(
      String(p.salary ?? p.dfs_salary ?? p.contract_salary ?? "0").replace(/[$,]/g, "")
    ) || 0;
    if (!salary) continue;

    const fppg =
      parseFloat(p.fantasyPointsPerGame ?? p.average_points ?? p.fppg ?? p.average_fantasy_points ?? p.points_per_game ?? "0") || 0;

    const team = p.teamAbbr ?? p.team?.abbr ?? p.editorial_team_abbr ?? p.team_abbr ?? (typeof p.team === "string" ? p.team : "");

    const game = p.game ?? {};
    const homeAbbr = game.homeTeam?.abbr ?? "";
    const awayAbbr = game.awayTeam?.abbr ?? "";
    const opponent = team === homeAbbr ? awayAbbr : (team === awayAbbr ? homeAbbr : (p.opponent_abbr ?? p.opponent ?? ""));

    let gameInfo = p.game_info ?? p.matchup ?? "";
    if (!gameInfo && homeAbbr && awayAbbr) {
      const rawGS = game.startTime;
      const numGS = typeof rawGS === "number" ? rawGS : (typeof rawGS === "string" && /^\d+$/.test(rawGS) ? parseInt(rawGS, 10) : NaN);
      const gameStart = rawGS
        ? new Date(!isNaN(numGS) ? (numGS > 1e12 ? numGS : numGS * 1000) : rawGS)
        : null;
      const timeStr = gameStart
        ? gameStart.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })
        : "";
      gameInfo = `${awayAbbr} @ ${homeAbbr}${timeStr ? " " + timeStr + " ET" : ""}`;
    }

    const injuryRaw = p.status ?? p.injury_status ?? p.injury_note ?? p.extendedStatus ?? "";
    const injuryStatus =
      injuryRaw && !["", "Active", "Healthy", "DTD", "N/A", "unknown"].includes(injuryRaw)
        ? injuryRaw : null;
    const normalizedInjury = injuryRaw === "DTD" ? "Questionable" : injuryStatus;

    const playerId = p.code ?? p.player_id ?? p.id ?? p.playerSalaryId ?? "";

    rows.push({
      name: name.trim(),
      position,
      team,
      opponent,
      gameInfo,
      salary,
      fppg,
      projectedPoints: fppg,
      injuryStatus: normalizedInjury,
      yahooPlayerId: String(playerId),
    });
  }

  return rows;
}

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
      fanDuelPlayerId: null,
      yahooPlayerId: p.yahooPlayerId,
      fanDuelSalary: null,
      yahooSalary: null,
      isConfirmedStarter: false,
    } satisfies InsertPlayer));
}

export async function ingestYahooSlate(sport: YahooSport): Promise<{
  success: boolean; slateId?: number; playerCount?: number; message: string; source?: string;
}> {
  const hasYahooCredentials = !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);
  console.log(`[Yahoo Ingest] Starting ${sport}… (credentials: ${hasYahooCredentials ? "YES" : "NO"}, rotowire: ${!!process.env.ROTOWIRE_API_KEY})`);

  let playerRows: YahooPlayerRow[] = [];
  let slateLabel = `${sport} Yahoo Main — ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}`;
  let startTime = new Date();
  let source = "none";

  if (process.env.ROTOWIRE_API_KEY) {
    playerRows = await fetchRotoWirePlayers(sport);
    if (playerRows.length > 0) source = "rotowire";
  }

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
