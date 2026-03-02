import type { Player, Prop } from "@shared/schema";

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

interface PlayerIntel {
  fppg: number | null;
  projectedPoints: number | null;
  salary: number | null;
  injuryStatus: string | null;
  injuryDetail: string | null;
  boostScore: number | null;
  boostReason: string | null;
}

interface PropIntel {
  pick: string;
  confidence: number;
  line: number;
  propType: string;
}

const PP_STAT_TO_PROP_TYPE: Record<string, string[]> = {
  "points": ["Points", "points"],
  "pts": ["Points", "points"],
  "rebounds": ["Rebounds", "rebounds"],
  "assists": ["Assists", "assists"],
  "pts+rebs+asts": ["Pts+Reb+Ast", "pts+rebs+asts"],
  "3-pointers made": ["3-Pointers", "3-pointers", "threes"],
  "fantasy score": ["Fantasy Score", "fantasy"],
  "goals": ["Goals", "goals"],
  "shots on goal": ["Shots on Goal", "shots"],
  "saves": ["Saves", "saves"],
  "blocked shots": ["Blocked Shots", "blocked"],
  "hits+runs+rbis": ["Hits+Runs+RBIs"],
  "total bases": ["Total Bases"],
  "strikeouts": ["Strikeouts", "pitcher_strikeouts"],
  "pitcher strikeouts": ["Strikeouts", "pitcher_strikeouts"],
  "passing yards": ["Passing Yards", "passing"],
  "rushing yards": ["Rushing Yards", "rushing"],
  "receiving yards": ["Receiving Yards", "receiving"],
  "receptions": ["Receptions", "receptions"],
  "passing tds": ["Passing TDs", "passing_tds"],
};

function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchPlayerName(ppName: string, dbName: string): boolean {
  const a = normalizePlayerName(ppName);
  const b = normalizePlayerName(dbName);
  if (a === b) return true;
  const aParts = a.split(' ');
  const bParts = b.split(' ');
  if (aParts.length >= 2 && bParts.length >= 2) {
    if (aParts[aParts.length - 1] === bParts[bParts.length - 1] && aParts[0][0] === bParts[0][0]) return true;
  }
  return false;
}

function matchStatType(ppStat: string, propType: string): boolean {
  const ppLower = ppStat.toLowerCase().trim();
  const propLower = propType.toLowerCase().trim();
  if (ppLower === propLower) return true;
  const mappings = PP_STAT_TO_PROP_TYPE[ppLower];
  if (mappings) {
    return mappings.some(m => m.toLowerCase() === propLower);
  }
  for (const [, vals] of Object.entries(PP_STAT_TO_PROP_TYPE)) {
    const allVals = vals.map(v => v.toLowerCase());
    if (allVals.includes(ppLower) && allVals.includes(propLower)) return true;
  }
  return false;
}

