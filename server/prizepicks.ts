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

export interface PPBuiltEntry {
  picks: Array<{
    projection: PrizePicksProjection;
    pick: "more" | "less";
    confidence: number;
    reasoning: string;
  }>;
  multiplier: number;
  overallConfidence: number;
  label: string;
}

function scoreLine(proj: PrizePicksProjection): { score: number; direction: "more" | "less"; reasoning: string } {
  let score = 50;
  let direction: "more" | "less" = "more";
  const reasons: string[] = [];

  if (proj.oddsType === "goblin") {
    score += 12;
    reasons.push("Goblin line (favorable odds)");
  } else if (proj.oddsType === "demon") {
    score -= 15;
    reasons.push("Demon line (tough odds)");
  } else if (proj.oddsType === "standard") {
    score += 3;
  }

  const stat = proj.statType.toLowerCase();
  const line = proj.line;

  if (stat.includes("pts+rebs+asts") || stat.includes("fantasy")) {
    if (line > 35) {
      direction = "less";
      score += 6;
      reasons.push("High combo line favors under");
    } else {
      direction = "more";
      score += 4;
      reasons.push("Reachable combo total");
    }
  } else if (stat.includes("points") || stat === "pts") {
    if (line >= 30) {
      direction = "less";
      score += 5;
      reasons.push("High scoring line");
    } else if (line <= 15) {
      direction = "more";
      score += 7;
      reasons.push("Low scoring line easily cleared");
    } else {
      direction = "more";
      score += 3;
    }
  } else if (stat.includes("rebound")) {
    if (line >= 10) {
      direction = "less";
      score += 4;
      reasons.push("Double-digit boards are hard to sustain");
    } else {
      direction = "more";
      score += 5;
      reasons.push("Manageable rebounding line");
    }
  } else if (stat.includes("assist")) {
    if (line >= 9) {
      direction = "less";
      score += 5;
      reasons.push("Elite assist totals are volatile");
    } else {
      direction = "more";
      score += 4;
    }
  } else if (stat.includes("3-pointer") || stat.includes("three")) {
    if (line >= 3.5) {
      direction = "less";
      score += 6;
      reasons.push("3PT shooting is high variance");
    } else {
      direction = "more";
      score += 3;
    }
  } else if (stat.includes("goal") && !stat.includes("shot")) {
    if (line >= 4) {
      direction = "less";
      score += 5;
      reasons.push("High goal totals rarely hit");
    } else {
      direction = "more";
      score += 4;
    }
  } else if (stat.includes("save")) {
    if (line >= 28) {
      direction = "more";
      score += 5;
      reasons.push("Busy goalie likely to see volume");
    } else {
      direction = "less";
      score += 3;
    }
  } else if (stat.includes("shot")) {
    if (line >= 5) {
      direction = "less";
      score += 3;
    } else {
      direction = "more";
      score += 4;
    }
  } else if (stat.includes("steal") || stat.includes("block")) {
    direction = "more";
    score += 2;
    reasons.push("Defensive stats are volatile");
  } else if (stat.includes("time on ice") || stat.includes("toi")) {
    direction = "more";
    score += 3;
    reasons.push("Minutes tend to be consistent");
  } else {
    score += 2;
    direction = Math.random() > 0.5 ? "more" : "less";
  }

  if (proj.status === "pre_game") {
    score += 2;
  }

  const nameHash = proj.playerName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const dayFactor = new Date().getDate();
  const variation = ((nameHash * 7 + dayFactor * 13) % 100) / 100 * 6 - 3;
  score += variation;

  if (reasons.length === 0) {
    reasons.push(direction === "more" ? "Line looks beatable" : "Line set high");
  }

  return { score: Math.max(30, Math.min(85, Math.round(score))), direction, reasoning: reasons.join(". ") };
}

function getMultiplier(picks: number): number {
  if (picks === 2) return 3;
  if (picks === 3) return 5;
  if (picks === 4) return 10;
  if (picks === 5) return 20;
  if (picks === 6) return 25;
  return 0;
}

export function buildAIEntries(projections: PrizePicksProjection[], count: number = 5): PPBuiltEntry[] {
  const validProjs = projections.filter(p => p.status !== "closed" && !p.isLive);

  const scored = validProjs.map(proj => {
    const { score, direction, reasoning } = scoreLine(proj);
    return { proj, score, direction, reasoning };
  });

  scored.sort((a, b) => b.score - a.score);

  const entries: PPBuiltEntry[] = [];
  const usedIds = new Set<string>();
  const usedPlayers = new Map<string, number>();

  const labels = [
    "Best Value Play",
    "High Floor Entry",
    "Sharp Picks",
    "Balanced Build",
    "Swing for the Fences"
  ];

  const entrySizes = [4, 3, 5, 3, 6];

  for (let i = 0; i < count && i < labels.length; i++) {
    const entrySize = Math.min(entrySizes[i], scored.length);
    const picks: PPBuiltEntry["picks"] = [];
    const entryPlayerTeams = new Set<string>();

    for (const item of scored) {
      if (picks.length >= entrySize) break;
      if (usedIds.has(`${i}-${item.proj.id}`)) continue;

      const playerUsed = usedPlayers.get(item.proj.playerName) || 0;
      if (playerUsed >= 2) continue;

      if (entryPlayerTeams.has(`${item.proj.playerName}-${item.proj.statType}`)) continue;

      picks.push({
        projection: item.proj,
        pick: item.direction,
        confidence: item.score,
        reasoning: item.reasoning,
      });

      usedIds.add(`${i}-${item.proj.id}`);
      usedPlayers.set(item.proj.playerName, playerUsed + 1);
      entryPlayerTeams.add(`${item.proj.playerName}-${item.proj.statType}`);
    }

    if (picks.length >= 2) {
      const avgConf = Math.round(picks.reduce((s, p) => s + p.confidence, 0) / picks.length);
      entries.push({
        picks,
        multiplier: getMultiplier(picks.length),
        overallConfidence: avgConf,
        label: labels[i],
      });
    }

    const entryOffset = (i + 1) * 7;
    scored.sort((a, b) => {
      const aHash = a.proj.playerName.charCodeAt(0) + entryOffset;
      const bHash = b.proj.playerName.charCodeAt(0) + entryOffset;
      return (b.score - (bHash % 5)) - (a.score - (aHash % 5));
    });
  }

  entries.sort((a, b) => b.overallConfidence - a.overallConfidence);

  return entries;
}
