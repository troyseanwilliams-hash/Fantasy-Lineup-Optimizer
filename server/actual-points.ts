const ESPN_SCOREBOARD_URLS: Record<string, string> = {
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
};

const ESPN_SUMMARY_URLS: Record<string, string> = {
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary",
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary",
};

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PlayerActualPoints {
  playerName: string;
  normalizedName: string;
  team: string;
  points: number;
  statLine: Record<string, number>;
}

function computeNBAPoints(athlete: any, labels: string[], stats: string[]): { points: number; statLine: Record<string, number> } {
  const get = (label: string) => {
    const idx = labels.indexOf(label);
    if (idx < 0 || !stats[idx]) return 0;
    const val = stats[idx];
    if (label === "MIN") {
      const parts = val.split(":");
      return parseInt(parts[0]) || 0;
    }
    return parseFloat(val) || 0;
  };

  const pts = get("PTS");
  const reb = get("REB");
  const ast = get("AST");
  const stl = get("STL");
  const blk = get("BLK");
  const to = get("TO");
  const threePM = get("3PM");

  const statLine = { pts, reb, ast, stl, blk, to, threePM };

  let fp = pts * 1 + reb * 1.25 + ast * 1.5 + stl * 2 + blk * 2 + to * -0.5 + threePM * 0.5;

  const categories = [pts > 0 ? 1 : 0, reb >= 10 ? 1 : 0, ast >= 10 ? 1 : 0, stl >= 10 ? 1 : 0, blk >= 10 ? 1 : 0, pts >= 10 ? 1 : 0];
  const catCount = categories.reduce((a, b) => a + b, 0);
  if (catCount >= 2) {
    const doubleCheck = [pts >= 10 ? 1 : 0, reb >= 10 ? 1 : 0, ast >= 10 ? 1 : 0, stl >= 10 ? 1 : 0, blk >= 10 ? 1 : 0];
    const ddCount = doubleCheck.reduce((a, b) => a + b, 0);
    if (ddCount >= 2) fp += 1.5;
    if (ddCount >= 3) fp += 3;
  }

  return { points: Math.round(fp * 100) / 100, statLine };
}

function computeNHLSkaterPoints(athlete: any, labels: string[], stats: string[]): { points: number; statLine: Record<string, number> } {
  const get = (label: string) => {
    const idx = labels.indexOf(label);
    return idx >= 0 ? (parseFloat(stats[idx]) || 0) : 0;
  };

  const goals = get("G");
  const assists = get("A");
  const sog = get("SOG");
  const blk = get("BLK");
  const shp = get("SHP");

  const statLine = { goals, assists, sog, blk, shp };
  const fp = goals * 8.5 + assists * 5 + sog * 1.5 + blk * 1.3 + shp * 2;

  return { points: Math.round(fp * 100) / 100, statLine };
}

function computeNHLGoaliePoints(athlete: any, labels: string[], stats: string[]): { points: number; statLine: Record<string, number> } {
  const get = (label: string) => {
    const idx = labels.indexOf(label);
    return idx >= 0 ? (parseFloat(stats[idx]) || 0) : 0;
  };

  const wins = get("W") > 0 ? 1 : 0;
  const saves = get("SV");
  const ga = get("GA");

  const statLine = { wins, saves, ga };
  const fp = wins * 6 + saves * 0.7 + ga * -3.5;

  return { points: Math.round(fp * 100) / 100, statLine };
}

function computeMLBHitterPoints(athlete: any, labels: string[], stats: string[]): { points: number; statLine: Record<string, number> } {
  const get = (label: string) => {
    const idx = labels.indexOf(label);
    return idx >= 0 ? (parseFloat(stats[idx]) || 0) : 0;
  };

  const singles = get("H") - get("2B") - get("3B") - get("HR");
  const doubles = get("2B");
  const triples = get("3B");
  const hr = get("HR");
  const rbi = get("RBI");
  const r = get("R");
  const bb = get("BB");
  const hbp = get("HBP");
  const sb = get("SB");

  const statLine = { singles: Math.max(0, singles), doubles, triples, hr, rbi, r, bb, hbp, sb };
  const fp = Math.max(0, singles) * 3 + doubles * 5 + triples * 8 + hr * 10 + rbi * 2 + r * 2 + bb * 2 + hbp * 2 + sb * 5;

  return { points: Math.round(fp * 100) / 100, statLine };
}

