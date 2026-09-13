import type { InsertPlayer } from "@shared/schema";
import { PLATFORM_CONFIGS } from "@shared/platform-config";
import { dkProjectionBaseline } from "./dk-projection-baseline";

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
  // DraftKings currently publishes MLB classic groups as GameTypeId 2.
  // Keep the older IDs for archived/lobby variants still seen during
  // transitions between contest configurations.
  MLB: [2, 70, 177],
  NFL: [1],
  GOLF: [70, 177],
  SOCCER: [70, 177],
};

export interface DKDraftGroup {
  DraftGroupId: number;
  GameCount: number;
  StartDateEst: string;
  GameTypeId: number;
  ContestTypeId: number;
  DraftGroupTag?: string | null;
  ContestStartTimeSuffix?: string | null;
  SortOrder?: number;
  DraftGroupSeriesId?: number;
  GameType?: string | null;
  Sport?: string;
  GameSetKey?: string;
}

interface DKContest {
  id: number;
  dg: number;
  n: string;
  a?: number;
  po?: number;
  mec?: number;
  attr?: Record<string, string>;
  gameType?: string;
  gameTypeId?: number;
}

interface DKLobbyData {
  DraftGroups: DKDraftGroup[];
  Contests?: DKContest[];
}

export interface DKContestDraftGroupIdentity {
  contestId: number;
  draftGroupId: number;
  draftGroup: DKDraftGroup;
  contestName?: string;
}

export type DKContestIdentityResult =
  | { status: "resolved"; identity: DKContestDraftGroupIdentity }
  | { status: "unknown" }
  | { status: "ambiguous" }
  | { status: "unavailable" };

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

const FPPG_STAT_IDS = [219, 90, 341, 745];

function extractFppg(draftStatAttributes: Array<{ id: number; value: string; sortValue: string }> | undefined): number | null {
  if (!draftStatAttributes) return null;
  for (const id of FPPG_STAT_IDS) {
    const attr = draftStatAttributes.find(a => a.id === id);
    if (attr && attr.value && attr.value !== "-" && !isNaN(Number(attr.value))) {
      return Number(attr.value);
    }
  }
  return null;
}

export interface LiveSlateData {
  sport: string;
  slateDate: Date;
  dkPlayers: Omit<InsertPlayer, "slateId">[];
  games: Array<{ away: string; home: string; time: string; date: string }>;
  draftGroupId: number;
  gameCount?: number;
  gameType?: string;
  label?: string;
  contestId?: number;
  contestName?: string;
  contestPath?: string;
  contestUrl?: string;
}

/**
 * DraftKings has several classic groups that begin at the same time.  The
 * featured group is the app's main NFL slate; an unfeatured group with more
 * games is commonly the Sun-Mon extended slate.  Do not infer the main slate
 * from GameCount: the number of games changes every week.
 */
export function selectFeaturedClassicDraftGroup(
  groups: DKDraftGroup[],
  now = new Date(),
): DKDraftGroup | null {
  const classics = groups.filter(group =>
    Number.isFinite(group.DraftGroupId) &&
    CLASSIC_GAME_TYPES.NFL.includes(group.GameTypeId),
  );
  if (classics.length === 0) return null;

  const recentOrUpcoming = classics.filter(group => {
    const start = parseEasternTime(group.StartDateEst).getTime();
    return Number.isFinite(start) && start > now.getTime() - 3 * 60 * 60 * 1000;
  });
  const pool = recentOrUpcoming.length > 0 ? recentOrUpcoming : classics;
  const byStart = (a: DKDraftGroup, b: DKDraftGroup) => {
    const timeDiff = parseEasternTime(a.StartDateEst).getTime() -
      parseEasternTime(b.StartDateEst).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (a.SortOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.SortOrder ?? Number.MAX_SAFE_INTEGER);
  };
  const isFeatured = (group: DKDraftGroup) =>
    (group.DraftGroupTag || "").trim().toLowerCase() === "featured";
  const hasExplicitAlternateSuffix = (group: DKDraftGroup) =>
    Boolean((group.ContestStartTimeSuffix || "").trim());

  // Prefer DraftKings' own Featured marker and an unsuffixed kickoff.  This
  // deliberately selects the current featured classic group without relying
  // on a draft-group ID or a particular weekly game count.
  const featuredMain = pool
    .filter(group => isFeatured(group) && !hasExplicitAlternateSuffix(group))
    .sort(byStart);
  if (featuredMain.length > 0) return featuredMain[0];
  // Never guess a main group from game count or kickoff alone.  A lobby
  // without an explicit Featured/unsuffixed identity is not safe to seed.
  return null;
}

