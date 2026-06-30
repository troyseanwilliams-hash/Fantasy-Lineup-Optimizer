// ─────────────────────────────────────────────────────────────────────────────
// NFL Draft Rankings Engine
// Fetches ESPN NFL news daily, applies keyword-based rank adjustments,
// merges with seed data, and exposes /api/nfl/draft-rankings
// ─────────────────────────────────────────────────────────────────────────────

import { NFL_DRAFT_RANKINGS_2026 } from "../client/src/data/nfl-draft-rankings-2026";
import type { DraftPlayer } from "../client/src/data/nfl-draft-rankings-2026";

// ── Types ────────────────────────────────────────────────────────────────────

export interface NewsImpact {
  headline: string;
  direction: "up" | "down" | "neutral";
  rankChange: number;     // negative = moved up (better), positive = moved down
  publishedAt: string;
}

export interface LiveDraftPlayer extends DraftPlayer {
  newsImpact: NewsImpact | null;
  adjustedRank: number;
  lastUpdated: string;
}

// ── Keyword rules ─────────────────────────────────────────────────────────────

interface KeywordRule {
  keywords: string[];
  direction: "up" | "down" | "neutral";
  rankChange: number;   // absolute rank positions (negative = improves rank)
}

const KEYWORD_RULES: KeywordRule[] = [
  // Negative / bad news → rank drops (higher number = lower rank)
  { keywords: ["injured","injury","ir","placed on injured reserve","placed on ir","questionable","doubtful","out","torn","fracture","knee","hamstring","ankle","shoulder","surgery","season-ending"], direction:"down", rankChange: 15 },
  { keywords: ["suspended","suspension","banned","arrest","legal trouble","charged"], direction:"down", rankChange: 20 },
  { keywords: ["traded","released","cut","waived"], direction:"down", rankChange: 10 },
  { keywords: ["limited practice","limited","dnp","did not practice"], direction:"down", rankChange: 8 },
  // Positive / good news → rank improves (lower number = higher rank)
  { keywords: ["returns","cleared","activated","off ir","healthy","full practice","full go","starting"], direction:"up", rankChange: -8 },
  { keywords: ["contract extension","extension signed","locked in"], direction:"up", rankChange: -5 },
  { keywords: ["new contract","restructured"], direction:"up", rankChange: -3 },
  { keywords: ["named starter","named starting","win the job","earns starting role"], direction:"up", rankChange: -10 },
  { keywords: ["breakout","dominant","impressive camp","strong camp"], direction:"up", rankChange: -5 },
  // Neutral
  { keywords: ["monitoring","watch","questionable to play"], direction:"neutral", rankChange: 3 },
];

// ── ESPN NFL Roster fetcher ───────────────────────────────────────────────────

// ESPN team id → our abbreviation
const ESPN_TEAMS: Record<number, string> = {
  22:"ARI", 1:"ATL",  33:"BAL", 2:"BUF",  29:"CAR", 3:"CHI",
  4:"CIN",  5:"CLE",  6:"DAL",  7:"DEN",  8:"DET",  9:"GB",
  34:"HOU", 11:"IND", 30:"JAX", 12:"KC",  13:"LV",  24:"LAC",
  14:"LAR", 15:"MIA", 16:"MIN", 17:"NE",  18:"NO",  19:"NYG",
  20:"NYJ", 21:"PHI", 23:"PIT", 25:"SF",  26:"SEA", 27:"TB",
  10:"TEN", 28:"WAS",
};

