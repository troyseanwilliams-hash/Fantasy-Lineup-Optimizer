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

export interface PPProjection {
  playerName: string;
  team: string;
  opponent: string;
  sport: string;
  statType: string;
  line: number;
  overPct: number;
  underPct: number;
  confidence: number;
  pick: "Over" | "Under";
  gameInfo: string;
}

export async function fetchPrizePicksProjections(sport: string): Promise<PPProjection[]> {
  const slug = PP_SPORTS[sport.toUpperCase()];
  if (!slug) return [];

  try {
    const res = await fetch(`https://api.prizepicks.com/projections?league_id=${slug}&per_page=100`, {
      headers: { "User-Agent": "EliteLineupAI/1.0" },
    });
    if (!res.ok) return [];
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
        playerName: player.display_name || player.name || "Unknown",
        team: player.team || "",
        opponent: "",
        sport: sport.toUpperCase(),
        statType: attrs.stat_type || "",
        line: parseFloat(attrs.line_score) || 0,
        overPct: 50,
        underPct: 50,
        confidence: 50,
        pick: "Over",
        gameInfo: attrs.description || "",
      });
    }
    return projections;
  } catch (err) {
    console.log(`[PrizePicks] Failed to fetch ${sport} projections:`, (err as Error).message);
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
  _count?: number
): PPEntry[] {
  if (!projections || projections.length === 0) return [];

  const sorted = [...projections].sort((a, b) => b.confidence - a.confidence);
  const top = sorted.slice(0, Math.min(6, sorted.length));

  const entries: PPEntry[] = [];
  if (top.length >= 2) {
    entries.push({
      players: top.slice(0, 2).map(p => ({
        playerName: p.playerName,
        statType: p.statType,
        line: p.line,
        pick: p.pick,
        confidence: p.confidence,
      })),
      totalConfidence: top.slice(0, 2).reduce((s, p) => s + p.confidence, 0) / 2,
      entryType: "Power Play (2-pick)",
    });
  }
  if (top.length >= 3) {
    entries.push({
      players: top.slice(0, 3).map(p => ({
        playerName: p.playerName,
        statType: p.statType,
        line: p.line,
        pick: p.pick,
        confidence: p.confidence,
      })),
      totalConfidence: top.slice(0, 3).reduce((s, p) => s + p.confidence, 0) / 3,
      entryType: "Flex Play (3-pick)",
    });
  }

  return entries;
}

export function analyzeManualPicks(
  picks: Array<{ playerName: string; statType: string; line: number; pick: "Over" | "Under" }>,
  projections: PPProjection[],
  _players: Player[],
  _props: any[]
): { picks: any[]; overallConfidence: number; recommendation: string } {
  const analyzed = picks.map(pick => {
    const match = projections.find(
      p => p.playerName.toLowerCase() === pick.playerName.toLowerCase() && p.statType === pick.statType
    );
    return {
      ...pick,
      confidence: match ? match.confidence : 50,
      projectedLine: match ? match.line : pick.line,
      edge: match ? (pick.pick === match.pick ? "aligned" : "contrarian") : "unknown",
    };
  });

  const avgConf = analyzed.length > 0 ? analyzed.reduce((s, p) => s + p.confidence, 0) / analyzed.length : 0;

  return {
    picks: analyzed,
    overallConfidence: Math.round(avgConf),
    recommendation: avgConf >= 70 ? "Strong entry" : avgConf >= 50 ? "Moderate entry" : "Risky entry",
  };
}
