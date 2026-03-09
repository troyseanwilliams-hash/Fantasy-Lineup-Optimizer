import type { InsertPlayer } from "@shared/schema";
import { PLATFORM_CONFIGS } from "@shared/platform-config";

const DK_API_BASE = "https://api.draftkings.com";
const DK_LOBBY = "https://www.draftkings.com/lobby";

const DK_STATUS_MAP: Record<string, string> = {
  "O": "OUT",
  "Out": "OUT",
  "OUT": "OUT",
  "Q": "Questionable",
  "Questionable": "Questionable",
  "D": "Doubtful",
  "Doubtful": "Doubtful",
  "P": "Probable",
  "Probable": "Probable",
  "GTD": "Questionable",
  "DTD": "Questionable",
  "Day-To-Day": "Questionable",
  "IR": "OUT",
  "Injured Reserve": "OUT",
  "Suspended": "OUT",
  "": "Healthy",
  "None": "Healthy",
};

const DK_NEWS_ONLY_STATUSES = new Set(["Breaking", "Recent", "Normal", "Latest"]);

export function mapDKStatus(status: string, _newsStatus: string): { injuryStatus: string; injuryDetail: string } {
  const statusMapped = DK_STATUS_MAP[status];

  if (statusMapped && statusMapped !== "Healthy") {
    return { injuryStatus: statusMapped, injuryDetail: status };
  }

  return { injuryStatus: "Healthy", injuryDetail: "" };
}

export async function fetchLivePlayerStatuses(draftGroupId: number): Promise<Map<number, string>> {
  const statusMap = new Map<number, string>();
  try {
    const draftables = await fetchDraftables(draftGroupId);
    for (const p of draftables) {
      if (!p.draftableId) continue;
      const mapped = DK_STATUS_MAP[p.status || ""];
      if (mapped && mapped !== "Healthy") {
        statusMap.set(p.draftableId, mapped);
      }
    }
    console.log(`[DK] Live status check for DG ${draftGroupId}: ${statusMap.size} players with injury designations`);
  } catch (err) {
    console.error(`[DK] Failed to fetch live statuses for DG ${draftGroupId}:`, err);
  }
  return statusMap;
}

export function parseEasternTime(dateStr: string): Date {
  const hasTimezone = /Z$/i.test(dateStr.trim()) || /[+-]\d{2}:\d{2}$/.test(dateStr.trim());
  if (hasTimezone) {
    return new Date(dateStr);
  }
  const cleaned = dateStr.replace(/\.0+$/, "");
  const asUtc = new Date(cleaned + "Z");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(asUtc);
  const g = (t: string) => parts.find(p => p.type === t)?.value || "00";
  const etAtUtc = new Date(`${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}Z`);
  const offsetMs = asUtc.getTime() - etAtUtc.getTime();
  return new Date(asUtc.getTime() + offsetMs);
}

export function formatToET(utcDate: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return formatter.format(utcDate) + " ET";
}

export function getEasternToday(): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || "01";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

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
  playerGameAttributes: Array<{
    id: number;
    value: string;
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

function formatGameTime(etTimeStr: string): string {
  try {
    const etDate = parseEasternTime(etTimeStr);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return formatter.format(etDate) + " ET";
  } catch {
    return "7:00 PM ET";
  }
}

export function isPlayerConfirmedStarter(p: { playerGameAttributes?: Array<{ id: number; value: string }> }): boolean {
  if (!p.playerGameAttributes || p.playerGameAttributes.length === 0) return false;
  for (const attr of p.playerGameAttributes) {
    if (attr.id === 2 && (attr.value || "").toLowerCase() === "true") {
      return true;
    }
  }
  return false;
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

export async function fetchDraftables(draftGroupId: number): Promise<DKDraftable[]> {
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
      const gameUtc = parseEasternTime(p.competition.startTime);
      const dateFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "2-digit", day: "2-digit",
      });
      const dp = dateFmt.formatToParts(gameUtc);
      const dg = (t: string) => dp.find(x => x.type === t)?.value || "01";
      const date = `${dg("year")}-${dg("month")}-${dg("day")}`;
      games.set(p.competition.competitionId, { away, home, time, date });
    }
  }

  const slateDate = parseEasternTime(mainSlate.StartDateEst);

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
    const { injuryStatus, injuryDetail } = mapDKStatus(p.status || "", p.newsStatus || "");

    const isConfirmedStarter = isPlayerConfirmedStarter(p);

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
      injuryStatus: injuryStatus !== "Healthy" ? injuryStatus : undefined,
      injuryDetail: injuryDetail || undefined,
      isConfirmedStarter,
    });
  }

  const injuredCount = dkPlayers.filter(p => p.injuryStatus && p.injuryStatus !== "Healthy").length;
  const starterCount = dkPlayers.filter(p => p.isConfirmedStarter).length;
  console.log(`[DK] ${sport}: Processed ${dkPlayers.length} DK players (${injuredCount} with injury status, ${starterCount} confirmed starters)`);

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
  const etToday = getEasternToday();
  const base = new Date(etToday + "T12:00:00Z");
  base.setDate(base.getDate() + daysAhead);
  const futureDate = base.toISOString().split("T")[0];
  return parseEasternTime(`${futureDate}T19:00:00`);
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

