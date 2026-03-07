import type { InsertPlayer } from "@shared/schema";
import { PLATFORM_CONFIGS } from "@shared/platform-config";

const DK_API_BASE = "https://api.draftkings.com";
const DK_LOBBY = "https://www.draftkings.com/lobby";

const SPORT_MAP: Record<string, string> = {
  NBA: "NBA",
  NHL: "NHL",
  MLB: "MLB",
  NFL: "NFL",
  GOLF: "GOLF",
  SOCCER: "SOC",
};

const CLASSIC_GAME_TYPES: Record<string, number[]> = {
  NBA: [70],
  NHL: [125, 70],
  MLB: [70, 177],
  NFL: [70, 158],
  GOLF: [70, 177],
  SOCCER: [70, 177],
};

interface DKDraftGroup {
  DraftGroupId: number;
  GameCount: number;
  StartDateEst: string;
  GameTypeId: number;
  ContestTypeId: number;
}

interface DKDraftable {
  draftableId: number;
  firstName: string;
  lastName: string;
  displayName: string;
  playerId: number;
  position: string;
  salary: number;
  status: string;
  newsStatus: string;
  teamAbbreviation: string;
  teamId: number;
  competition: {
    competitionId: number;
    name: string;
    startTime: string;
  } | null;
  draftStatAttributes: Array<{
    id: number;
    value: string;
    sortValue: string;
  }>;
}

