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

interface ActivityCache {
  recentlyPlayed: Set<string>;
  fetchedAt: number;
}

const activityCache = new Map<string, ActivityCache>();
const CACHE_TTL = 4 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 5;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getRecentDates(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0].replace(/-/g, ""));
  }
  return dates;
}

async function fetchCompletedGameIds(sport: string): Promise<string[]> {
  const baseUrl = ESPN_SCOREBOARD_URLS[sport];
  if (!baseUrl) return [];

  const dates = getRecentDates(LOOKBACK_DAYS);
  const gameIds: string[] = [];

  for (const date of dates) {
    try {
      const res = await fetch(`${baseUrl}?dates=${date}`);
      if (!res.ok) continue;
      const data = await res.json();
      const events = data.events || [];
      for (const event of events) {
        if (event.status?.type?.completed) {
          gameIds.push(event.id);
        }
      }
    } catch (err) {
      console.error(`[ESPN Activity] Failed to fetch ${sport} scoreboard for ${date}:`, err);
    }
  }

  return gameIds;
}

async function fetchPlayersFromBoxscore(sport: string, gameId: string): Promise<string[]> {
  const baseUrl = ESPN_SUMMARY_URLS[sport];
  if (!baseUrl) return [];

  try {
    const res = await fetch(`${baseUrl}?event=${gameId}`);
    if (!res.ok) return [];
    const data = await res.json();

    const players: string[] = [];
    const boxscore = data.boxscore;
    if (!boxscore?.players) return [];

    for (const team of boxscore.players) {
      for (const statGroup of team.statistics || []) {
        for (const athlete of statGroup.athletes || []) {
          const name = athlete.athlete?.displayName;
          if (name) {
            const didPlay = checkPlayerPlayed(sport, athlete, statGroup);
            if (didPlay) {
              players.push(normalizeName(name));
            }
          }
        }
      }
    }

    return players;
  } catch (err) {
    return [];
  }
}

function checkPlayerPlayed(sport: string, athlete: any, statGroup: any): boolean {
  const stats = athlete.stats;
  const labels = statGroup.labels;
  if (!stats || !labels) return true;

  if (sport === "NBA") {
    const minIdx = labels.indexOf("MIN");
    if (minIdx >= 0) {
      const mins = parseInt(stats[minIdx]) || 0;
      return mins > 0;
    }
  }

  if (sport === "NHL") {
    if (statGroup.name === "goalies") return true;
    const toiIdx = labels.indexOf("TOI");
    if (toiIdx >= 0) {
      const toi = stats[toiIdx];
      return toi && toi !== "0:00" && toi !== "0";
    }
  }

  if (sport === "MLB") {
    const abIdx = labels.indexOf("AB");
    const ipIdx = labels.indexOf("IP");
    if (abIdx >= 0) {
      return (parseInt(stats[abIdx]) || 0) > 0;
    }
    if (ipIdx >= 0) {
      return parseFloat(stats[ipIdx]) > 0;
    }
  }

  if (sport === "NFL") {
    return true;
  }

  return true;
}

export async function refreshRecentlyPlayed(sport: string): Promise<Set<string>> {
  if (!ESPN_SCOREBOARD_URLS[sport]) {
    return new Set();
  }

  const cached = activityCache.get(sport);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.recentlyPlayed;
  }

  console.log(`[ESPN Activity] Refreshing recently-played data for ${sport}...`);

  try {
    const gameIds = await fetchCompletedGameIds(sport);
    console.log(`[ESPN Activity] ${sport}: Found ${gameIds.length} completed games in last ${LOOKBACK_DAYS} days`);

    const recentlyPlayed = new Set<string>();
    const batchSize = 5;
    for (let i = 0; i < gameIds.length; i += batchSize) {
      const batch = gameIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(id => fetchPlayersFromBoxscore(sport, id))
      );
      for (const players of results) {
        for (const name of players) {
          recentlyPlayed.add(name);
        }
      }
    }

    console.log(`[ESPN Activity] ${sport}: ${recentlyPlayed.size} unique players found in recent boxscores`);

    activityCache.set(sport, {
      recentlyPlayed,
      fetchedAt: Date.now(),
    });

    return recentlyPlayed;
  } catch (err) {
    console.error(`[ESPN Activity] Failed to refresh ${sport}:`, err);
    if (cached) return cached.recentlyPlayed;
    return new Set();
  }
}

export function getRecentlyPlayedCache(sport: string): Set<string> | null {
  const cached = activityCache.get(sport);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > CACHE_TTL) return null;
  return cached.recentlyPlayed;
}

export function playerRecentlyPlayed(sport: string, playerName: string): boolean | null {
  const cache = getRecentlyPlayedCache(sport);
  if (!cache) return null;
  return cache.has(normalizeName(playerName));
}

export { normalizeName as normalizePlayerName };
