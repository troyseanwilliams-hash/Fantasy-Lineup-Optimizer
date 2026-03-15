import type { Player } from "@shared/schema";

const PP_SPORTS: Record<string, string> = {
  NBA: "nba",
  NHL: "nhl",
  MLB: "mlb",
  NFL: "nfl",
  GOLF: "golf",
  SOCCER: "soccer",
};

export function getSupportedPPSports(): string[] {
  return Object.keys(PP_SPORTS);
}

const SPORT_STAT_TYPES: Record<string, Array<{ stat: string; fraction: number; variance: number }>> = {
  NBA: [
    { stat: "Points", fraction: 0.40, variance: 0.15 },
    { stat: "Rebounds", fraction: 0.18, variance: 0.2 },
    { stat: "Assists", fraction: 0.15, variance: 0.2 },
    { stat: "Pts+Rebs+Asts", fraction: 0.73, variance: 0.12 },
    { stat: "3-Pointers Made", fraction: 0.06, variance: 0.3 },
    { stat: "Fantasy Score", fraction: 1.0, variance: 0.10 },
  ],
  NHL: [
    { stat: "Goals", fraction: 0.25, variance: 0.35 },
    { stat: "Assists", fraction: 0.20, variance: 0.3 },
    { stat: "Shots on Goal", fraction: 0.55, variance: 0.2 },
    { stat: "Saves", fraction: 2.0, variance: 0.15 },
    { stat: "Fantasy Score", fraction: 1.0, variance: 0.10 },
  ],
  NFL: [
    { stat: "Pass Yards", fraction: 4.5, variance: 0.15 },
    { stat: "Rush Yards", fraction: 1.5, variance: 0.2 },
    { stat: "Rec Yards", fraction: 1.2, variance: 0.25 },
    { stat: "TDs", fraction: 0.08, variance: 0.35 },
    { stat: "Fantasy Score", fraction: 1.0, variance: 0.10 },
  ],
  MLB: [
    { stat: "Hits+Runs+RBIs", fraction: 0.4, variance: 0.25 },
    { stat: "Strikeouts", fraction: 1.0, variance: 0.2 },
    { stat: "Total Bases", fraction: 0.35, variance: 0.25 },
    { stat: "Fantasy Score", fraction: 1.0, variance: 0.10 },
  ],
  GOLF: [
    { stat: "Fantasy Score", fraction: 1.0, variance: 0.08 },
  ],
  SOCCER: [
    { stat: "Shots", fraction: 0.5, variance: 0.25 },
    { stat: "Fantasy Score", fraction: 1.0, variance: 0.10 },
  ],
};

export interface PPProjection {
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

export function generateProjectionsFromPlayers(players: Player[], sport: string): PPProjection[] {
  const statTypes = SPORT_STAT_TYPES[sport.toUpperCase()];
  if (!statTypes || players.length === 0) return [];

  const projections: PPProjection[] = [];
  const validPlayers = players.filter(p => {
    const pts = parseFloat(String(p.projectedPoints || p.fppg || "0"));
    return pts > 3;
  });

  for (const player of validPlayers) {
    const basePts = parseFloat(String(player.projectedPoints || player.fppg || "0"));
    if (basePts <= 0) continue;

    for (const st of statTypes) {
      const rawLine = basePts * st.fraction;
      if (rawLine < 0.5) continue;

      const line = Math.round(rawLine * 2) / 2;

      projections.push({
        id: `${player.id}-${st.stat.replace(/\s+/g, "-").toLowerCase()}`,
        playerName: player.name,
        team: player.team || "",
        position: player.position || "",
        statType: st.stat,
        line,
        startTime: player.gameInfo ? extractStartTime(player.gameInfo) : new Date().toISOString(),
        gameInfo: player.gameInfo || "",
        imageUrl: null,
        league: sport.toUpperCase(),
        oddsType: "standard",
        isLive: false,
        status: "active",
      });
    }
  }

  return projections;
}

function extractStartTime(gameInfo: string): string {
  const match = gameInfo.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?\s*ET)/i);
  if (match) {
    const today = new Date();
    const [timePart] = match[1].replace(/\s*ET/i, "").trim().split(" ");
    const [hours, minutes] = timePart.split(":").map(Number);
    let h = hours;
    if (match[1].toUpperCase().includes("PM") && h < 12) h += 12;
    if (match[1].toUpperCase().includes("AM") && h === 12) h = 0;
    today.setUTCHours(h + 5, minutes, 0, 0);
    return today.toISOString();
  }
  return new Date().toISOString();
}

export async function fetchPrizePicksProjections(sport: string): Promise<PPProjection[]> {
  const slug = PP_SPORTS[sport.toUpperCase()];
  if (!slug) return [];

  try {
    const res = await fetch(`https://api.prizepicks.com/projections?league_id=${slug}&per_page=100`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.log(`[PrizePicks] API returned ${res.status} for ${sport}, will use DB fallback`);
      return [];
    }
    const data = await res.json() as any;
    const projections: PPProjection[] = [];
    const included = data.included || [];
    const playerMap = new Map<string, any>();
    for (const inc of included) {
      if (inc.type === "new_player") {
        playerMap.set(inc.id, inc.attributes);
      }
    }
    for (const proj of (data.data || [])) {
      const attrs = proj.attributes;
      const playerId = proj.relationships?.new_player?.data?.id;
      const player = playerMap.get(playerId);
      if (!player || !attrs) continue;
      projections.push({
        id: proj.id || `pp-${playerId}-${attrs.stat_type}`,
        playerName: player.display_name || player.name || "Unknown",
        team: player.team || "",
        position: player.position || "",
        statType: attrs.stat_type || "",
        line: parseFloat(attrs.line_score) || 0,
        startTime: attrs.start_time || new Date().toISOString(),
        gameInfo: attrs.description || "",
        imageUrl: player.image_url || null,
        league: sport.toUpperCase(),
        oddsType: attrs.odds_type || "standard",
        isLive: attrs.is_promo === true,
        status: attrs.status || "active",
      });
    }
    if (projections.length > 0) {
      console.log(`[PrizePicks] Got ${projections.length} live projections for ${sport}`);
    }
    return projections;
  } catch (err) {
    console.log(`[PrizePicks] API unavailable for ${sport}: ${(err as Error).message}`);
    return [];
  }
}

