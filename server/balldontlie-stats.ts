const BDL_BASE = "https://api.balldontlie.io";

export interface PlayerStatsMap {
  [normalizedName: string]: {
    fantasyScore: number;
    starPower: number;
    consistency: number;
  };
}

const statsCache = new Map<string, { data: PlayerStatsMap; timestamp: number }>();
const CACHE_TTL = 4 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL = 30 * 60 * 1000;

function getApiKey(): string | null {
  return process.env.BALLDONTLIE_API_KEY || null;
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

async function bdlFetch<T>(url: string): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log("[BDL] No API key configured");
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.error(`[BDL] API error: ${res.status} for ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[BDL] Fetch error for ${url}:`, err);
    return null;
  }
}

interface BDLStatEntry {
  id: number;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  player: {
    id: number;
    first_name: string;
    last_name: string;
    position: string;
  };
  game: {
    id: number;
    date: string;
    season: number;
  };
}

interface BDLResponse<T> {
  data: T[];
  meta?: { next_cursor?: number; per_page?: number };
}

async function fetchRecentGameDates(sport: string): Promise<string[]> {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function computeDKFantasyNBA(pts: number, reb: number, ast: number, stl: number, blk: number, turnover: number): number {
  const base = pts * 1.0 + reb * 1.25 + ast * 1.5 + stl * 2.0 + blk * 2.0 - turnover * 0.5;
  let bonus = 0;
  const cats = [pts >= 10 ? 1 : 0, reb >= 10 ? 1 : 0, ast >= 10 ? 1 : 0, stl >= 10 ? 1 : 0, blk >= 10 ? 1 : 0];
  const catCount = cats.reduce((a, b) => a + b, 0);
  if (catCount >= 2) bonus += 1.5;
  if (catCount >= 3) bonus += 3.0;
  return base + bonus;
}

async function fetchNBAStats(): Promise<PlayerStatsMap> {
  const currentYear = new Date().getFullYear();
  const season = new Date().getMonth() >= 9 ? currentYear : currentYear - 1;
  const dates = await fetchRecentGameDates("NBA");

  const playerGames: Record<string, { name: string; games: { pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; min: number; fantasy: number }[] }> = {};

  for (const date of dates) {
    let cursor: number | null = null;
    let pages = 0;
    while (pages < 5) {
      const url = cursor
        ? `${BDL_BASE}/v1/stats?seasons[]=${season}&dates[]=${date}&per_page=100&cursor=${cursor}`
        : `${BDL_BASE}/v1/stats?seasons[]=${season}&dates[]=${date}&per_page=100`;
      const result = await bdlFetch<BDLResponse<BDLStatEntry>>(url);
      if (!result || !result.data || result.data.length === 0) break;

      for (const entry of result.data) {
        if (!entry.player) continue;
        const name = `${entry.player.first_name} ${entry.player.last_name}`;
        const key = normalizeName(name);
        const minNum = parseInt(entry.min) || 0;
        if (minNum < 5) continue;

        if (!playerGames[key]) playerGames[key] = { name, games: [] };

        const fantasy = computeDKFantasyNBA(
          entry.pts || 0, entry.reb || 0, entry.ast || 0,
          entry.stl || 0, entry.blk || 0, entry.turnover || 0
        );

        playerGames[key].games.push({
          pts: entry.pts || 0, reb: entry.reb || 0, ast: entry.ast || 0,
          stl: entry.stl || 0, blk: entry.blk || 0, tov: entry.turnover || 0,
          min: minNum, fantasy,
        });
      }

      if (!result.meta?.next_cursor) break;
      cursor = result.meta.next_cursor;
      pages++;
    }
  }

  const statsMap: PlayerStatsMap = {};
  for (const [key, val] of Object.entries(playerGames)) {
    const gp = val.games.length;
    if (gp === 0) continue;
    const avgFantasy = val.games.reduce((s, g) => s + g.fantasy, 0) / gp;
    const avgMin = val.games.reduce((s, g) => s + g.min, 0) / gp;
    const avgPts = val.games.reduce((s, g) => s + g.pts, 0) / gp;

    const starPower = Math.min(1, (avgMin / 36) * 0.5 + (avgPts / 28) * 0.5);
    const consistency = gp >= 5 ? 1.0 : gp >= 3 ? 0.85 : gp >= 2 ? 0.7 : 0.5;

    statsMap[key] = { fantasyScore: avgFantasy, starPower, consistency };
  }

  console.log(`[BDL] NBA: Fetched stats for ${Object.keys(statsMap).length} players from recent games`);
  return statsMap;
}

async function fetchNFLStats(): Promise<PlayerStatsMap> {
  const currentYear = new Date().getFullYear();
  const season = new Date().getMonth() >= 8 ? currentYear : currentYear - 1;

  const playerGames: Record<string, { fantasy: number[]; totalYards: number }> = {};
  let cursor: number | null = null;
  let pages = 0;
  while (pages < 15) {
    const url = cursor
      ? `${BDL_BASE}/nfl/v1/stats?seasons[]=${season}&per_page=100&cursor=${cursor}`
      : `${BDL_BASE}/nfl/v1/stats?seasons[]=${season}&per_page=100`;
    const result = await bdlFetch<BDLResponse<any>>(url);
    if (!result || !result.data || result.data.length === 0) break;

    for (const entry of result.data) {
      if (!entry.player) continue;
      const name = `${entry.player.first_name} ${entry.player.last_name}`;
      const key = normalizeName(name);
      if (!playerGames[key]) playerGames[key] = { fantasy: [], totalYards: 0 };

      const passYds = entry.passing_yards || 0;
      const passTds = entry.passing_tds || 0;
      const rushYds = entry.rushing_yards || 0;
      const rushTds = entry.rushing_tds || 0;
      const recYds = entry.receiving_yards || 0;
      const recTds = entry.receiving_tds || 0;
      const rec = entry.receptions || 0;
      const ints = entry.interceptions || 0;
      const fumbles = entry.fumbles_lost || 0;

      const dkPts = passYds * 0.04 + passTds * 4 + rushYds * 0.1 + rushTds * 6 +
                    recYds * 0.1 + recTds * 6 + rec * 1.0 - ints * 1 - fumbles * 1;

      playerGames[key].fantasy.push(dkPts);
      playerGames[key].totalYards += passYds + rushYds + recYds;
    }

    if (!result.meta?.next_cursor) break;
    cursor = result.meta.next_cursor;
    pages++;
  }

  const statsMap: PlayerStatsMap = {};
  for (const [key, val] of Object.entries(playerGames)) {
    const gp = val.fantasy.length;
    if (gp === 0) continue;
    const avgFantasy = val.fantasy.reduce((s, v) => s + v, 0) / gp;
    const avgYards = val.totalYards / gp;
    const starPower = Math.min(1, avgYards / 250);
    const consistency = gp >= 14 ? 1.0 : gp >= 8 ? 0.85 : gp >= 4 ? 0.7 : 0.5;
    statsMap[key] = { fantasyScore: avgFantasy, starPower, consistency };
  }

  console.log(`[BDL] NFL: Fetched stats for ${Object.keys(statsMap).length} players`);
  return statsMap;
}

async function fetchNHLStats(): Promise<PlayerStatsMap> {
  const currentYear = new Date().getFullYear();
  const season = new Date().getMonth() >= 9 ? currentYear : currentYear - 1;
  const dates = await fetchRecentGameDates("NHL");

  const playerGames: Record<string, { fantasy: number[]; totalPts: number }> = {};

  for (const date of dates) {
    let cursor: number | null = null;
    let pages = 0;
    while (pages < 3) {
      const url = cursor
        ? `${BDL_BASE}/nhl/v1/stats?dates[]=${date}&per_page=100&cursor=${cursor}`
        : `${BDL_BASE}/nhl/v1/stats?dates[]=${date}&per_page=100`;
      const result = await bdlFetch<BDLResponse<any>>(url);
      if (!result || !result.data || result.data.length === 0) break;

      for (const entry of result.data) {
        if (!entry.player) continue;
        const name = `${entry.player.first_name} ${entry.player.last_name}`;
        const key = normalizeName(name);
        if (!playerGames[key]) playerGames[key] = { fantasy: [], totalPts: 0 };

        const goals = entry.goals || 0;
        const assists = entry.assists || 0;
        const shots = entry.shots_on_goal || entry.shots || 0;
        const blocked = entry.blocked_shots || entry.blocks || 0;

        const dkPts = goals * 8.5 + assists * 5.0 + shots * 1.5 + blocked * 1.3;

        playerGames[key].fantasy.push(dkPts);
        playerGames[key].totalPts += goals + assists;
      }

      if (!result.meta?.next_cursor) break;
      cursor = result.meta.next_cursor;
      pages++;
    }
  }

  const statsMap: PlayerStatsMap = {};
  for (const [key, val] of Object.entries(playerGames)) {
    const gp = val.fantasy.length;
    if (gp === 0) continue;
    const avgFantasy = val.fantasy.reduce((s, v) => s + v, 0) / gp;
    const starPower = Math.min(1, (val.totalPts / gp) / 2.0);
    const consistency = gp >= 5 ? 1.0 : gp >= 3 ? 0.85 : gp >= 2 ? 0.7 : 0.5;
    statsMap[key] = { fantasyScore: avgFantasy, starPower, consistency };
  }

  console.log(`[BDL] NHL: Fetched stats for ${Object.keys(statsMap).length} players`);
  return statsMap;
}

async function fetchMLBStats(): Promise<PlayerStatsMap> {
  const currentYear = new Date().getFullYear();
  const season = new Date().getMonth() >= 3 ? currentYear : currentYear - 1;
  const dates = await fetchRecentGameDates("MLB");

  const playerGames: Record<string, { fantasy: number[]; totalHits: number }> = {};

  for (const date of dates) {
    let cursor: number | null = null;
    let pages = 0;
    while (pages < 3) {
      const url = cursor
        ? `${BDL_BASE}/mlb/v1/stats?dates[]=${date}&per_page=100&cursor=${cursor}`
        : `${BDL_BASE}/mlb/v1/stats?dates[]=${date}&per_page=100`;
      const result = await bdlFetch<BDLResponse<any>>(url);
      if (!result || !result.data || result.data.length === 0) break;

      for (const entry of result.data) {
        if (!entry.player) continue;
        const name = `${entry.player.first_name} ${entry.player.last_name}`;
        const key = normalizeName(name);
        if (!playerGames[key]) playerGames[key] = { fantasy: [], totalHits: 0 };

        const singles = Math.max(0, (entry.hits || 0) - (entry.doubles || 0) - (entry.triples || 0) - (entry.home_runs || 0));
        const doubles = entry.doubles || 0;
        const triples = entry.triples || 0;
        const hr = entry.home_runs || 0;
        const rbi = entry.rbi || 0;
        const runs = entry.runs || 0;
        const sb = entry.stolen_bases || 0;
        const bb = entry.walks || 0;

        const dkPts = singles * 3 + doubles * 5 + triples * 8 + hr * 10 + rbi * 2 + runs * 2 + sb * 5 + bb * 2;

        playerGames[key].fantasy.push(dkPts);
        playerGames[key].totalHits += entry.hits || 0;
      }

      if (!result.meta?.next_cursor) break;
      cursor = result.meta.next_cursor;
      pages++;
    }
  }

  const statsMap: PlayerStatsMap = {};
  for (const [key, val] of Object.entries(playerGames)) {
    const gp = val.fantasy.length;
    if (gp === 0) continue;
    const avgFantasy = val.fantasy.reduce((s, v) => s + v, 0) / gp;
    const starPower = Math.min(1, (val.totalHits / gp) / 3.0);
    const consistency = gp >= 5 ? 1.0 : gp >= 3 ? 0.85 : gp >= 2 ? 0.7 : 0.5;
    statsMap[key] = { fantasyScore: avgFantasy, starPower, consistency };
  }

  console.log(`[BDL] MLB: Fetched stats for ${Object.keys(statsMap).length} players`);
  return statsMap;
}

export async function fetchBDLStats(sport: string): Promise<PlayerStatsMap> {
  const cacheKey = sport.toUpperCase();
  const cached = statsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[BDL] ${cacheKey}: Using cached stats (${Object.keys(cached.data).length} players)`);
    return cached.data;
  }

  let data: PlayerStatsMap = {};
  try {
    switch (sport.toUpperCase()) {
      case "NBA":
        data = await fetchNBAStats();
        break;
      case "NFL":
        data = await fetchNFLStats();
        break;
      case "NHL":
        data = await fetchNHLStats();
        break;
      case "MLB":
        data = await fetchMLBStats();
        break;
      default:
        console.log(`[BDL] No stats source for ${sport}, using heuristic`);
        return {};
    }

    if (Object.keys(data).length > 0) {
      statsCache.set(cacheKey, { data, timestamp: Date.now() });
    } else {
      statsCache.set(cacheKey, { data: {}, timestamp: Date.now() - CACHE_TTL + NEGATIVE_CACHE_TTL });
      console.log(`[BDL] ${cacheKey}: No data returned, negative caching for 30 min`);
    }
  } catch (err) {
    console.error(`[BDL] Error fetching ${sport} stats:`, err);
    statsCache.set(cacheKey, { data: {}, timestamp: Date.now() - CACHE_TTL + NEGATIVE_CACHE_TTL });
  }

  return data;
}

export function clearBDLCache(): void {
  statsCache.clear();
}
