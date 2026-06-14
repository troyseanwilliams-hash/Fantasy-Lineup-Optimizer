const ESPN_SCOREBOARD_URLS: Record<string, string> = {
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  GOLF: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
  SOCCER: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
};

export interface GameScore {
  id: string;
  sport: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  shortDetail: string;
  startTime: string;
  homeTeam: {
    name: string;
    abbreviation: string;
    score: string;
    logo?: string;
  };
  awayTeam: {
    name: string;
    abbreviation: string;
    score: string;
    logo?: string;
  };
  period?: number;
  clock?: string;
  venue?: string;
}

export interface GolfScore {
  id: string;
  sport: "GOLF";
  status: "pre" | "in" | "post";
  statusDetail: string;
  shortDetail: string;
  tournamentName: string;
  venue?: string;
  leaderboard: {
    playerName: string;
    position: string;
    score: string;
    round: number;
    thru: string;
  }[];
}

export type ScoreData = GameScore | GolfScore;

interface CacheEntry {
  data: ScoreData[];
  fetchedAt: number;
}

const scoreCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

function isCacheValid(sport: string): boolean {
  const entry = scoreCache.get(sport);
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

function parseTeamGame(event: any, sport: string): GameScore {
  const competition = event.competitions?.[0];
  const statusObj = event.status?.type;

  let homeTeam = { name: "", abbreviation: "", score: "0", logo: "" };
  let awayTeam = { name: "", abbreviation: "", score: "0", logo: "" };

  if (competition?.competitors) {
    for (const comp of competition.competitors) {
      const team = {
        name: comp.team?.displayName || comp.team?.name || "",
        abbreviation: comp.team?.abbreviation || "",
        score: comp.score || "0",
        logo: comp.team?.logo || "",
      };
      if (comp.homeAway === "home") {
        homeTeam = team;
      } else {
        awayTeam = team;
      }
    }
  }

  return {
    id: event.id || "",
    sport,
    status: statusObj?.state === "pre" ? "pre" : statusObj?.state === "in" ? "in" : "post",
    statusDetail: statusObj?.detail || "",
    shortDetail: statusObj?.shortDetail || "",
    startTime: event.date || "",
    homeTeam,
    awayTeam,
    period: event.status?.period,
    clock: event.status?.displayClock,
    venue: competition?.venue?.fullName,
  };
}

function parseGolfEvent(event: any): GolfScore {
  const statusObj = event.status?.type;
  const leaderboard: GolfScore["leaderboard"][] = [];

  const competitions = event.competitions || [];
  for (const comp of competitions) {
    for (const competitor of comp.competitors || []) {
      leaderboard.push({
        playerName: competitor.athlete?.displayName || "",
        position: competitor.status?.position?.displayName || competitor.status?.position?.id || "",
        score: competitor.score?.displayValue || competitor.linescores?.map((l: any) => l.displayValue).join(", ") || "E",
        round: competitor.status?.period || 1,
        thru: competitor.status?.thru?.toString() || "",
      });
    }
  }

  return {
    id: event.id || "",
    sport: "GOLF",
    status: statusObj?.state === "pre" ? "pre" : statusObj?.state === "in" ? "in" : "post",
    statusDetail: statusObj?.detail || "",
    shortDetail: statusObj?.shortDetail || "",
    tournamentName: event.name || event.shortName || "PGA Tournament",
    venue: competitions[0]?.venue?.fullName,
    leaderboard: (leaderboard as any).flat().slice(0, 20),
  };
}

async function fetchScoresFromESPN(sport: string): Promise<ScoreData[]> {
  const url = ESPN_SCOREBOARD_URLS[sport];
  if (!url) return [];

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`[ESPN] Failed to fetch ${sport} scores: ${response.status}`);
    return [];
  }

  const data = await response.json();
  const events = data.events || [];

  if (sport === "GOLF") {
    return events.map((e: any) => parseGolfEvent(e));
  }

  return events.map((e: any) => parseTeamGame(e, sport));
}

export async function getLiveScores(sport: string): Promise<ScoreData[]> {
  if (isCacheValid(sport)) {
    return scoreCache.get(sport)!.data;
  }

  try {
    const scores = await fetchScoresFromESPN(sport);
    scoreCache.set(sport, { data: scores, fetchedAt: Date.now() });
    return scores;
  } catch (err) {
    console.error(`[ESPN] Error fetching ${sport} scores:`, err);
    const cached = scoreCache.get(sport);
    if (cached) return cached.data;
    return [];
  }
}

const ESPN_SUMMARY_URLS: Record<string, string> = {
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary",
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary",
};

interface StarterCacheEntry {
  names: Set<string>;
  fetchedAt: number;
}
const starterCache = new Map<string, StarterCacheEntry>();
const STARTER_CACHE_TTL = 5 * 60 * 1000;

export async function fetchESPNStarters(sport: string): Promise<Set<string>> {
  const cacheKey = sport;
  const cached = starterCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < STARTER_CACHE_TTL) {
    return cached.names;
  }

  const summaryBase = ESPN_SUMMARY_URLS[sport];
  if (!summaryBase) return new Set();

  const starterNames = new Set<string>();

  try {
    const scores = await getLiveScores(sport);
    const gameIds = scores
      .filter((s): s is GameScore => 'homeTeam' in s)
      .filter(s => s.status === "in" || s.status === "pre")
      .map(s => s.id);

    const batchSize = 5;
    for (let i = 0; i < gameIds.length; i += batchSize) {
      const batch = gameIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (eventId) => {
          const res = await fetch(`${summaryBase}?event=${eventId}`);
          if (!res.ok) return [];
          const data = await res.json();
          const names: string[] = [];
          const bp = data.boxscore?.players || [];
          for (const team of bp) {
            for (const stat of team.statistics || []) {
              for (const a of stat.athletes || []) {
                if (a.starter && a.athlete?.displayName) {
                  names.push(a.athlete.displayName);
                }
              }
            }
          }
          const rosters = data.rosters || [];
          for (const r of rosters) {
            for (const e of r.roster || []) {
              if (e.starter && e.displayName) {
                names.push(e.displayName);
              }
            }
          }
          return names;
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const name of r.value) starterNames.add(name.toLowerCase().trim());
        }
      }
    }

    console.log(`[ESPN] ${sport}: Found ${starterNames.size} confirmed starters from ${gameIds.length} games`);
    starterCache.set(cacheKey, { names: starterNames, fetchedAt: Date.now() });
  } catch (err) {
    console.error(`[ESPN] Error fetching ${sport} starters:`, err);
  }

  return starterNames;
}

export async function getAllLiveScores(): Promise<Record<string, ScoreData[]>> {
  const sports = Object.keys(ESPN_SCOREBOARD_URLS);
  const results: Record<string, ScoreData[]> = {};

  await Promise.all(
    sports.map(async (sport) => {
      results[sport] = await getLiveScores(sport);
    })
  );

  return results;
}
