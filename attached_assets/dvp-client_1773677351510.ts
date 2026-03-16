/**
 * dvp-client.ts
 *
 * Pulls defensive-versus-position (DvP) data from ESPN's public team stats API.
 * Applies a per-position multiplier to player projections before simulations run.
 *
 * Multiplier logic:
 *   rawScore = teamPtsAllowed / leagueAvgPtsAllowed
 *     > 1.0 = team allows more points than avg = weaker defense = DFS-friendly
 *     < 1.0 = team allows fewer points = elite defense = unfavorable matchup
 *
 *   posMultiplier = 1.0 + (rawScore - 1.0) * positionSensitivity
 *     clamped to [MULT_MIN, MULT_MAX]
 *
 * Applied as a pre-processing step in optimizer-route.ts BEFORE simulations run,
 * modifying projOverrides. This shifts the median the sims sample around.
 *
 * Cache: team IDs cached 7 days; defensive stats cached 6 hours.
 */

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0; +https://elitelineup.com)",
  Accept: "application/json",
};

// ── ESPN endpoints ────────────────────────────────────────────────────────────

const ESPN_TEAMS_URL: Record<string, string> = {
  NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50",
  NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=50",
  MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=50",
  NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams?limit=50",
};

const ESPN_TEAM_STATS_URL: Record<string, string> = {
  NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{id}/statistics",
  NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{id}/statistics",
  MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/{id}/statistics",
  NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/{id}/statistics",
};

// ── League baselines (pts/runs/goals allowed per game, season avg) ───────────
// Used when a team's stats can't be fetched — keeps multiplier neutral.
const LEAGUE_AVG_PTS_ALLOWED: Record<string, number> = {
  NBA: 113.0,
  NFL:  23.0,
  MLB:   4.5,
  NHL:   3.1,
};

// ── Multiplier bounds ─────────────────────────────────────────────────────────
const MULT_MIN = 0.82;  // best possible defense: up to -18%
const MULT_MAX = 1.20;  // worst possible defense: up to +20%

// ── Position sensitivity — how much defense quality impacts each position ─────
// 1.0 = fully correlated with team defensive quality
// 0.0 = not impacted at all

const POSITION_DvP_SENSITIVITY: Record<string, Record<string, number>> = {
  NBA: {
    PG:   1.0,   // guard defense (perimeter) matters most
    SG:   1.0,
    G:    1.0,
    SF:   0.85,
    PF:   0.80,
    F:    0.82,
    C:    0.70,  // interior defense is less variable
    UTIL: 0.85,
  },
  NFL: {
    QB:   0.90,
    WR:   1.0,   // coverage quality is the most position-specific matchup
    TE:   0.85,
    RB:   0.70,  // run defense vs pass defense: different metric, dampened
    DST:  0.50,  // defense playing vs opposing offense
    K:    0.30,  // field position more important than defense quality
    DEF:  0.50,
  },
  MLB: {
    SP:   0.80,  // SP vs opposing lineup quality
    RP:   0.80,
    P:    0.80,
    OF:   1.0,
    SS:   1.0,
    C:    0.90,
    "1B": 0.90,
    "2B": 0.90,
    "3B": 0.90,
  },
  NHL: {
    C:      1.0,
    W:      1.0,
    LW:     1.0,
    RW:     1.0,
    SKATER: 1.0,
    D:      0.65,  // D-men score more via PP, less dependent on opponent D
    G:      0.40,  // goalie performance vs opposing offense (inverse)
  },
};

function getPositionSensitivity(sport: string, position: string): number {
  const pos = position.split("/")[0].toUpperCase();
  return POSITION_DvP_SENSITIVITY[sport.toUpperCase()]?.[pos] ?? 0.80;
}

// ── Interfaces ────────────────────────────────────────────────────────────────

// Map of "OPPONENT_TEAM:POSITION" → multiplier (e.g., "LAL:PG" → 1.12)
export type DvPContext = Map<string, number>;

// ── Caches ────────────────────────────────────────────────────────────────────

const _teamIdCache  = new Map<string, { map: Map<string, string>; expires: number }>();
const _statsCache   = new Map<string, { ptsAllowed: number; expires: number }>();

const TEAM_ID_TTL   = 7 * 24 * 60 * 60 * 1000;   // 7 days
const STATS_TTL     = 6  * 60 * 60 * 1000;         // 6 hours

