// Live NFL fantasy draft rankings from ESPN's fantasy API.
//
// This is the authoritative source for WHO is draftable and WHERE they rank:
// real PPR/Standard draft ranks and live ADP for the 2026 season, from the
// same ESPN infrastructure the rest of the app already uses. The hand-written
// seed file remains the source of PROFILES (reasoning, strengths, concerns),
// but ordering, ADP, and pool membership come from here — which also purges
// any seed players who aren't actually in the NFL player pool.

const SEASON = 2026;
const ESPN_FANTASY_URL = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/3?view=kona_player_info`;

// ESPN defaultPositionId → fantasy position
const POSITION_IDS: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

// ESPN proTeamId → team abbreviation
const PRO_TEAMS: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS",
  29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

export interface ESPNDraftPlayer {
  espnId: number;
  name: string;
  team: string;
  position: string;
  pprRank: number;
  stdRank: number;
  adp: number;
  injuryStatus: string;
}

interface ESPNKonaResponse {
  players?: Array<{
    player?: {
      id: number;
      fullName?: string;
      defaultPositionId?: number;
      proTeamId?: number;
      injuryStatus?: string;
      draftRanksByRankType?: {
        PPR?: { rank?: number };
        STANDARD?: { rank?: number };
      };
      ownership?: { averageDraftPosition?: number };
    };
  }>;
}

let cache: { players: ESPNDraftPlayer[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // ESPN ranks/ADP move a few times a day

/**
 * Top ~350 draftable players by ESPN PPR rank. Returns [] on any failure so
 * callers can fall back to seed-only behavior.
 */
export async function fetchESPNDraftRankings(): Promise<ESPNDraftPlayer[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.players;

  try {
    const filter = {
      players: {
        limit: 400,
        sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
      },
    };
    const res = await fetch(ESPN_FANTASY_URL, {
      headers: {
        Accept: "application/json",
        "x-fantasy-filter": JSON.stringify(filter),
        "User-Agent": "Mozilla/5.0 (compatible; EliteLineupAI/1.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ESPN fantasy API ${res.status}`);
    const data = (await res.json()) as ESPNKonaResponse;

    const players: ESPNDraftPlayer[] = [];
    for (const entry of data.players ?? []) {
      const p = entry.player;
      if (!p?.fullName) continue;
      const position = POSITION_IDS[p.defaultPositionId ?? -1];
      if (!position) continue; // IDP and other non-fantasy slots
      const pprRank = p.draftRanksByRankType?.PPR?.rank ?? 9999;
      if (pprRank > 600) continue; // unranked filler
      players.push({
        espnId: p.id,
        name: p.fullName,
        team: PRO_TEAMS[p.proTeamId ?? -1] ?? "FA",
        position,
        pprRank,
        stdRank: p.draftRanksByRankType?.STANDARD?.rank ?? pprRank,
        adp: p.ownership?.averageDraftPosition ?? 0,
        injuryStatus: p.injuryStatus ?? "ACTIVE",
      });
    }
    players.sort((a, b) => a.pprRank - b.pprRank);

    if (players.length >= 100) {
      cache = { players, fetchedAt: Date.now() };
      console.log(`[ESPNDraft] Loaded ${players.length} ranked players from ESPN fantasy API`);
    } else {
      console.warn(`[ESPNDraft] Only ${players.length} usable players returned — treating as failure`);
      return cache?.players ?? [];
    }
    return players;
  } catch (err) {
    console.error("[ESPNDraft] fetch failed (falling back to seed rankings):", err);
    return cache?.players ?? [];
  }
}