function scoreWithData(
  proj: PrizePicksProjection,
  playerData: PlayerIntel | null,
  propData: PropIntel | null,
): { score: number; direction: "more" | "less"; reasoning: string } {
  let score = 50;
  let direction: "more" | "less" = "more";
  const reasons: string[] = [];

  if (proj.oddsType === "goblin") {
    score += 10;
    reasons.push("Goblin line (boosted odds)");
  } else if (proj.oddsType === "demon") {
    score -= 12;
    reasons.push("Demon line (tough odds)");
  }

  if (propData) {
    const propDirection = propData.pick.toLowerCase().includes("over") ? "more" : "less";
    direction = propDirection;
    const conf = propData.confidence;
    if (conf >= 70) {
      score += 18;
      reasons.push(`Sportsbook line strongly favors ${propDirection.toUpperCase()} (${conf.toFixed(0)}% implied)`);
    } else if (conf >= 60) {
      score += 12;
      reasons.push(`Sportsbook data favors ${propDirection.toUpperCase()} (${conf.toFixed(0)}% implied)`);
    } else if (conf >= 55) {
      score += 6;
      reasons.push(`Slight sportsbook edge on ${propDirection.toUpperCase()} (${conf.toFixed(0)}% implied)`);
    } else {
      score += 3;
      reasons.push(`Sportsbook leans ${propDirection.toUpperCase()}`);
    }

    const lineDiff = proj.line - propData.line;
    if (Math.abs(lineDiff) >= 1) {
      const lineDirection: "more" | "less" = lineDiff > 0 ? "less" : "more";
      const bonus = Math.min(8, Math.round(Math.abs(lineDiff) * 2));
      if (lineDirection === direction) {
        score += bonus;
        reasons.push(`PP line ${proj.line} vs book line ${propData.line} confirms ${direction.toUpperCase()}`);
      } else {
        score += Math.round(bonus * 0.5);
        reasons.push(`PP line ${proj.line} vs book ${propData.line} suggests ${lineDirection.toUpperCase()} edge`);
      }
    }
  }

  if (playerData) {
    if (playerData.injuryStatus) {
      const status = playerData.injuryStatus.toLowerCase();
      if (status === "out" || status === "o") {
        score = 0;
        direction = "less";
        reasons.length = 0;
        reasons.push("Player ruled OUT — skip");
        return { score: 0, direction: "less", reasoning: reasons.join(". ") };
      } else if (status === "doubtful" || status === "d") {
        score -= 15;
        direction = "less";
        reasons.push(`Player DOUBTFUL (${playerData.injuryDetail || "undisclosed"})`);
      } else if (status === "questionable" || status === "q" || status === "gtd") {
        score -= 5;
        reasons.push(`Player Questionable (${playerData.injuryDetail || "undisclosed"})`);
      } else if (status === "probable" || status === "p") {
        score += 1;
        reasons.push("Player Probable — expected to play");
      }
    }

    if (playerData.boostScore && playerData.boostScore > 0) {
      score += Math.min(10, Math.round(playerData.boostScore * 2));
      if (playerData.boostReason) {
        reasons.push(`Boost: ${playerData.boostReason}`);
      } else {
        reasons.push(`Player has positive boost (+${playerData.boostScore.toFixed(1)})`);
      }
      if (!propData) direction = "more";
    } else if (playerData.boostScore && playerData.boostScore < 0) {
      score -= Math.min(8, Math.round(Math.abs(playerData.boostScore) * 2));
      if (playerData.boostReason) {
        reasons.push(`Downgrade: ${playerData.boostReason}`);
      }
      if (!propData) direction = "less";
    }

    if (playerData.projectedPoints && playerData.fppg) {
      const projRatio = playerData.projectedPoints / Math.max(playerData.fppg, 1);
      if (projRatio > 1.15) {
        score += 5;
        if (!propData) direction = "more";
        reasons.push(`Projected ${(projRatio * 100 - 100).toFixed(0)}% above average`);
      } else if (projRatio < 0.85) {
        score += 5;
        if (!propData) direction = "less";
        reasons.push(`Projected ${(100 - projRatio * 100).toFixed(0)}% below average`);
      }
    }

    if (playerData.salary && playerData.fppg) {
      const valueRatio = playerData.fppg / (playerData.salary / 1000);
      if (valueRatio > 5) {
        score += 4;
        reasons.push("High DK value (strong production per $1K)");
      }
    }
  }

  if (!propData && !playerData) {
    const stat = proj.statType.toLowerCase();
    const line = proj.line;

    if (stat.includes("pts+rebs+asts") || stat.includes("fantasy")) {
      direction = line > 35 ? "less" : "more";
      score += 3;
      reasons.push(direction === "less" ? "High combo line" : "Reachable combo line");
    } else if (stat.includes("points") || stat === "pts") {
      if (line >= 30) { direction = "less"; score += 3; reasons.push("High scoring line"); }
      else if (line <= 15) { direction = "more"; score += 5; reasons.push("Low line easily cleared"); }
      else { direction = "more"; score += 2; }
    } else if (stat.includes("rebound")) {
      direction = line >= 10 ? "less" : "more";
      score += 3;
    } else if (stat.includes("assist")) {
      direction = line >= 9 ? "less" : "more";
      score += 3;
    } else if (stat.includes("3-pointer") || stat.includes("three")) {
      direction = line >= 3.5 ? "less" : "more";
      score += 3;
      if (direction === "less") reasons.push("3PT shooting is high variance");
    } else if (stat.includes("save")) {
      direction = line >= 28 ? "more" : "less";
      score += 3;
    } else if (stat.includes("goal") && !stat.includes("shot")) {
      direction = line >= 1.5 ? "less" : "more";
      score += 2;
    } else if (stat.includes("shot")) {
      direction = line >= 5 ? "less" : "more";
      score += 2;
    } else if (stat.includes("strikeout")) {
      direction = line >= 7 ? "less" : "more";
      score += 2;
    } else {
      direction = line > 5 ? "less" : "more";
      score += 1;
    }
  }

  if (proj.status === "pre_game") {
    score += 2;
  }

  if (reasons.length === 0) {
    reasons.push(direction === "more" ? "Line looks beatable" : "Line set high");
  }

  return { score: Math.max(10, Math.min(90, Math.round(score))), direction, reasoning: reasons.join(". ") };
}