// ── ESPN helpers ──────────────────────────────────────────────────────────────

async function espnFetch(url: string): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Fetch ESPN team ID → DK abbreviation map ─────────────────────────────────

async function getTeamIdMap(sport: string): Promise<Map<string, string>> {
  const ck = `${sport.toUpperCase()}:ids`;
  const cached = _teamIdCache.get(ck);
  if (cached && Date.now() < cached.expires) return cached.map;

  const url  = ESPN_TEAMS_URL[sport.toUpperCase()];
  if (!url) return new Map();

  const json = await espnFetch(url);
  if (!json) return new Map();

  // ESPN teams response: sports[0].leagues[0].teams[].team.{id, abbreviation}
  const teamsArr: any[] =
    json.sports?.[0]?.leagues?.[0]?.teams ??
    json.leagues?.[0]?.teams ??
    json.teams ?? [];

  const map = new Map<string, string>();   // abbreviation → ESPN ID
  for (const entry of teamsArr) {
    const t   = entry.team ?? entry;
    const id  = String(t.id || "");
    const abbr = (t.abbreviation || t.shortDisplayName || "").toUpperCase();
    if (id && abbr) map.set(abbr, id);
  }

  _teamIdCache.set(ck, { map, expires: Date.now() + TEAM_ID_TTL });
  console.log(`[DvPClient] Loaded ${map.size} ESPN team IDs for ${sport}`);
  return map;
}

// ── Fetch defensive pts-allowed for one team ─────────────────────────────────

async function fetchPtsAllowed(sport: string, espnTeamId: string): Promise<number | null> {
  const ck = `${sport}:${espnTeamId}`;
  const cached = _statsCache.get(ck);
  if (cached && Date.now() < cached.expires) return cached.ptsAllowed;

  const tmpl = ESPN_TEAM_STATS_URL[sport.toUpperCase()];
  if (!tmpl) return null;

  const url  = tmpl.replace("{id}", espnTeamId);
  const json = await espnFetch(url);
  if (!json) return null;

  // Parse ESPN statistics response — two common formats:
  // Format A: statistics.splits.categories[{name:"defensive", stats:[{name,value}]}]
  // Format B: statistics[{name:"oppg", value:"109.2"}]
  let pts: number | null = null;

  const splitsCategories = json.statistics?.splits?.categories as any[] | undefined;
  if (splitsCategories) {
    for (const cat of splitsCategories) {
      for (const stat of (cat.stats || [])) {
        const n = (stat.name || "").toLowerCase();
        if (["avgpointsallowed","opponentpointspergame","pointsallowed","oppg"].includes(n)) {
          pts = parseFloat(stat.value || stat.displayValue);
          break;
        }
      }
      if (pts !== null) break;
    }
  }

  if (pts === null) {
    const statsArr = json.statistics as any[] | undefined;
    if (Array.isArray(statsArr)) {
      for (const stat of statsArr) {
        const n = (stat.name || "").toLowerCase();
        if (["avgpointsallowed","oppg","opponentpointspergame","pointsallowed"].includes(n)) {
          pts = parseFloat(stat.value || stat.displayValue);
          break;
        }
      }
    }
  }

  if (pts !== null && !isNaN(pts)) {
    _statsCache.set(ck, { ptsAllowed: pts, expires: Date.now() + STATS_TTL });
    return pts;
  }

  return null;
}

// ── Main: build DvPContext for a slate ────────────────────────────────────────
// opponentMap: DK team abbreviation → opponent DK abbreviation
// e.g., { "GSW": "LAL", "LAL": "GSW" }

