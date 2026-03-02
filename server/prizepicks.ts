import type { Player } from "@shared/schema";

export interface PrizePicksProjection {
  id: string;
  playerName: string;
  team: string;
  position: string;
  statType: string;
  line: number;
  startTime: string;
  gameInfo: string;
  imageUrl: string | null;
  league: string;
  oddsType: string;
  isLive: boolean;
  status: string;
}

interface PPRawData {
  type: string;
  id: string;
  attributes: {
    line_score: number;
    stat_type: string;
    stat_display_name: string;
    start_time: string;
    description: string;
    status: string;
    odds_type: string;
    is_live: boolean;
    projection_type: string;
    in_game: boolean;
  };
  relationships: {
    new_player: { data: { type: string; id: string } | null };
    league: { data: { type: string; id: string } };
  };
}

interface PPRawIncluded {
  type: string;
  id: string;
  attributes: {
    display_name?: string;
    name?: string;
    team?: string;
    team_name?: string;
    position?: string;
    image_url?: string;
    league?: string;
    league_id?: number;
  };
}

const SPORT_TO_LEAGUE_ID: Record<string, number> = {
  NBA: 7,
  NHL: 8,
  GOLF: 1,
  MLB: 2,
  NFL: 9,
  SOCCER: 82,
};

const cache = new Map<string, { data: PrizePicksProjection[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function fetchPrizePicksProjections(sport: string): Promise<PrizePicksProjection[]> {
  const leagueId = SPORT_TO_LEAGUE_ID[sport.toUpperCase()];
  if (!leagueId) return [];

  const cacheKey = `pp_${sport}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `https://partner-api.prizepicks.com/projections?league_id=${leagueId}&per_page=1000`;
    const resp = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "EliteLineupAI/1.0",
      },
    });

    if (!resp.ok) {
      console.error(`[PrizePicks] HTTP ${resp.status} for ${sport}`);
      return cached?.data || [];
    }

    const json = await resp.json();
    const data: PPRawData[] = json.data || [];
    const included: PPRawIncluded[] = json.included || [];

    const playerMap = new Map<string, PPRawIncluded>();
    for (const inc of included) {
      if (inc.type === "new_player") {
        playerMap.set(inc.id, inc);
      }
    }

    const projections: PrizePicksProjection[] = [];

    for (const proj of data) {
      const attrs = proj.attributes;
      if (!attrs || attrs.status === "closed") continue;

      const playerId = proj.relationships?.new_player?.data?.id;
      const player = playerId ? playerMap.get(playerId) : null;

      const playerName = player?.attributes?.display_name || player?.attributes?.name || "Unknown";
      const team = player?.attributes?.team || attrs.description || "";
      const position = player?.attributes?.position || "";
      const imageUrl = player?.attributes?.image_url || null;

      const startDate = new Date(attrs.start_time);
      const timeStr = startDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      });
      const dateStr = startDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "America/New_York",
      });
      const gameInfo = `${team} · ${dateStr}, ${timeStr} ET`;

      projections.push({
        id: proj.id,
        playerName,
        team,
        position,
        statType: attrs.stat_type || attrs.stat_display_name || "",
        line: attrs.line_score,
        startTime: attrs.start_time,
        gameInfo,
        imageUrl,
        league: sport.toUpperCase(),
        oddsType: attrs.odds_type || "standard",
        isLive: attrs.is_live || attrs.in_game || false,
        status: attrs.status || "pre_game",
      });
    }

    projections.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    cache.set(cacheKey, { data: projections, timestamp: Date.now() });
    console.log(`[PrizePicks] Fetched ${projections.length} ${sport} projections`);

    return projections;
  } catch (err) {
    console.error(`[PrizePicks] Error fetching ${sport}:`, err);
    return cached?.data || [];
  }
}

export function getSupportedPPSports(): string[] {
  return Object.keys(SPORT_TO_LEAGUE_ID);
}