function computeMLBPitcherPoints(athlete: any, labels: string[], stats: string[]): { points: number; statLine: Record<string, number> } {
  const get = (label: string) => {
    const idx = labels.indexOf(label);
    return idx >= 0 ? (parseFloat(stats[idx]) || 0) : 0;
  };

  const ip = get("IP");
  const k = get("K");
  const wins = get("W") > 0 ? 1 : 0;
  const er = get("ER");
  const h = get("H");
  const bb = get("BB");
  const hbp = get("HBP");
  const cg = get("CG") > 0 ? 1 : 0;
  const cgso = get("CGSO") > 0 ? 1 : 0;
  const nh = get("NH") > 0 ? 1 : 0;

  const outs = Math.round(ip * 3);
  const statLine = { ip, k, wins, er, h, bb, hbp };
  const fp = outs * 2.25 + k * 2 + wins * 4 + er * -2 + h * -0.6 + bb * -0.6 + hbp * -0.6 + cg * 2.5 + cgso * 2.5 + nh * 5;

  return { points: Math.round(fp * 100) / 100, statLine };
}

function computeNFLPoints(athlete: any, labels: string[], stats: string[], statGroupName: string): { points: number; statLine: Record<string, number> } {
  const get = (label: string) => {
    const idx = labels.indexOf(label);
    return idx >= 0 ? (parseFloat(stats[idx]) || 0) : 0;
  };

  let fp = 0;
  const statLine: Record<string, number> = {};

  if (statGroupName === "passing") {
    const yds = get("YDS");
    const td = get("TD");
    const int = get("INT");
    statLine.passYds = yds;
    statLine.passTD = td;
    statLine.int = int;
    fp += yds * 0.04 + td * 4 + int * -1;
    if (yds >= 300) fp += 3;
  } else if (statGroupName === "rushing") {
    const yds = get("YDS");
    const td = get("TD");
    statLine.rushYds = yds;
    statLine.rushTD = td;
    fp += yds * 0.1 + td * 6;
    if (yds >= 100) fp += 3;
  } else if (statGroupName === "receiving") {
    const rec = get("REC");
    const yds = get("YDS");
    const td = get("TD");
    statLine.rec = rec;
    statLine.recYds = yds;
    statLine.recTD = td;
    fp += rec * 1 + yds * 0.1 + td * 6;
    if (yds >= 100) fp += 3;
  } else if (statGroupName === "kicking") {
    const fgm = get("FGM");
    const xpm = get("XPM");
    statLine.fgm = fgm;
    statLine.xpm = xpm;
    fp += fgm * 3 + xpm * 1;
  } else if (statGroupName === "defensive") {
    const sacks = get("SACK");
    const int = get("INT");
    const ff = get("FF");
    const fr = get("FR");
    const td = get("TD");
    statLine.sacks = sacks;
    statLine.defInt = int;
    statLine.ff = ff;
    statLine.fr = fr;
    statLine.defTD = td;
    fp += sacks * 1 + int * 2 + ff * 1 + fr * 1 + td * 6;
  }

  return { points: Math.round(fp * 100) / 100, statLine };
}