export interface LiveSlateData {
  sport: string;
  slateDate: Date;
  dkPlayers: Omit<InsertPlayer, "slateId">[];
  games: Array<{ away: string; home: string; time: string; date: string }>;
  draftGroupId: number;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; EliteLineupAI/1.0)",
    },
  });
  if (!res.ok) {
    throw new Error(`DK API error: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json() as Promise<T>;
}

function formatGameTime(utcTimeStr: string): string {
  try {
    const d = new Date(utcTimeStr);
    const etHours = d.getUTCHours() - 5;
    const adjustedHours = etHours < 0 ? etHours + 24 : etHours;
    const period = adjustedHours >= 12 ? "PM" : "AM";
    const h = adjustedHours > 12 ? adjustedHours - 12 : adjustedHours === 0 ? 12 : adjustedHours;
    return `${h}:${d.getUTCMinutes().toString().padStart(2, "0")}${period} ET`;
  } catch {
    return "7:00PM ET";
  }
}

function mapDKPosition(sport: string, pos: string): string {
  if (sport === "NBA") {
    const mapping: Record<string, string> = {
      PG: "PG", SG: "SG", SF: "SF", PF: "PF", C: "C",
      G: "PG/SG", F: "SF/PF", UTIL: "UTIL",
    };
    return mapping[pos] || pos;
  }
  if (sport === "SOCCER") {
    const mapping: Record<string, string> = {
      F: "F", M: "M", D: "D", GK: "GK",
      FWD: "F", MF: "M", MID: "M", DEF: "D",
      UTIL: "UTIL",
    };
    return mapping[pos] || pos;
  }
  return pos;
}

async function findMainSlate(sport: string): Promise<DKDraftGroup | null> {
  try {
    const dkSport = SPORT_MAP[sport] || sport;
    const data = await fetchJSON<{ DraftGroups: DKDraftGroup[] }>(
      `${DK_LOBBY}/getcontests?sport=${dkSport}`
    );
    if (!data.DraftGroups || data.DraftGroups.length === 0) return null;

    const validTypes = CLASSIC_GAME_TYPES[sport] || [70];

    const classics = data.DraftGroups
      .filter(g => validTypes.includes(g.GameTypeId))
      .sort((a, b) => b.GameCount - a.GameCount);

    if (classics.length > 0) return classics[0];

    const fallback = data.DraftGroups
      .sort((a, b) => b.GameCount - a.GameCount);
    return fallback[0] || null;
  } catch (err) {
    console.error(`[DK] Error finding ${sport} slate:`, err);
    return null;
  }
}

async function fetchDraftables(draftGroupId: number): Promise<DKDraftable[]> {
  const data = await fetchJSON<{ draftables: DKDraftable[] }>(
    `${DK_API_BASE}/draftgroups/v1/draftgroups/${draftGroupId}/draftables`
  );
  return data.draftables || [];
}

export async function fetchLiveDKData(sport: string): Promise<LiveSlateData | null> {
  console.log(`[DK] Fetching live ${sport} data...`);

  const mainSlate = await findMainSlate(sport);
  if (!mainSlate) {
    console.log(`[DK] No ${sport} slate found`);
    return null;
  }

  console.log(`[DK] Found ${sport} slate: DraftGroup ${mainSlate.DraftGroupId}, ${mainSlate.GameCount} games, starts ${mainSlate.StartDateEst}`);

  const draftables = await fetchDraftables(mainSlate.DraftGroupId);
  if (!draftables || draftables.length === 0) {
    console.log(`[DK] No draftables found for ${sport} slate`);
    return null;
  }

  const seen = new Set<number>();
  const uniquePlayers = draftables.filter(p => {
    if (seen.has(p.playerId)) return false;
    seen.add(p.playerId);
    return true;
  });

  const validPlayers = uniquePlayers.filter(p => p.salary && p.salary > 0 && p.position);
  const sortedPlayers = validPlayers.sort((a, b) => b.salary - a.salary);
  const maxPlayers = sport === "MLB" ? 250 : sport === "NFL" ? 150 : sport === "SOCCER" ? 200 : 250;
  const trimmedPlayers = sortedPlayers.slice(0, maxPlayers);

  console.log(`[DK] ${sport}: ${trimmedPlayers.length} players (of ${uniquePlayers.length} unique) from ${mainSlate.GameCount} games`);

  const games = new Map<number, { away: string; home: string; time: string; date: string }>();
  for (const p of uniquePlayers) {
    if (p.competition && !games.has(p.competition.competitionId)) {
      const parts = p.competition.name.split(" @ ");
      const away = parts[0]?.trim() || "";
      const home = parts[1]?.trim() || "";
      const time = formatGameTime(p.competition.startTime);
      const date = p.competition.startTime.split("T")[0];
      games.set(p.competition.competitionId, { away, home, time, date });
    }
  }

  const slateDate = new Date(mainSlate.StartDateEst);

  const dkPlayers: Omit<InsertPlayer, "slateId">[] = [];

  for (const p of trimmedPlayers) {
    if (!p.position || !p.salary || p.salary <= 0) continue;

    const fppgAttr = p.draftStatAttributes?.find(a => a.id === 219);
    const rawFppg = fppgAttr?.value;
    const fppgNum = rawFppg && rawFppg !== "-" && !isNaN(Number(rawFppg)) ? Number(rawFppg) : (p.salary / 250);
    const fppg = fppgNum.toFixed(1);
    const projectedPoints = fppg;

    let opponent = "TBD";
    let gameInfo = `${p.teamAbbreviation} TBD`;

    if (p.competition) {
      const parts = p.competition.name.split(" @ ");
      const away = parts[0]?.trim() || "";
      const home = parts[1]?.trim() || "";
      const time = formatGameTime(p.competition.startTime);
      opponent = p.teamAbbreviation === home ? away : home;
      gameInfo = `${away} @ ${home} ${time}`;
    }

    const dkPos = mapDKPosition(sport, p.position);

    dkPlayers.push({
      name: p.displayName,
      team: p.teamAbbreviation,
      position: dkPos,
      salary: p.salary,
      fppg,
      projectedPoints,
      opponent,
      gameInfo,
      draftKingsPlayerId: p.draftableId,
    });
  }

  console.log(`[DK] ${sport}: Processed ${dkPlayers.length} DK players`);

  return {
    sport,
    slateDate,
    dkPlayers,
    games: Array.from(games.values()),
    draftGroupId: mainSlate.DraftGroupId,
  };
}

export async function fetchAllSportsLiveData(): Promise<Map<string, LiveSlateData>> {
  const results = new Map<string, LiveSlateData>();

  for (const sport of ["NBA", "NHL", "MLB", "NFL", "GOLF", "SOCCER"]) {
    try {
      const data = await fetchLiveDKData(sport);
      if (data && data.dkPlayers.length >= 10) {
        results.set(sport, data);
      } else {
        console.log(`[DK] ${sport}: Insufficient data or no active slate`);
      }
    } catch (err) {
      console.error(`[DK] Error fetching ${sport}:`, err);
    }
  }

  return results;
}

export async function fetchPlayerStatusUpdates(draftGroupId: number): Promise<Map<number, { status: string; newsStatus: string }>> {
  const results = new Map<number, { status: string; newsStatus: string }>();
  try {
    const draftables = await fetchDraftables(draftGroupId);
    for (const p of draftables) {
      if (p.draftableId) {
        results.set(p.draftableId, {
          status: p.status || "",
          newsStatus: p.newsStatus || "",
        });
      }
    }
  } catch (err) {
    console.error(`[DK] Error fetching status updates for draft group ${draftGroupId}:`, err);
  }
  return results;
}

function generateRollingDate(daysAhead: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(19, 0, 0, 0);
  return d;
}

export function getRollingSlateDate(sport: string): Date {
  switch (sport) {
    case "NBA": return generateRollingDate(2);
    case "NHL": return generateRollingDate(3);
    case "MLB": return generateRollingDate(3);
    case "NFL": return generateRollingDate(4);
    case "GOLF": return generateRollingDate(2);
    case "SOCCER": return generateRollingDate(2);
    default: return generateRollingDate(3);
  }
}
