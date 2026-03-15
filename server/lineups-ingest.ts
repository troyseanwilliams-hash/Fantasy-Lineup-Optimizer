import { db } from "./db";
import { players, slates } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { execSync } from "child_process";

const API_URL = "https://api.lineups.com/nba/fetch/lineups/gateway";

function fetchLineupsAPI(): any {
  const result = execSync(
    `curl -s "${API_URL}" ` +
    `-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
    `-H "Accept: application/json, text/plain, */*" ` +
    `-H "Origin: https://www.lineups.com" ` +
    `-H "Referer: https://www.lineups.com/"`,
    { encoding: "utf8", timeout: 15000 }
  );
  return JSON.parse(result);
}

interface LineupsPlayer {
  name: string;
  position: string;
  points: number;
  rating: number;
  assists: number;
  rebounds: number;
  draftkings_salary: number;
  draftkings_position: string;
  draftkings_projection: number;
  fanduel_salary: number;
  fanduel_position: string;
  fanduel_projection: number;
  first_dot_last: string;
  jersey: number;
  profile_url: string;
}

interface LineupsInjury {
  name: string;
  designation: string;
  profile_url: string;
}

interface LineupsGame {
  game_key: number;
  away_lineup_confirmed: boolean;
  home_lineup_confirmed: boolean;
  away_players: LineupsPlayer[];
  home_players: LineupsPlayer[];
  away_injuries: LineupsInjury[];
  home_injuries: LineupsInjury[];
  game_info: {
    header: {
      away: { away_full_name: string; confirmed: boolean };
      home: { home_full_name: string; confirmed: boolean };
      details: { away_short: string; home_short: string; game_time: string; stadium: string };
    };
    gateway: {
      day: string;
      away: { full_name: string; spread_live: number; moneyline_live: number; team_total_live: number };
      home: { full_name: string; spread_live: number; moneyline_live: number; team_total_live: number };
      over_under_live: number;
    };
  };
}

interface StartingLineupResult {
  gamesProcessed: number;
  playersMatched: number;
  confirmedLineups: number;
  projectionUpdates: number;
  injuryUpdates: number;
  errors: string[];
}

let cachedResult: { data: StartingLineupResult; timestamp: number } | null = null;
let cachedLineupsData: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;
let fetchInProgress = false;

const TEAM_ABBR_MAP: Record<string, string> = {
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
  "Golden State Warriors": "GS", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "LA Clippers": "LAC", "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL",
  "LA Lakers": "LAL", "Memphis Grizzlies": "MEM", "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NO", "New York Knicks": "NY", "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHO",
  "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SA", "Toronto Raptors": "TOR", "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

const INJURY_MAP: Record<string, string> = {
  "O": "Out",
  "D": "Doubtful",
  "Q": "Questionable",
  "P": "Probable",
  "GTD": "Game Time Decision",
};

function normalizePlayerName(name: string): string {
  return name.toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+jr$/i, "")
    .replace(/\s+sr$/i, "")
    .replace(/\s+iii$/i, "")
    .replace(/\s+ii$/i, "")
    .replace(/\s+iv$/i, "")
    .trim();
}

export async function fetchStartingLineups(): Promise<StartingLineupResult> {
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
    return cachedResult.data;
  }

  const result: StartingLineupResult = {
    gamesProcessed: 0,
    playersMatched: 0,
    confirmedLineups: 0,
    projectionUpdates: 0,
    injuryUpdates: 0,
    errors: [],
  };

  try {
    const data = fetchLineupsAPI() as { data: LineupsGame[] };
    const games = data?.data || [];
    if (games.length === 0) {
      result.errors.push("No games returned from lineups.com");
      return result;
    }

    const activeNBASlates = await db.select().from(slates).where(
      and(
        eq(slates.sport, "NBA"),
        eq(slates.platform, "draftkings"),
        eq(slates.isActive, true),
      )
    );

    if (activeNBASlates.length === 0) {
      result.errors.push("No active NBA DraftKings slates found");
      return result;
    }

    const slateIds = activeNBASlates.map(s => s.id);
    const allPlayers = await db.select().from(players).where(
      sql`${players.slateId} IN (${sql.join(slateIds.map(id => sql`${id}`), sql`, `)})`
    );

    const playersByNormName = new Map<string, typeof allPlayers>();
    for (const p of allPlayers) {
      const norm = normalizePlayerName(p.name);
      const existing = playersByNormName.get(norm) || [];
      existing.push(p);
      playersByNormName.set(norm, existing);
    }

    for (const game of games) {
      result.gamesProcessed++;
      const awayAbbr = game.game_info?.header?.details?.away_short || "";
      const homeAbbr = game.game_info?.header?.details?.home_short || "";

      if (game.away_lineup_confirmed) result.confirmedLineups++;
      if (game.home_lineup_confirmed) result.confirmedLineups++;

      const processStarters = async (
        lineupPlayers: LineupsPlayer[],
        teamAbbr: string,
        isConfirmed: boolean,
      ) => {
        for (const lp of lineupPlayers) {
          const normName = normalizePlayerName(lp.name);
          const matches = playersByNormName.get(normName);
          if (!matches || matches.length === 0) continue;

          result.playersMatched++;

          for (const dbPlayer of matches) {
            const updates: Record<string, any> = {};

            if (isConfirmed && !dbPlayer.isConfirmedStarter) {
              updates.isConfirmedStarter = true;
            }

            if (lp.draftkings_projection > 0) {
              const currentProj = parseFloat(dbPlayer.projectedPoints || "0");
              const apiProj = lp.draftkings_projection;
              if (Math.abs(currentProj - apiProj) > 0.5) {
                updates.projectedPoints = apiProj.toString();
                result.projectionUpdates++;
              }
            }

            if (Object.keys(updates).length > 0) {
              await db.update(players).set(updates).where(eq(players.id, dbPlayer.id));
            }
          }
        }
      };

      await processStarters(game.away_players || [], awayAbbr, game.away_lineup_confirmed);
      await processStarters(game.home_players || [], homeAbbr, game.home_lineup_confirmed);

      const processInjuries = async (injuries: LineupsInjury[], teamAbbr: string) => {
        for (const inj of injuries) {
          const parts = inj.name.split(". ");
          if (parts.length < 2) continue;
          const lastName = parts.slice(1).join(". ").toLowerCase();

          for (const [normName, dbPlayers] of playersByNormName) {
            if (normName.includes(lastName)) {
              const status = INJURY_MAP[inj.designation] || inj.designation;
              const teamMatched = dbPlayers.filter(p => {
                const pTeam = (p.team || "").toUpperCase();
                return pTeam === teamAbbr.toUpperCase() || !teamAbbr;
              });
              const targets = teamMatched.length > 0 ? teamMatched : [];
              for (const dbPlayer of targets) {
                if (dbPlayer.injuryStatus !== status) {
                  await db.update(players)
                    .set({ injuryStatus: status })
                    .where(eq(players.id, dbPlayer.id));
                  result.injuryUpdates++;
                }
              }
              if (targets.length > 0) break;
            }
          }
        }
      };

      await processInjuries(game.away_injuries || [], awayAbbr);
      await processInjuries(game.home_injuries || [], homeAbbr);
    }

    console.log(`[Lineups.com] Processed ${result.gamesProcessed} games, matched ${result.playersMatched} starters, ${result.confirmedLineups} confirmed lineups, ${result.projectionUpdates} projection updates, ${result.injuryUpdates} injury updates`);

    cachedResult = { data: result, timestamp: Date.now() };
    return result;
  } catch (err: any) {
    result.errors.push(err.message || "Unknown error");
    console.error("[Lineups.com] Error:", err.message);
    return result;
  }
}

function parseLineupsResponse(data: { data: LineupsGame[] }) {
  return (data.data || []).map(g => ({
    awayTeam: g.game_info?.header?.details?.away_short || "",
    homeTeam: g.game_info?.header?.details?.home_short || "",
    gameTime: g.game_info?.header?.details?.game_time || "",
    awayConfirmed: g.away_lineup_confirmed || false,
    homeConfirmed: g.home_lineup_confirmed || false,
    awayStarters: (g.away_players || []).map(p => ({
      name: p.name,
      position: p.draftkings_position || p.position,
      dkSalary: p.draftkings_salary,
      dkProjection: p.draftkings_projection,
      ppg: p.points,
      rating: p.rating,
    })),
    homeStarters: (g.home_players || []).map(p => ({
      name: p.name,
      position: p.draftkings_position || p.position,
      dkSalary: p.draftkings_salary,
      dkProjection: p.draftkings_projection,
      ppg: p.points,
      rating: p.rating,
    })),
    awayInjuries: (g.away_injuries || []).map(inj => ({
      name: inj.name,
      status: INJURY_MAP[inj.designation] || inj.designation,
    })),
    homeInjuries: (g.home_injuries || []).map(inj => ({
      name: inj.name,
      status: INJURY_MAP[inj.designation] || inj.designation,
    })),
    overUnder: g.game_info?.gateway?.over_under_live || 0,
    awaySpread: g.game_info?.gateway?.away?.spread_live || 0,
    homeSpread: g.game_info?.gateway?.home?.spread_live || 0,
  }));
}

function refreshLineupsDataAsync(): void {
  if (fetchInProgress) return;
  fetchInProgress = true;
  const { exec } = require("child_process") as typeof import("child_process");
  exec(
    `curl -s "${API_URL}" ` +
    `-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
    `-H "Accept: application/json, text/plain, */*" ` +
    `-H "Origin: https://www.lineups.com" ` +
    `-H "Referer: https://www.lineups.com/"`,
    { timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
    (err: any, stdout: string) => {
      fetchInProgress = false;
      if (err) {
        console.error("[Lineups.com] Async refresh failed:", err.message);
        return;
      }
      try {
        const data = JSON.parse(stdout);
        if (data?.data?.length > 0) {
          const games = parseLineupsResponse(data);
          cachedLineupsData = { data: { games, lastUpdated: new Date().toISOString() }, timestamp: Date.now() };
        }
      } catch (e: any) {
        console.error("[Lineups.com] Parse error:", e.message);
      }
    }
  );
}

export async function getStartingLineupsData(): Promise<{
  games: Array<{
    awayTeam: string;
    homeTeam: string;
    gameTime: string;
    awayConfirmed: boolean;
    homeConfirmed: boolean;
    awayStarters: Array<{ name: string; position: string; dkSalary: number; dkProjection: number; ppg: number; rating: number }>;
    homeStarters: Array<{ name: string; position: string; dkSalary: number; dkProjection: number; ppg: number; rating: number }>;
    awayInjuries: Array<{ name: string; status: string }>;
    homeInjuries: Array<{ name: string; status: string }>;
    overUnder: number;
    awaySpread: number;
    homeSpread: number;
  }>;
  lastUpdated: string;
} | null> {
  if (cachedLineupsData && Date.now() - cachedLineupsData.timestamp < CACHE_TTL) {
    return cachedLineupsData.data;
  }

  try {
    const data = fetchLineupsAPI() as { data: LineupsGame[] };
    if (!data?.data) return cachedLineupsData?.data || null;

    const games = parseLineupsResponse(data);
    const result = { games, lastUpdated: new Date().toISOString() };
    cachedLineupsData = { data: result, timestamp: Date.now() };

    return result;
  } catch (err: any) {
    console.error("[Lineups.com] getStartingLineupsData error:", err.message);
    if (cachedLineupsData) return cachedLineupsData.data;
    return null;
  }
}

export function clearLineupsCache(): void {
  cachedResult = null;
  cachedLineupsData = null;
}