function getMultiplier(picks: number): number {
  if (picks === 2) return 3;
  if (picks === 3) return 5;
  if (picks === 4) return 10;
  if (picks === 5) return 20;
  if (picks === 6) return 25;
  return 0;
}

export function buildAIEntries(
  projections: PrizePicksProjection[],
  dbPlayers: Player[],
  dbProps: Prop[],
  count: number = 5,
): PPBuiltEntry[] {
  const validProjs = projections.filter(p => p.status !== "closed" && !p.isLive);

  const playerMap = new Map<string, PlayerIntel>();
  for (const p of dbPlayers) {
    playerMap.set(normalizePlayerName(p.name), {
      fppg: p.fppg ? parseFloat(String(p.fppg)) : null,
      projectedPoints: p.projectedPoints ? parseFloat(String(p.projectedPoints)) : null,
      salary: p.salary,
      injuryStatus: p.injuryStatus || null,
      injuryDetail: p.injuryDetail || null,
      boostScore: p.boostScore ? parseFloat(String(p.boostScore)) : null,
      boostReason: p.boostReason || null,
    });
  }

  const propMap = new Map<string, PropIntel[]>();
  for (const prop of dbProps) {
    const conf = parseFloat(String(prop.confidence));
    const line = parseFloat(String(prop.line));
    if (isNaN(conf) || isNaN(line)) continue;
    const key = normalizePlayerName(prop.playerName);
    if (!propMap.has(key)) propMap.set(key, []);
    propMap.get(key)!.push({
      pick: prop.pick,
      confidence: conf,
      line,
      propType: prop.propType,
    });
  }

  const scored = validProjs.map(proj => {
    const nameKey = normalizePlayerName(proj.playerName);

    let playerData: PlayerIntel | null = playerMap.get(nameKey) || null;
    if (!playerData) {
      for (const [dbKey, dbVal] of playerMap) {
        if (matchPlayerName(proj.playerName, dbKey)) {
          playerData = dbVal;
          break;
        }
      }
    }

    let propData: PropIntel | null = null;
    const playerProps = propMap.get(nameKey);
    if (playerProps) {
      const matchingProp = playerProps.find(p => matchStatType(proj.statType, p.propType));
      if (matchingProp) propData = matchingProp;
    }
    if (!propData) {
      for (const [propKey, propVals] of propMap) {
        if (matchPlayerName(proj.playerName, propKey)) {
          const matchingProp = propVals.find(p => matchStatType(proj.statType, p.propType));
          if (matchingProp) { propData = matchingProp; break; }
        }
      }
    }

    const { score, direction, reasoning } = scoreWithData(proj, playerData, propData);
    const dataSources: string[] = [];
    if (playerData) dataSources.push("DK");
    if (propData) dataSources.push("Odds");
    const sourceTag = dataSources.length > 0 ? ` [${dataSources.join("+")}]` : "";

    return { proj, score, direction, reasoning: reasoning + sourceTag };
  });

  scored.sort((a, b) => b.score - a.score);

  const entries: PPBuiltEntry[] = [];
  const usedPlayers = new Map<string, number>();

  const templates = [
    { label: "Best Value Play", size: 4, strategy: "top" as const },
    { label: "High Floor Entry", size: 3, strategy: "top" as const },
    { label: "Sharp Picks", size: 5, strategy: "spread" as const },
    { label: "Balanced Build", size: 3, strategy: "spread" as const },
    { label: "Swing for the Fences", size: 6, strategy: "goblin" as const },
  ];

  for (let i = 0; i < count && i < templates.length; i++) {
    const tmpl = templates[i];
    const entrySize = Math.min(tmpl.size, scored.length);
    const picks: PPBuiltEntry["picks"] = [];
    const entryPlayers = new Set<string>();

    let pool = [...scored].filter(s => s.score > 10);

    if (tmpl.strategy === "goblin") {
      pool.sort((a, b) => {
        const aGob = a.proj.oddsType === "goblin" ? 1 : 0;
        const bGob = b.proj.oddsType === "goblin" ? 1 : 0;
        if (aGob !== bGob) return bGob - aGob;
        return b.score - a.score;
      });
    } else if (tmpl.strategy === "spread") {
      const offset = i * 5;
      pool = pool.slice(offset);
    }

    for (const item of pool) {
      if (picks.length >= entrySize) break;

      const nameKey = normalizePlayerName(item.proj.playerName);
      const globalUsage = usedPlayers.get(nameKey) || 0;
      if (globalUsage >= 3) continue;

      if (entryPlayers.has(`${nameKey}-${item.proj.statType.toLowerCase()}`)) continue;

      picks.push({
        projection: item.proj,
        pick: item.direction as "more" | "less",
        confidence: item.score,
        reasoning: item.reasoning,
      });

      usedPlayers.set(nameKey, globalUsage + 1);
      entryPlayers.add(`${nameKey}-${item.proj.statType.toLowerCase()}`);
    }

    if (picks.length >= 2) {
      const avgConf = Math.round(picks.reduce((s, p) => s + p.confidence, 0) / picks.length);
      entries.push({
        picks,
        multiplier: getMultiplier(picks.length),
        overallConfidence: avgConf,
        label: tmpl.label,
      });
    }
  }

  entries.sort((a, b) => b.overallConfidence - a.overallConfidence);

  return entries;
}