export function selectLargestCurrentClassicDraftGroup(
  groups: DKDraftGroup[],
  now = new Date(),
): DKDraftGroup | null {
  if (groups.length === 0) return null;

  const nowMs = now.getTime();
  const recentOrUpcoming = groups.filter(group => {
    const start = parseEasternTime(group.StartDateEst).getTime();
    return Number.isFinite(start) && start > nowMs - 3 * 60 * 60 * 1000;
  });
  const pool = recentOrUpcoming.length > 0 ? recentOrUpcoming : groups;

  // DraftKings publishes early-only, main, and late alternatives as separate
  // classic groups.  The earliest group is often a one-game MLB slate, not
  // the main slate.  Prefer the largest current group (the old behavior),
  // breaking ties by the earliest start time so that we do not select a stale
  // or extended next-day group over today's main contest.
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const nowValue = (type: string) => nowParts.find(part => part.type === type)?.value || "00";
  const today = `${nowValue("year")}-${nowValue("month")}-${nowValue("day")}`;
  const todayPool = pool.filter(group => {
    const start = parseEasternTime(group.StartDateEst);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(start);
    const value = (type: string) => parts.find(part => part.type === type)?.value || "00";
    const date = `${value("year")}-${value("month")}-${value("day")}`;
    return date === today;
  });
  const candidates = todayPool.length > 0 ? todayPool : pool;

  return [...candidates].sort((a, b) => {
    if (a.GameCount !== b.GameCount) return b.GameCount - a.GameCount;
    return parseEasternTime(a.StartDateEst).getTime() -
      parseEasternTime(b.StartDateEst).getTime();
  })[0] || null;
}

/**
 * Resolve contest IDs against the current DraftKings lobby.  A contest's
 * draft group is the only provider-owned identity we can safely use when a
 * downloaded entries CSV contains multiple slates.  Keep this separate from
 * the "featured slate" selectors above: those selectors intentionally choose
 * a default for the optimizer, while imports must never choose a default.
 *
 * The result contains an explicit status for every requested ID.  In
 * particular, an empty/failed lobby is not represented as an empty map so a
 * caller cannot accidentally treat an unavailable lookup as "not found" and
 * fall back to the first local slate.
 */
export async function resolveDKContestDraftGroups(
  sport: string,
  contestIds: number[],
): Promise<Map<number, DKContestIdentityResult>> {
  const requested = Array.from(new Set(contestIds.filter(id => Number.isSafeInteger(id) && id > 0)));
  const results = new Map<number, DKContestIdentityResult>();

  if (requested.length === 0) return results;

  let lobby: DKLobbyData;
  try {
    lobby = await fetchDKLobby(sport);
  } catch (error) {
    console.error(`[DK] Error fetching ${sport} lobby for contest import:`, error);
    for (const contestId of requested) results.set(contestId, { status: "unavailable" });
    return results;
  }

  const groupsById = new Map<number, DKDraftGroup[]>();
  for (const group of lobby.DraftGroups || []) {
    if (!Number.isSafeInteger(group.DraftGroupId)) continue;
    const groups = groupsById.get(group.DraftGroupId) || [];
    groups.push(group);
    groupsById.set(group.DraftGroupId, groups);
  }

  if (!Array.isArray(lobby.Contests)) {
    for (const contestId of requested) results.set(contestId, { status: "unavailable" });
    return results;
  }

  for (const contestId of requested) {
    const contests = lobby.Contests.filter(contest => Number(contest.id) === contestId);
    if (contests.length === 0) {
      results.set(contestId, { status: "unknown" });
      continue;
    }
    if (contests.length !== 1) {
      results.set(contestId, { status: "ambiguous" });
      continue;
    }

    const contest = contests[0];
    const groups = groupsById.get(Number(contest.dg)) || [];
    if (groups.length === 0) {
      results.set(contestId, { status: "unavailable" });
      continue;
    }
    if (groups.length !== 1) {
      results.set(contestId, { status: "ambiguous" });
      continue;
    }

    results.set(contestId, {
      status: "resolved",
      identity: {
        contestId,
        draftGroupId: Number(contest.dg),
        draftGroup: groups[0],
        contestName: contest.n,
      },
    });
  }

  return results;
}