async function fetchWithRetry(url: string, retries = 2): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "EliteLineupAI/1.0" } });
      if (res.ok) return await res.json();
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    } catch {
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function fetchCompletedGameIdsForDate(sport: string, dateStr: string): Promise<string[]> {
  const baseUrl = ESPN_SCOREBOARD_URLS[sport];
  if (!baseUrl) return [];

  const data = await fetchWithRetry(`${baseUrl}?dates=${dateStr}`);
  if (!data) return [];
  const events = data.events || [];
  return events.filter((e: any) => e.status?.type?.completed).map((e: any) => e.id);
}

export interface GameInfo {
  id: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  startTime: string;
}

export async function fetchActiveGameIdsForDate(sport: string, dateStr: string): Promise<GameInfo[]> {
  const baseUrl = ESPN_SCOREBOARD_URLS[sport];
  if (!baseUrl) return [];

  try {
    const res = await fetch(`${baseUrl}?dates=${dateStr}`, { headers: { "User-Agent": "EliteLineupAI/1.0" } });
    if (!res.ok) return [];
    const data = await res.json();
    const events = data.events || [];
    return events
      .filter((e: any) => {
        const state = e.status?.type?.state;
        return state === "in" || state === "post";
      })
      .map((e: any) => ({
        id: e.id,
        status: e.status?.type?.state as "in" | "post",
        statusDetail: e.status?.type?.shortDetail || e.status?.type?.detail || "",
        startTime: e.date || "",
      }));
  } catch {
    return [];
  }
}

export async function fetchAllActualPointsForDate(sport: string, dateStr: string): Promise<{ playerMap: Map<string, PlayerActualPoints>; gamesTotal: number; gamesCompleted: number; gamesInProgress: number }> {
  const formattedDate = dateStr.replace(/-/g, "");
  const games = await fetchActiveGameIdsForDate(sport, formattedDate);

  if (games.length === 0) {
    return { playerMap: new Map(), gamesTotal: 0, gamesCompleted: 0, gamesInProgress: 0 };
  }

  const gamesCompleted = games.filter(g => g.status === "post").length;
  const gamesInProgress = games.filter(g => g.status === "in").length;

  const playerMap = new Map<string, PlayerActualPoints>();
  const batchSize = 3;
  const gameIds = games.map(g => g.id);

  for (let i = 0; i < gameIds.length; i += batchSize) {
    const batch = gameIds.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id => fetchPlayerStatsFromGame(sport, id)));
    for (const gameResults of results) {
      for (const player of gameResults) {
        const existing = playerMap.get(player.normalizedName);
        if (existing) {
          existing.points += player.points;
          existing.points = Math.round(existing.points * 100) / 100;
          Object.assign(existing.statLine, player.statLine);
        } else {
          playerMap.set(player.normalizedName, player);
        }
      }
    }
  }

  return { playerMap, gamesTotal: games.length, gamesCompleted, gamesInProgress };
}

async function fetchPlayerStatsFromGame(sport: string, gameId: string): Promise<PlayerActualPoints[]> {
  const baseUrl = ESPN_SUMMARY_URLS[sport];
  if (!baseUrl) return [];

  try {
    const data = await fetchWithRetry(`${baseUrl}?event=${gameId}`);
    if (!data) return [];

    const results: PlayerActualPoints[] = [];
    const boxscore = data.boxscore;
    if (!boxscore?.players) return [];

    for (const team of boxscore.players) {
      const teamAbbrev = team.team?.abbreviation || "";
      for (const statGroup of team.statistics || []) {
        const labels = statGroup.labels || [];
        for (const athlete of statGroup.athletes || []) {
          const name = athlete.athlete?.displayName;
          if (!name) continue;
          const stats = athlete.stats || [];

          let computed: { points: number; statLine: Record<string, number> } | null = null;

          if (sport === "NBA") {
            computed = computeNBAPoints(athlete, labels, stats);
          } else if (sport === "NHL") {
            if (statGroup.name === "goalies" || statGroup.type === "goalies") {
              computed = computeNHLGoaliePoints(athlete, labels, stats);
            } else {
              computed = computeNHLSkaterPoints(athlete, labels, stats);
            }
          } else if (sport === "MLB") {
            if (statGroup.name === "pitching" || statGroup.type === "pitching") {
              computed = computeMLBPitcherPoints(athlete, labels, stats);
            } else {
              computed = computeMLBHitterPoints(athlete, labels, stats);
            }
          } else if (sport === "NFL") {
            computed = computeNFLPoints(athlete, labels, stats, statGroup.name || "");
          }

          if (computed && computed.points !== 0) {
            const existing = results.find(r => r.normalizedName === normalizeName(name) && r.team === teamAbbrev);
            if (existing) {
              existing.points += computed.points;
              existing.points = Math.round(existing.points * 100) / 100;
              Object.assign(existing.statLine, computed.statLine);
            } else {
              results.push({
                playerName: name,
                normalizedName: normalizeName(name),
                team: teamAbbrev,
                points: computed.points,
                statLine: computed.statLine,
              });
            }
          }
        }
      }
    }

    return results;
  } catch (err) {
    console.error(`[ActualPoints] Error fetching game ${gameId}:`, err);
    return [];
  }
}

export async function fetchActualPointsForDate(sport: string, dateStr: string): Promise<Map<string, PlayerActualPoints>> {
  const formattedDate = dateStr.replace(/-/g, "");
  const gameIds = await fetchCompletedGameIdsForDate(sport, formattedDate);

  if (gameIds.length === 0) {
    console.log(`[ActualPoints] No completed ${sport} games for ${dateStr}`);
    return new Map();
  }

  console.log(`[ActualPoints] Found ${gameIds.length} completed ${sport} games for ${dateStr}`);

  const playerMap = new Map<string, PlayerActualPoints>();
  const batchSize = 3;

  for (let i = 0; i < gameIds.length; i += batchSize) {
    const batch = gameIds.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id => fetchPlayerStatsFromGame(sport, id)));
    for (const gameResults of results) {
      for (const player of gameResults) {
        const existing = playerMap.get(player.normalizedName);
        if (existing) {
          existing.points += player.points;
          existing.points = Math.round(existing.points * 100) / 100;
          Object.assign(existing.statLine, player.statLine);
        } else {
          playerMap.set(player.normalizedName, player);
        }
      }
    }
  }

  console.log(`[ActualPoints] Computed actual points for ${playerMap.size} ${sport} players on ${dateStr}`);
  return playerMap;
}