export interface AnalyzedPick {
  projectionId: string;
  playerName: string;
  statType: string;
  line: number;
  pick: "more" | "less";
  confidence: number;
  suggestedPick: "more" | "less";
  reasoning: string;
  dataSources: string[];
}

export function analyzeManualPicks(
  picks: Array<{ projectionId: string; playerName: string; team: string; statType: string; line: number; pick: "more" | "less" }>,
  allProjections: PrizePicksProjection[],
  dbPlayers: Player[],
  dbProps: Prop[],
): { analyzedPicks: AnalyzedPick[]; overallConfidence: number } {
  const playerMap = new Map<string, PlayerIntel>();
  for (const p of dbPlayers) {
    playerMap.set(normalizePlayerName(p.name), {
      fppg: p.fppg ? parseFloat(String(p.fppg)) : null,
      projectedPoints: p.projectedPoints ? parseFloat(String(p.projectedPoints)) : null,
      salary: p.salary,
      injuryStatus: p.injuryStatus || null,
      injuryDetail: p.injuryDetail || null,
      boostScore: p.boostScore ? parseFloat(String(p.boostScore)) : null,
      boostReason: p.boostReason || null,
    });
  }

  const propMap = new Map<string, PropIntel[]>();
  for (const prop of dbProps) {
    const conf = parseFloat(String(prop.confidence));
    const line = parseFloat(String(prop.line));
    if (isNaN(conf) || isNaN(line)) continue;
    const key = normalizePlayerName(prop.playerName);
    if (!propMap.has(key)) propMap.set(key, []);
    propMap.get(key)!.push({ pick: prop.pick, confidence: conf, line, propType: prop.propType });
  }

  const projMap = new Map<string, PrizePicksProjection>();
  for (const p of allProjections) projMap.set(p.id, p);

  const analyzedPicks: AnalyzedPick[] = picks.map(pick => {
    const proj = projMap.get(pick.projectionId) || {
      id: pick.projectionId, playerName: pick.playerName, team: pick.team,
      position: "", statType: pick.statType, line: pick.line,
      startTime: "", gameInfo: "", imageUrl: null, league: "",
      oddsType: "standard", isLive: false, status: "pre_game",
    };

    const nameKey = normalizePlayerName(pick.playerName);
    let playerData: PlayerIntel | null = playerMap.get(nameKey) || null;
    if (!playerData) {
      for (const [dbKey, dbVal] of playerMap) {
        if (matchPlayerName(pick.playerName, dbKey)) { playerData = dbVal; break; }
      }
    }

    let propData: PropIntel | null = null;
    const playerProps = propMap.get(nameKey);
    if (playerProps) {
      const matchingProp = playerProps.find(p => matchStatType(pick.statType, p.propType));
      if (matchingProp) propData = matchingProp;
    }
    if (!propData) {
      for (const [propKey, propVals] of propMap) {
        if (matchPlayerName(pick.playerName, propKey)) {
          const matchingProp = propVals.find(p => matchStatType(pick.statType, p.propType));
          if (matchingProp) { propData = matchingProp; break; }
        }
      }
    }

    const { score, direction, reasoning } = scoreWithData(proj, playerData, propData);
    const dataSources: string[] = [];
    if (playerData) dataSources.push("DK");
    if (propData) dataSources.push("Odds");

    return {
      projectionId: pick.projectionId,
      playerName: pick.playerName,
      statType: pick.statType,
      line: pick.line,
      pick: pick.pick,
      confidence: score,
      suggestedPick: direction,
      reasoning,
      dataSources,
    };
  });

  const overallConfidence = analyzedPicks.length > 0
    ? Math.round(analyzedPicks.reduce((s, p) => s + p.confidence, 0) / analyzedPicks.length)
    : 0;

  return { analyzedPicks, overallConfidence };
}