export function isClassicDKDraftGroup(sport: string, group: DKDraftGroup): boolean {
  const validTypes = CLASSIC_GAME_TYPES[sport] || [70];
  return validTypes.includes(group.GameTypeId);
}

function contestPath(contestId: number): string {
  return `/contest/draftentry?contestId=${encodeURIComponent(contestId)}`;
}

function contestsForDraftGroup(contests: DKContest[] | undefined, draftGroupId: number): DKContest[] {
  return (contests || [])
    .filter(contest => contest.dg === draftGroupId && Number.isFinite(contest.id))
    .sort((a, b) => {
      // A named featured contest is a useful target for UI deep links, while
      // preserving every contest count from the public lobby metadata.
      const aNamed = /\b(first down|main)\b/i.test(a.n || "") ? 1 : 0;
      const bNamed = /\b(first down|main)\b/i.test(b.n || "") ? 1 : 0;
      if (aNamed !== bNamed) return bNamed - aNamed;
      const aStarred = a.attr?.IsStarred === "true" ? 1 : 0;
      const bStarred = b.attr?.IsStarred === "true" ? 1 : 0;
      if (aStarred !== bStarred) return bStarred - aStarred;
      return (b.po || 0) - (a.po || 0);
    });
}

function metadataForDraftGroup(
  group: DKDraftGroup,
  contests: DKContest[] | undefined,
  isMain = false,
): AvailableDKSlate {
  const groupContests = contestsForDraftGroup(contests, group.DraftGroupId);
  const representative = groupContests[0];
  const date = parseEasternTime(group.StartDateEst);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const suffix = (group.ContestStartTimeSuffix || "").trim();
  const tag = (group.DraftGroupTag || "").trim();
  const prefix = tag || (isMain ? "Main" : "Classic");
  const label = `${prefix} (${group.GameCount} game${group.GameCount !== 1 ? "s" : ""}) - ${dateStr} ${formatGameTime(group.StartDateEst)}${suffix}`;
  const selectedContestId = representative?.id;

  return {
    draftGroupId: group.DraftGroupId,
    gameCount: group.GameCount,
    startTime: group.StartDateEst,
    label,
    gameTypeId: group.GameTypeId,
    contestTypeId: group.ContestTypeId,
    draftGroupTag: tag || null,
    contestStartTimeSuffix: suffix || null,
    isFeatured: tag.toLowerCase() === "featured",
    isMain,
    contestCount: groupContests.length,
    contestId: selectedContestId,
    contestName: representative?.n,
    contestEntryFee: representative?.a,
    contestPrizePool: representative?.po,
    contestPath: selectedContestId == null ? undefined : contestPath(selectedContestId),
    contestUrl: selectedContestId == null
      ? undefined
      : `https://www.draftkings.com${contestPath(selectedContestId)}`,
  };
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

// Keep the exact provider timestamp in the existing gameInfo column.  The
// displayed ET time is not enough to distinguish a Monday game in a Sun-Mon
// slate from a Sunday game at the same clock time.
function withCompetitionTimestamp(gameInfo: string, competitionStartTime: string): string {
  return `${gameInfo} [DK_START:${competitionStartTime}]`;
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

async function fetchDKLobby(sport: string): Promise<DKLobbyData> {
  const dkSport = SPORT_MAP[sport] || sport;
  return fetchJSON<DKLobbyData>(`${DK_LOBBY}/getcontests?sport=${dkSport}`);
}

export async function findMainSlate(sport: string): Promise<DKDraftGroup | null> {
  try {
    const data = await fetchDKLobby(sport);
    if (!data.DraftGroups || data.DraftGroups.length === 0) return null;

    const validTypes = CLASSIC_GAME_TYPES[sport] || [70];
    const classics = data.DraftGroups.filter(g => validTypes.includes(g.GameTypeId));
    if (classics.length === 0) {
      // Preserve the fallback for lobbies that publish a new classic type
      // before the map above is updated.  Do not select the earliest group:
      // that is commonly a one-game Showdown group and cannot fill a classic
      // MLB roster under the salary cap.
      return selectLargestCurrentClassicDraftGroup(data.DraftGroups);
    }
    if (sport === "NFL") return selectFeaturedClassicDraftGroup(classics);

    return selectLargestCurrentClassicDraftGroup(classics);
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

  let lobby: DKLobbyData;
  try {
    lobby = await fetchDKLobby(sport);
  } catch (err) {
    console.error(`[DK] Error fetching ${sport} lobby:`, err);
    return null;
  }
  const validTypes = CLASSIC_GAME_TYPES[sport] || [70];
  const classicGroups = (lobby.DraftGroups || []).filter(g => validTypes.includes(g.GameTypeId));
  const mainSlate = sport === "NFL"
    ? selectFeaturedClassicDraftGroup(classicGroups)
    : await findMainSlate(sport);
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

  if (sport === "GOLF" && uniquePlayers.every(p => !p.salary || p.salary <= 0) && uniquePlayers.length > 0) {
    const maxSal = 12000;
    const minSal = 6000;
    const step = uniquePlayers.length > 1 ? (maxSal - minSal) / (uniquePlayers.length - 1) : 0;
    uniquePlayers.forEach((p, i) => {
      p.salary = Math.round((maxSal - step * i) / 100) * 100;
    });
    console.log(`[DK] GOLF: Assigned estimated salaries ($${minSal}-$${maxSal}) to ${uniquePlayers.length} players (DK salaries not yet published)`);
  }

  const validPlayers = uniquePlayers.filter(p => p.salary && p.salary > 0 && p.position);
  const sortedPlayers = validPlayers.sort((a, b) => b.salary - a.salary);
  const maxPlayers = sport === "MLB" ? 250 : sport === "NFL" ? 150 : sport === "SOCCER" ? 200 : 250;
  // NFL salary sorting places required DST and value players below the old cap.
  const trimmedPlayers = sport === "NFL" ? sortedPlayers : sortedPlayers.slice(0, maxPlayers);

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

    const { fppg, projectedPoints } = dkProjectionBaseline(
      sport, p.position, p.salary, extractFppg(p.draftStatAttributes),
    );

    let opponent = "TBD";
    let gameInfo = `${p.teamAbbreviation} TBD`;

    if (p.competition) {
      const time = formatGameTime(p.competition.startTime);
      if (sport === "GOLF") {
        opponent = "";
        gameInfo = withCompetitionTimestamp(`${p.competition.name} @ ${time}`, p.competition.startTime);
      } else {
        const parts = p.competition.name.split(" @ ");
        const away = parts[0]?.trim() || "";
        const home = parts[1]?.trim() || "";
        opponent = p.teamAbbreviation === home ? away : home;
        gameInfo = withCompetitionTimestamp(`${away} @ ${home} ${time}`, p.competition.startTime);
      }
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
    gameCount: mainSlate.GameCount,
    gameType: mainSlate.GameType || (sport === "NFL" ? "Classic" : undefined),
    label: metadataForDraftGroup(mainSlate, lobby.Contests, true).label,
    contestId: metadataForDraftGroup(mainSlate, lobby.Contests, true).contestId,
    contestName: metadataForDraftGroup(mainSlate, lobby.Contests, true).contestName,
    contestPath: metadataForDraftGroup(mainSlate, lobby.Contests, true).contestPath,
    contestUrl: metadataForDraftGroup(mainSlate, lobby.Contests, true).contestUrl,
  };
}

export async function fetchAllSportsLiveData(): Promise<Map<string, LiveSlateData>> {
  const results = new Map<string, LiveSlateData>();

  for (const sport of ["NHL", "MLB", "NFL", "GOLF", "SOCCER"]) {
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
  contestTypeId: number;
  draftGroupTag: string | null;
  contestStartTimeSuffix: string | null;
  isFeatured: boolean;
  isMain: boolean;
  contestCount: number;
  contestId?: number;
  contestName?: string;
  contestEntryFee?: number;
  contestPrizePool?: number;
  contestPath?: string;
  contestUrl?: string;
}

const SHOWDOWN_GAME_TYPES = [96, 192, 354, 108, 110];

export async function fetchAvailableDKShowdowns(sport: string): Promise<AvailableDKSlate[]> {
  try {
    const data = await fetchDKLobby(sport);
    const todayET = getEasternToday();

    return (data.DraftGroups || [])
      .filter(g => SHOWDOWN_GAME_TYPES.includes(g.GameTypeId))
      .filter(g => {
        const start = parseEasternTime(g.StartDateEst);
        return start.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === todayET;
      })
      .sort((a, b) => {
        const timeDiff = parseEasternTime(a.StartDateEst).getTime() - parseEasternTime(b.StartDateEst).getTime();
        if (timeDiff !== 0) return timeDiff;
        return SHOWDOWN_GAME_TYPES.indexOf(a.GameTypeId) - SHOWDOWN_GAME_TYPES.indexOf(b.GameTypeId);
      })
      .map(g => {
        const metadata = metadataForDraftGroup(g, data.Contests);
        return {
          ...metadata,
          label: `NFL Showdown — ${parseEasternTime(g.StartDateEst).toLocaleDateString("en-US", {
            month: "numeric",
            day: "numeric",
            year: "numeric",
            timeZone: "America/New_York",
          })}`,
        };
      });
  } catch (err) {
    console.error(`[DK] Error fetching ${sport} showdown slates:`, err);
    return [];
  }
}

export async function fetchAvailableDKSlates(sport: string): Promise<AvailableDKSlate[]> {
  try {
    const data = await fetchDKLobby(sport);
    if (!data.DraftGroups || data.DraftGroups.length === 0) return [];

    const validTypes = CLASSIC_GAME_TYPES[sport] || [70];
    const classics = data.DraftGroups.filter(g => validTypes.includes(g.GameTypeId));
    const main = sport === "NFL"
      ? selectFeaturedClassicDraftGroup(classics)
      : selectLargestCurrentClassicDraftGroup(classics);

    return classics
      .map(g => metadataForDraftGroup(g, data.Contests, g.DraftGroupId === main?.DraftGroupId))
      .sort((a, b) => {
        if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
        const timeDiff = parseEasternTime(a.startTime).getTime() - parseEasternTime(b.startTime).getTime();
        return timeDiff || a.gameCount - b.gameCount;
      });
  } catch (err) {
    console.error(`[DK] Error fetching available ${sport} slates:`, err);
    return [];
  }
}

export async function fetchDKSlateByDraftGroup(
  sport: string,
  draftGroupId: number,
  options: { showdown?: boolean; startTime?: string } = {},
): Promise<LiveSlateData | null> {
  try {
    console.log(`[DK] Fetching slate data for ${sport} DraftGroup ${draftGroupId}...`);

    const draftables = await fetchDraftables(draftGroupId);
    if (!draftables || draftables.length === 0) {
      console.log(`[DK] No draftables found for DraftGroup ${draftGroupId}`);
      return null;
    }

    let uniquePlayers: DKDraftable[];
    if (options.showdown) {
      const playersById = new Map<number, DKDraftable[]>();
      for (const player of draftables) {
        const entries = playersById.get(player.playerId) || [];
        entries.push(player);
        playersById.set(player.playerId, entries);
      }
      // DraftKings exposes separate captain and flex entries for Showdown.
      // Store the flex-priced row; the optimizer applies the captain multiplier.
      uniquePlayers = Array.from(playersById.values(), entries =>
        entries.reduce((lowestSalary, entry) =>
          entry.salary < lowestSalary.salary ? entry : lowestSalary,
        ),
      );
    } else {
      const seen = new Set<number>();
      uniquePlayers = draftables.filter(p => {
        if (seen.has(p.playerId)) return false;
        seen.add(p.playerId);
        return true;
      });
    }

    if (sport === "GOLF" && uniquePlayers.every(p => !p.salary || p.salary <= 0) && uniquePlayers.length > 0) {
      const maxSal = 12000;
      const minSal = 6000;
      const step = uniquePlayers.length > 1 ? (maxSal - minSal) / (uniquePlayers.length - 1) : 0;
      uniquePlayers.forEach((p, i) => {
        p.salary = Math.round((maxSal - step * i) / 100) * 100;
      });
      console.log(`[DK] GOLF: Assigned estimated salaries ($${minSal}-$${maxSal}) to ${uniquePlayers.length} players (alt slate DG ${draftGroupId})`);
    }

    const validPlayers = uniquePlayers.filter(p => p.salary && p.salary > 0 && p.position);
    const sortedPlayers = validPlayers.sort((a, b) => b.salary - a.salary);
    const maxPlayers = sport === "MLB" ? 250 : sport === "NFL" ? 150 : sport === "SOCCER" ? 200 : 250;
    const trimmedPlayers = sport === "NFL" ? sortedPlayers : sortedPlayers.slice(0, maxPlayers);

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

    // Draftables are not ordered by the lobby's slate start.  In particular,
    // an extended Sun-Mon group can return a Monday player first.  Callers
    // pass the authoritative DraftGroups StartDateEst from the lobby.
    let authoritativeStartTime = options.startTime;
    if (!authoritativeStartTime) {
      try {
        const lobby = await fetchDKLobby(sport);
        authoritativeStartTime = lobby.DraftGroups
          ?.find(group => group.DraftGroupId === draftGroupId)
          ?.StartDateEst;
      } catch (error) {
        console.warn(`[DK] Could not resolve lobby start for DraftGroup ${draftGroupId}:`, error);
      }
    }
    if (!authoritativeStartTime) {
      console.error(`[DK] No authoritative lobby start for DraftGroup ${draftGroupId}; refusing to infer slate start from draftable order`);
      return null;
    }
    const slateDate = parseEasternTime(authoritativeStartTime);
    if (!Number.isFinite(slateDate.getTime())) {
      console.error(`[DK] Invalid lobby start for DraftGroup ${draftGroupId}: ${authoritativeStartTime}`);
      return null;
    }

    const dkPlayers: Omit<InsertPlayer, "slateId">[] = [];

    for (const p of trimmedPlayers) {
      if (!p.position || !p.salary || p.salary <= 0) continue;

      const { fppg, projectedPoints } = dkProjectionBaseline(
        sport, p.position, p.salary, extractFppg(p.draftStatAttributes), options.showdown,
      );

      let opponent = "TBD";
      let gameInfo = `${p.teamAbbreviation} TBD`;

      if (p.competition) {
        const parts = p.competition.name.split(" @ ");
        const away = parts[0]?.trim() || "";
        const home = parts[1]?.trim() || "";
        const time = formatGameTime(p.competition.startTime);
        opponent = p.teamAbbreviation === home ? away : home;
        gameInfo = withCompetitionTimestamp(`${away} @ ${home} ${time}`, p.competition.startTime);
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