export async function buildDvPContext(
  opponentMap: Map<string, string>,
  sport: string,
): Promise<DvPContext> {
  const ctx: DvPContext = new Map();
  const sportUpper = sport.toUpperCase();

  if (!["NBA","NFL","MLB","NHL"].includes(sportUpper)) return ctx;

  const leagueAvg   = LEAGUE_AVG_PTS_ALLOWED[sportUpper] ?? 100;
  const teamIdMap   = await getTeamIdMap(sportUpper);

  // Collect unique opponent teams
  const opponents = new Set<string>(opponentMap.values());

  // Fetch defensive stats for all opponents in parallel
  const statResults = await Promise.all(
    [...opponents].map(async (opp) => {
      const espnId = teamIdMap.get(opp.toUpperCase());
      if (!espnId) return { opp, ptsAllowed: null };
      const pts = await fetchPtsAllowed(sportUpper, espnId);
      return { opp, ptsAllowed: pts };
    })
  );

  // Build a pts-allowed map for normalization
  const oppPts = new Map<string, number>();
  let fetchedCount = 0;
  for (const { opp, ptsAllowed } of statResults) {
    if (ptsAllowed !== null) {
      oppPts.set(opp.toUpperCase(), ptsAllowed);
      fetchedCount++;
    }
  }

  // Use fetched avg if we got data; fall back to hardcoded league avg
  const fetchedVals  = [...oppPts.values()];
  const contextAvg   = fetchedVals.length >= 2
    ? fetchedVals.reduce((a, b) => a + b, 0) / fetchedVals.length
    : leagueAvg;

  console.log(`[DvPClient] ${sportUpper}: fetched ${fetchedCount}/${opponents.size} opponent defensive stats, context avg: ${contextAvg.toFixed(1)}`);

  // Build per-opponent-team, per-position multipliers
  // We store entries as "OPPONENT_TEAM:POSITION" → multiplier
  const positions = Object.keys(POSITION_DvP_SENSITIVITY[sportUpper] || { UTIL: 1.0 });

  for (const oppTeam of opponents) {
    const pts      = oppPts.get(oppTeam.toUpperCase()) ?? contextAvg;
    const rawScore = pts / contextAvg;  // > 1.0 = weaker defense
    const clamped  = Math.max(MULT_MIN, Math.min(MULT_MAX, rawScore));

    for (const pos of positions) {
      const sensitivity = getPositionSensitivity(sportUpper, pos);
      const multiplier  = Math.round((1.0 + (clamped - 1.0) * sensitivity) * 1000) / 1000;
      ctx.set(`${oppTeam.toUpperCase()}:${pos}`, multiplier);
    }
  }

  return ctx;
}

// ── Apply DvP multipliers to projection overrides ────────────────────────────
// Returns a new projOverrides map with DvP-adjusted values.
// Players without opponent data keep their original projection.

export function applyDvPToProjections(
  pool:          Array<{ id: number; position: string; opponent?: string | null; team?: string | null }>,
  projOverrides: Record<number, number>,
  opponentMap:   Map<string, string>,  // team → opponent
  dvpCtx:        DvPContext,
  sport:         string,
): Record<number, number> {
  const adjusted: Record<number, number> = { ...projOverrides };

  for (const player of pool) {
    const baseProj = projOverrides[player.id];
    if (!baseProj || baseProj <= 0) continue;

    const team     = (player.team || "").toUpperCase();
    const opponent = opponentMap.get(team) || (player.opponent || "").toUpperCase();
    if (!opponent) continue;

    const pos = (player.position || "UTIL").split("/")[0].toUpperCase();
    const key = `${opponent}:${pos}`;

    const mult = dvpCtx.get(key);
    if (!mult) continue;

    // Clamp final adjustment — never more than 20% above/below original
    const newProj = Math.max(baseProj * 0.80, Math.min(baseProj * 1.20, baseProj * mult));
    adjusted[player.id] = Math.round(newProj * 100) / 100;
  }

  const adjustedCount = Object.entries(adjusted).filter(([id, v]) => v !== projOverrides[Number(id)]).length;
  if (adjustedCount > 0) {
    console.log(`[DvPClient] Adjusted ${adjustedCount} player projections via DvP`);
  }

  return adjusted;
}

// ── Build opponent map from player pool ───────────────────────────────────────
// Used by optimizer-route.ts to pass into both buildDvPContext and applyDvPToProjections.

export function buildOpponentMap(
  players: Array<{ team?: string | null; gameInfo?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of players) {
    if (!p.gameInfo) continue;
    const m = p.gameInfo.match(/^([A-Z0-9]+)\s*@\s*([A-Z0-9]+)/i)
            ?? p.gameInfo.match(/^([A-Z0-9]+)\s*vs\.?\s*([A-Z0-9]+)/i);
    if (!m) continue;
    const away = m[1].toUpperCase();
    const home = m[2].toUpperCase();
    map.set(away, home);
    map.set(home, away);
  }
  return map;
}