export interface AvailableDKSlate {
  draftGroupId: number;
  gameCount: number;
  startTime: string;
  label: string;
  gameTypeId: number;
}

export async function fetchAvailableDKSlates(sport: string): Promise<AvailableDKSlate[]> {
  try {
    const dkSport = SPORT_MAP[sport] || sport;
    const data = await fetchJSON<{ DraftGroups: DKDraftGroup[] }>(
      `${DK_LOBBY}/getcontests?sport=${dkSport}`
    );
    if (!data.DraftGroups || data.DraftGroups.length === 0) return [];

    const validTypes = CLASSIC_GAME_TYPES[sport] || [70];

    const classics = data.DraftGroups
      .filter(g => validTypes.includes(g.GameTypeId))
      .sort((a, b) => b.GameCount - a.GameCount);

    return classics.map((g, idx) => {
      const startDate = parseEasternTime(g.StartDateEst);
      const timeStr = formatGameTime(g.StartDateEst);
      const dateStr = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
      const prefix = idx === 0 ? "Main" : `Slate ${idx + 1}`;
      const label = `${prefix} (${g.GameCount} game${g.GameCount !== 1 ? "s" : ""}) - ${dateStr} ${timeStr}`;

      return {
        draftGroupId: g.DraftGroupId,
        gameCount: g.GameCount,
        startTime: g.StartDateEst,
        label,
        gameTypeId: g.GameTypeId,
      };
    });
  } catch (err) {
    console.error(`[DK] Error fetching available ${sport} slates:`, err);
    return [];
  }
}

export async function fetchDKSlateByDraftGroup(sport: string, draftGroupId: number): Promise<LiveSlateData | null> {
  try {
    console.log(`[DK] Fetching slate data for ${sport} DraftGroup ${draftGroupId}...`);

    const draftables = await fetchDraftables(draftGroupId);
    if (!draftables || draftables.length === 0) {
      console.log(`[DK] No draftables found for DraftGroup ${draftGroupId}`);
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

    const games = new Map<number, { away: string; home: string; time: string; date: string }>();
    for (const p of uniquePlayers) {
      if (p.competition && !games.has(p.competition.competitionId)) {
        const parts = p.competition.name.split(" @ ");
        const away = parts[0]?.trim() || "";
        const home = parts[1]?.trim() || "";
        const time = formatGameTime(p.competition.startTime);
        const gameUtc = parseEasternTime(p.competition.startTime);
        const dateFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          year: "numeric", month: "2-digit", day: "2-digit",
        });
        const dp = dateFmt.formatToParts(gameUtc);
        const dg = (t: string) => dp.find(x => x.type === t)?.value || "01";
        const date = `${dg("year")}-${dg("month")}-${dg("day")}`;
        games.set(p.competition.competitionId, { away, home, time, date });
      }
    }

    let slateDate = new Date();
    if (draftables[0]?.competition?.startTime) {
      slateDate = parseEasternTime(draftables[0].competition.startTime);
    }

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
      const { injuryStatus, injuryDetail } = mapDKStatus(p.status || "", p.newsStatus || "");

      const isConfirmedStarter = isPlayerConfirmedStarter(p);

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
        injuryStatus: injuryStatus !== "Healthy" ? injuryStatus : undefined,
        injuryDetail: injuryDetail || undefined,
        isConfirmedStarter,
      });
    }

    const starterCount = dkPlayers.filter(p => p.isConfirmedStarter).length;
    console.log(`[DK] DraftGroup ${draftGroupId}: Processed ${dkPlayers.length} players from ${games.size} games (${starterCount} confirmed starters)`);

    return {
      sport,
      slateDate,
      dkPlayers,
      games: Array.from(games.values()),
      draftGroupId,
    };
  } catch (err) {
    console.error(`[DK] Error fetching DraftGroup ${draftGroupId}:`, err);
    return null;
  }
}