async function backfillSportDate(storage: any, sport: string, dateStr: string): Promise<string | null> {
  const historyRows = await storage.getPlayerHistoryByDate(sport, dateStr);
  if (!historyRows || historyRows.length === 0) return null;

  const needsUpdate = historyRows.filter((h: any) => h.actualPoints === null || h.actualPoints === undefined);
  if (needsUpdate.length === 0) return null;

  const actualPointsMap = await fetchActualPointsForDate(sport, dateStr);
  if (actualPointsMap.size === 0) {
    console.log(`[ActualPoints Backfill] ${sport} ${dateStr}: no ESPN data (${needsUpdate.length} players need update)`);
    return null;
  }

  const batchUpdates: Array<{ playerName: string; actualPoints: string }> = [];
  const seen = new Set<string>();

  for (const h of needsUpdate) {
    if (seen.has(h.playerName)) continue;
    seen.add(h.playerName);

    const normalized = normalizeName(h.playerName);
    const actual = actualPointsMap.get(normalized);
    if (actual !== undefined) {
      batchUpdates.push({ playerName: h.playerName, actualPoints: String(actual.points) });
    }
  }

  if (batchUpdates.length > 0) {
    await storage.batchUpdatePlayerHistoryActualPoints(sport, dateStr, batchUpdates);
    const msg = `${sport} ${dateStr}: updated ${batchUpdates.length} players with actual points`;
    console.log(`[ActualPoints Backfill] ${msg}`);
    return msg;
  }

  return null;
}

export async function backfillActualPointsForHistory(storage: any, daysBack = 7): Promise<string[]> {
  const results: string[] = [];
  const supportedSports = ["NHL", "MLB", "NFL"];

  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i <= daysBack; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  for (const sport of supportedSports) {
    for (const dateStr of dates) {
      try {
        const msg = await backfillSportDate(storage, sport, dateStr);
        if (msg) results.push(msg);
        await new Promise(res => setTimeout(res, 300));
      } catch (err: any) {
        console.error(`[ActualPoints Backfill] ${sport} ${dateStr} error:`, err.message);
      }
    }
  }

  return results;
}

export async function fillActualPointsGaps(storage: any, daysBack = 14): Promise<string[]> {
  const results: string[] = [];
  const supportedSports = ["NHL", "MLB", "NFL"];

  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i <= daysBack; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  console.log(`[GapFill] Scanning ${dates.length} dates for ${supportedSports.length} sports...`);

  for (const sport of supportedSports) {
    for (const dateStr of dates) {
      try {
        const historyRows = await storage.getPlayerHistoryByDate(sport, dateStr);
        if (!historyRows || historyRows.length === 0) continue;

        const uniqueNames = new Set(historyRows.map((h: any) => h.playerName));
        const needsUpdate = historyRows.filter((h: any) => h.actualPoints === null || h.actualPoints === undefined);
        const uniqueNeedsUpdate = new Set(needsUpdate.map((h: any) => h.playerName));

        if (uniqueNeedsUpdate.size === 0) continue;

        const coveragePct = Math.round(((uniqueNames.size - uniqueNeedsUpdate.size) / uniqueNames.size) * 100);
        if (coveragePct >= 95) continue;

        console.log(`[GapFill] ${sport} ${dateStr}: ${coveragePct}% coverage (${uniqueNeedsUpdate.size} players missing)`);

        const msg = await backfillSportDate(storage, sport, dateStr);
        if (msg) results.push(msg);
        await new Promise(res => setTimeout(res, 500));
      } catch (err: any) {
        console.error(`[GapFill] ${sport} ${dateStr} error:`, err.message);
      }
    }
  }

  if (results.length === 0) {
    console.log("[GapFill] No gaps found — all dates have 95%+ coverage");
  } else {
    console.log(`[GapFill] Filled ${results.length} sport/date gaps`);
  }

  return results;
}