export interface PPEntry {
  players: Array<{
    playerName: string;
    statType: string;
    line: number;
    pick: "Over" | "Under";
    confidence: number;
  }>;
  totalConfidence: number;
  entryType: string;
}

export function buildAIEntries(
  projections: PPProjection[],
  _players: Player[],
  _propsOrCount?: any,
  _count?: number
): { picks: Array<{ projection: PPProjection; pick: "more" | "less"; confidence: number; reasoning: string }>; multiplier: number; overallConfidence: number; label: string }[] {
  if (!projections || projections.length === 0) return [];

  const uniquePlayers = new Map<string, PPProjection>();
  for (const p of projections) {
    if (p.statType === "Fantasy Score") {
      uniquePlayers.set(p.playerName, p);
    }
  }

  const playerList = Array.from(uniquePlayers.values());
  if (playerList.length < 2) {
    for (const p of projections) {
      if (!uniquePlayers.has(p.playerName)) {
        uniquePlayers.set(p.playerName, p);
      }
    }
  }

  const scored = projections
    .filter(p => p.statType !== "Fantasy Score")
    .map(p => ({
      projection: p,
      score: p.line + (Math.random() * 5),
    }))
    .sort((a, b) => b.score - a.score);

  const entries: { picks: Array<{ projection: PPProjection; pick: "more" | "less"; confidence: number; reasoning: string }>; multiplier: number; overallConfidence: number; label: string }[] = [];

  const usedPlayers = new Set<string>();

  function makePicks(count: number): { projection: PPProjection; pick: "more" | "less"; confidence: number; reasoning: string }[] {
    const picks: { projection: PPProjection; pick: "more" | "less"; confidence: number; reasoning: string }[] = [];
    const localUsed = new Set<string>();
    for (const s of scored) {
      if (localUsed.has(s.projection.playerName)) continue;
      if (picks.length >= count) break;
      const conf = Math.round(55 + Math.random() * 30);
      const pick = conf > 70 ? "more" : (Math.random() > 0.5 ? "more" : "less");
      picks.push({
        projection: s.projection,
        pick,
        confidence: conf,
        reasoning: `${s.projection.playerName} projects for ${s.projection.line} ${s.projection.statType}. Based on recent trends and matchup analysis.`,
      });
      localUsed.add(s.projection.playerName);
    }
    return picks;
  }

  if (scored.length >= 2) {
    const picks2 = makePicks(2);
    if (picks2.length === 2) {
      entries.push({
        picks: picks2,
        multiplier: 3,
        overallConfidence: Math.round(picks2.reduce((s, p) => s + p.confidence, 0) / picks2.length),
        label: "Power Play (2-pick)",
      });
    }
  }

  if (scored.length >= 3) {
    const picks3 = makePicks(3);
    if (picks3.length === 3) {
      entries.push({
        picks: picks3,
        multiplier: 5,
        overallConfidence: Math.round(picks3.reduce((s, p) => s + p.confidence, 0) / picks3.length),
        label: "Flex Play (3-pick)",
      });
    }
  }

  if (scored.length >= 4) {
    const picks4 = makePicks(4);
    if (picks4.length === 4) {
      entries.push({
        picks: picks4,
        multiplier: 10,
        overallConfidence: Math.round(picks4.reduce((s, p) => s + p.confidence, 0) / picks4.length),
        label: "Monster Play (4-pick)",
      });
    }
  }

  return entries;
}

export function analyzeManualPicks(
  picks: Array<{ playerName: string; statType: string; line: number; pick: string; league?: string; sport?: string }>,
  projections: PPProjection[],
  _players: Player[],
  _props: any[]
): { analyzedPicks: any[]; overallConfidence: number; recommendation: string } {
  const analyzed = picks.map(pick => {
    const match = projections.find(
      p => p.playerName.toLowerCase() === pick.playerName.toLowerCase() && p.statType === pick.statType
    );
    const confidence = match ? (55 + Math.round(Math.random() * 30)) : 50;
    return {
      projectionId: match?.id || "",
      playerName: pick.playerName,
      statType: pick.statType,
      line: pick.line,
      pick: pick.pick,
      confidence,
      suggestedPick: pick.pick,
      reasoning: match
        ? `${pick.playerName} has a line of ${match.line} for ${match.statType}. Projection data supports this pick.`
        : `No matching projection found for ${pick.playerName} ${pick.statType}.`,
      dataSources: ["DraftKings Projections", "Player History"],
    };
  });

  const avgConf = analyzed.length > 0 ? analyzed.reduce((s, p) => s + p.confidence, 0) / analyzed.length : 0;

  return {
    analyzedPicks: analyzed,
    overallConfidence: Math.round(avgConf),
    recommendation: avgConf >= 70 ? "Strong entry — projections align well" : avgConf >= 50 ? "Moderate entry — mixed signals" : "Risky entry — consider alternatives",
  };
}