// Returns normalized player name → current team abbreviation
async function fetchNFLRosterTeams(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Object.keys(ESPN_TEAMS).map(Number);

  // Fetch all rosters with concurrency limit of 4
  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    await Promise.all(batch.map(async (id) => {
      const abbr = ESPN_TEAMS[id];
      try {
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`,
          { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const group of data.athletes ?? []) {
          for (const athlete of group.items ?? []) {
            if (athlete.fullName) {
              map.set(normalizeName(athlete.fullName), abbr);
            }
          }
        }
      } catch {
        // skip failed team — don't block the rest
      }
    }));
  }

  console.log(`[NFLDraft] Roster fetch complete — ${map.size} players mapped across ${ids.length} teams`);
  return map;
}

// ── ESPN NFL News fetcher ─────────────────────────────────────────────────────

const ESPN_NFL_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100";

interface ESPNArticle {
  headline: string;
  description?: string;
  published: string;
  athletes?: { displayName: string }[];
  categories?: { description?: string; type?: string; athleteName?: string }[];
}

async function fetchESPNNFLNews(): Promise<ESPNArticle[]> {
  try {
    const res = await fetch(ESPN_NFL_NEWS_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[NFLDraft] ESPN news fetch failed: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.articles || []) as ESPNArticle[];
  } catch (err) {
    console.error("[NFLDraft] Failed to fetch ESPN NFL news:", err);
    return [];
  }
}

// ── Name matching ─────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

function articleMentionsPlayer(article: ESPNArticle, player: DraftPlayer): boolean {
  const playerNorm = normalizeName(player.name);

  // Check explicit athlete references in ESPN metadata
  if (article.athletes) {
    for (const a of article.athletes) {
      if (normalizeName(a.displayName) === playerNorm) return true;
    }
  }
  if (article.categories) {
    for (const c of article.categories) {
      if (c.athleteName && normalizeName(c.athleteName) === playerNorm) return true;
    }
  }

  // Fall back to headline/description string matching
  const haystack = `${article.headline} ${article.description || ""}`.toLowerCase();
  const parts = playerNorm.split(" ");
  // Match if both first and last name appear in the text
  if (parts.length >= 2) {
    return parts.every((p) => haystack.includes(p));
  }
  return haystack.includes(playerNorm);
}

function scoreArticle(article: ESPNArticle): { direction: "up" | "down" | "neutral"; rankChange: number } | null {
  const text = `${article.headline} ${article.description || ""}`.toLowerCase();
  let bestMatch: KeywordRule | null = null;
  let bestPriority = -1;

  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        const priority = Math.abs(rule.rankChange);
        if (priority > bestPriority) {
          bestPriority = priority;
          bestMatch = rule;
        }
        break;
      }
    }
  }

  if (!bestMatch) return null;
  return { direction: bestMatch.direction, rankChange: bestMatch.rankChange };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface RankingsCache {
  players: LiveDraftPlayer[];
  fetchedAt: number;
}

let rankingsCache: RankingsCache | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isCacheValid(): boolean {
  if (!rankingsCache) return false;
  return Date.now() - rankingsCache.fetchedAt < CACHE_TTL_MS;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getDraftRankings(force = false): Promise<LiveDraftPlayer[]> {
  if (!force && isCacheValid()) {
    return rankingsCache!.players;
  }

  // Fetch latest news + current rosters in parallel
  const [articles, rosterTeams] = await Promise.all([
    fetchESPNNFLNews(),
    fetchNFLRosterTeams(),
  ]);
  const now = new Date().toISOString();

  // Build player list, patching team from live ESPN rosters where found
  let updated = 0;
  const players: LiveDraftPlayer[] = NFL_DRAFT_RANKINGS_2026.map((p) => {
    const liveTeam = rosterTeams.get(normalizeName(p.name));
    if (liveTeam && liveTeam !== p.team) {
      updated++;
      return { ...p, team: liveTeam, newsImpact: null, adjustedRank: p.rank, lastUpdated: now };
    }
    return { ...p, newsImpact: null, adjustedRank: p.rank, lastUpdated: now };
  });
  if (updated > 0) {
    console.log(`[NFLDraft] Updated team for ${updated} players from live ESPN rosters`);
  }

  // Apply news impacts
  for (const article of articles) {
    for (const player of players) {
      if (!articleMentionsPlayer(article, player)) continue;
      const impact = scoreArticle(article);
      if (!impact) continue;

      // Only apply the most severe impact per player
      if (
        player.newsImpact === null ||
        Math.abs(impact.rankChange) > Math.abs(player.newsImpact.rankChange)
      ) {
        player.newsImpact = {
          headline: article.headline,
          direction: impact.direction,
          rankChange: impact.rankChange,
          publishedAt: article.published || now,
        };
        player.adjustedRank = Math.max(1, player.rank + impact.rankChange);
      }
    }
  }

  // Re-sort by adjustedRank
  players.sort((a, b) => a.adjustedRank - b.adjustedRank);

  // Assign sequential adjusted ranks
  players.forEach((p, i) => {
    p.adjustedRank = i + 1;
  });

  rankingsCache = { players, fetchedAt: Date.now() };
  return players;
}

export function invalidateDraftCache(): void {
  rankingsCache = null;
}
