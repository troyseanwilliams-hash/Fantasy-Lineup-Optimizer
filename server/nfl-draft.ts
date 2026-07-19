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

const TIER_BANDS: { max: number; tier: number; label: string }[] = [
  { max: 6, tier: 1, label: "Transcendent" },
  { max: 18, tier: 2, label: "Elite" },
  { max: 45, tier: 3, label: "Strong Starter" },
  { max: 90, tier: 4, label: "Quality Starter" },
  { max: 150, tier: 5, label: "Flex / Streamer" },
  { max: 220, tier: 6, label: "Deep Stash" },
];
function tierForRank(rank: number): { tier: number; label: string } {
  for (const b of TIER_BANDS) if (rank <= b.max) return { tier: b.tier, label: b.label };
  return { tier: 7, label: "Speculative" };
}

export async function getDraftRankings(force = false): Promise<LiveDraftPlayer[]> {
  if (!force && isCacheValid()) {
    return rankingsCache!.players;
  }

  // Fetch latest news + current rosters + live ESPN draft ranks in parallel
  const { fetchESPNDraftRankings } = await import("./espn-draft-rankings");
  const [articles, rosterTeams, espnRanks] = await Promise.all([
    fetchESPNNFLNews(),
    fetchNFLRosterTeams(),
    fetchESPNDraftRankings(),
  ]);
  const now = new Date().toISOString();

  // Build player list, patching team from live ESPN rosters where found
  let updated = 0;
  let players: LiveDraftPlayer[] = NFL_DRAFT_RANKINGS_2026.map((p) => {
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

  // ── Reconcile against live ESPN fantasy draft rankings ─────────────────────
  // ESPN is the authority for pool membership, ordering, and ADP; the seed
  // file supplies the deep profiles. Seed players ESPN doesn't rank get
  // DROPPED (this purges non-NFL / fabricated entries), and top-consensus
  // players missing a profile get appended with a stub.
  if (espnRanks.length >= 100) {
    const espnByName = new Map(espnRanks.map((e) => [normalizeName(e.name), e]));
    const matchedEspnIds = new Set<number>();
    const dropped: string[] = [];

    players = players.filter((p) => {
      const e = espnByName.get(normalizeName(p.name));
      if (!e) {
        dropped.push(p.name);
        return false;
      }
      matchedEspnIds.add(e.espnId);
      // Live ordering + ADP + team from ESPN; profile content stays.
      p.rank = e.pprRank;
      p.analystRank = e.pprRank;
      if (e.adp > 0) p.adp = e.adp;
      if (e.team !== "FA") p.team = e.team;
      return true;
    });
    if (dropped.length > 0) {
      console.log(`[NFLDraft] Dropped ${dropped.length} seed players not in ESPN's ranked pool: ${dropped.slice(0, 10).join(", ")}${dropped.length > 10 ? "…" : ""}`);
    }

    // Append top-consensus ESPN players that have no seed profile yet.
    let appended = 0;
    const posCounts = new Map<string, number>();
    for (const p of players) {
      posCounts.set(p.position, (posCounts.get(p.position) ?? 0) + 1);
    }
    for (const e of espnRanks) {
      if (e.pprRank > 220 || matchedEspnIds.has(e.espnId)) continue;
      const t = tierForRank(e.pprRank);
      const posN = (posCounts.get(e.position) ?? 0) + 1;
      posCounts.set(e.position, posN);
      players.push({
        id: 100000 + e.espnId,
        rank: e.pprRank,
        posRank: `${e.position}${posN}`,
        name: e.name,
        team: e.team,
        position: e.position as LiveDraftPlayer["position"],
        tier: t.tier,
        tierLabel: t.label,
        adp: e.adp > 0 ? e.adp : e.pprRank,
        analystRank: e.pprRank,
        // Rough projection from rank until a full profile is written.
        projPPR: Math.max(40, Math.round(330 - e.pprRank * 1.15)),
        projHalf: Math.max(36, Math.round(310 - e.pprRank * 1.1)),
        projStd: Math.max(32, Math.round(290 - e.pprRank * 1.05)),
        upside: "medium",
        risk: "medium",
        age: 0,
        bye: 0,
        reasoning: `Ranked #${e.pprRank} in live ESPN consensus (ADP ${e.adp > 0 ? e.adp.toFixed(1) : "n/a"}). Full EliteLineup profile coming — ranking and ADP update daily from ESPN's fantasy platform.`,
        strengths: ["Live ESPN consensus ranking"],
        concerns: ["Full scouting profile not yet written"],
        tags: ["espn-consensus"],
        isFree: e.pprRank <= 5,
        newsImpact: null,
        adjustedRank: e.pprRank,
        lastUpdated: now,
      } as LiveDraftPlayer);
      appended++;
    }
    if (appended > 0) {
      console.log(`[NFLDraft] Appended ${appended} ESPN-consensus players missing seed profiles`);
    }

    // Re-base: order by live ESPN rank, then re-tier and re-number positional
    // ranks on the fresh ordering.
    players.sort((a, b) => a.rank - b.rank);
    const posRankCounts = new Map<string, number>();
    players.forEach((p, i) => {
      p.rank = i + 1;
      const t = tierForRank(p.rank);
      p.tier = t.tier;
      p.tierLabel = t.label;
      p.adjustedRank = p.rank;
      const n = (posRankCounts.get(p.position) ?? 0) + 1;
      posRankCounts.set(p.position, n);
      p.posRank = `${p.position}${n}`;
    });
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

  // Persist today's board so rank movement can be charted over time.
  void saveDailySnapshot(players);

  return players;
}

// ── Daily rank snapshots (movement history) ──────────────────────────────────

/** Writes one snapshot row per day: { [playerName]: { r: adjustedRank, b: baseRank } }. */
async function saveDailySnapshot(players: LiveDraftPlayer[]): Promise<void> {
  try {
    const { db } = await import("./db");
    const { draftRankSnapshots } = await import("@shared/schema");
    const today = new Date().toISOString().slice(0, 10);
    const ranks: Record<string, { r: number; b: number }> = {};
    for (const p of players) ranks[p.name] = { r: p.adjustedRank, b: p.rank };
    await db
      .insert(draftRankSnapshots)
      .values({ snapshotDate: today, ranks })
      .onConflictDoUpdate({ target: draftRankSnapshots.snapshotDate, set: { ranks } });
  } catch (err) {
    console.error("[NFLDraft] Failed to save rank snapshot (non-fatal):", err);
  }
}

export interface RankHistoryDay {
  date: string;
  ranks: Record<string, { r: number; b: number }>;
}

/** Last N days of snapshots, oldest first. */
export async function getRankHistory(days = 14): Promise<RankHistoryDay[]> {
  const { db } = await import("./db");
  const { draftRankSnapshots } = await import("@shared/schema");
  const { desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(draftRankSnapshots)
    .orderBy(desc(draftRankSnapshots.snapshotDate))
    .limit(Math.min(60, Math.max(1, days)));
  return rows
    .reverse()
    .map((r) => ({ date: String(r.snapshotDate), ranks: r.ranks as RankHistoryDay["ranks"] }));
}

export function invalidateDraftCache(): void {
  rankingsCache = null;
}
