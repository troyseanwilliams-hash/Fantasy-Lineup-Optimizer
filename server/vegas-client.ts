/**
 * vegas-client.ts
 *
 * Pulls game totals and team implied totals from The Odds API
 * (api.the-odds-api.com) with an ESPN scoreboard fallback.
 *
 * Free tier: 500 requests/month. Strategy:
 *   - Cache keyed by {sport}:{YYYY-MM-DD-ET} — one fetch per sport per calendar day
 *   - 4 sports × 1 fetch/day × 30 days = 120 requests/month maximum
 *   - ESPN fallback if quota exhausted (x-requests-remaining: 0)
 *
 * VegasContext flows into simulation-engine.ts where it:
 *   1. Widens game-level variance for high-total games
 *   2. Shifts team-level baselines for teams with above/below average implied totals
 */

import { parseGameInfo } from "@shared/game-info";
import { nflGameKey, normalizeNFLTeam } from "./nfl-team";

const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_BASE    = "https://api.the-odds-api.com/v4/sports";

const ODDS_SPORT_KEYS: Record<string, string> = {
  NBA:  "basketball_nba",
  NFL:  "americanfootball_nfl",
  MLB:  "baseball_mlb",
  NHL:  "icehockey_nhl",
};

const ESPN_SCOREBOARD: Record<string, string> = {
  NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
};

const TEAM_NAME_TO_ABBR: Record<string, string> = {
  "Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BKN",
  "Charlotte Hornets":"CHA","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE",
  "Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET",
  "Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND",
  "Los Angeles Clippers":"LAC","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM",
  "Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN",
  "New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC",
  "Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Philadelphia Sixers":"PHI",
  "Phoenix Suns":"PHX","Portland Trail Blazers":"POR","Sacramento Kings":"SAC",
  "San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA",
  "Washington Wizards":"WAS",
  "Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL",
  "Buffalo Bills":"BUF","Carolina Panthers":"CAR","Chicago Bears":"CHI",
  "Cincinnati Bengals":"CIN","Cleveland Browns":"CLE","Dallas Cowboys":"DAL",
  "Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB",
  "Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX",
  "Kansas City Chiefs":"KC","Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC",
  "Los Angeles Rams":"LAR","Miami Dolphins":"MIA","Minnesota Vikings":"MIN",
  "New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG",
  "New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT",
  "San Francisco 49ers":"SF","Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB",
  "Tennessee Titans":"TEN","Washington Commanders":"WAS","Washington Football Team":"WAS",
  "Arizona Diamondbacks":"ARI","Atlanta Braves":"ATL","Baltimore Orioles":"BAL",
  "Boston Red Sox":"BOS","Chicago Cubs":"CHC","Chicago White Sox":"CWS",
  "Cincinnati Reds":"CIN","Cleveland Guardians":"CLE","Colorado Rockies":"COL",
  "Detroit Tigers":"DET","Houston Astros":"HOU","Kansas City Royals":"KC",
  "Los Angeles Angels":"LAA","Los Angeles Dodgers":"LAD","Miami Marlins":"MIA",
  "Milwaukee Brewers":"MIL","Minnesota Twins":"MIN","New York Mets":"NYM",
  "New York Yankees":"NYY","Oakland Athletics":"OAK","Athletics":"OAK",
  "Philadelphia Phillies":"PHI","Pittsburgh Pirates":"PIT","San Diego Padres":"SD",
  "San Francisco Giants":"SF","Seattle Mariners":"SEA","St. Louis Cardinals":"STL",
  "Tampa Bay Rays":"TB","Texas Rangers":"TEX","Toronto Blue Jays":"TOR",
  "Washington Nationals":"WAS",
  "Anaheim Ducks":"ANA","Arizona Coyotes":"ARI","Boston Bruins":"BOS",
  "Buffalo Sabres":"BUF","Calgary Flames":"CGY","Carolina Hurricanes":"CAR",
  "Chicago Blackhawks":"CHI","Colorado Avalanche":"COL","Columbus Blue Jackets":"CBJ",
  "Dallas Stars":"DAL","Detroit Red Wings":"DET","Edmonton Oilers":"EDM",
  "Florida Panthers":"FLA","Los Angeles Kings":"LAK","Minnesota Wild":"MIN",
  "Montreal Canadiens":"MTL","Nashville Predators":"NSH","New Jersey Devils":"NJD",
  "New York Islanders":"NYI","New York Rangers":"NYR","Ottawa Senators":"OTT",
  "Philadelphia Flyers":"PHI","Pittsburgh Penguins":"PIT","San Jose Sharks":"SJS",
  "Seattle Kraken":"SEA","St. Louis Blues":"STL","Tampa Bay Lightning":"TBL",
  "Toronto Maple Leafs":"TOR","Utah Hockey Club":"UTA","Vancouver Canucks":"VAN",
  "Vegas Golden Knights":"VGK","Washington Capitals":"WSH","Winnipeg Jets":"WPG",
};

function teamNameToAbbr(fullName: string): string | null {
  return TEAM_NAME_TO_ABBR[fullName] ?? TEAM_NAME_TO_ABBR[fullName.trim()] ?? null;
}

export interface VegasGameOdds {
  gameKey:     string;
  homeTeam:    string;
  awayTeam:    string;
  total:       number;
  homeImplied: number;
  awayImplied: number;
  source:      "odds_api" | "espn" | "fallback";
  provider:    string;
  eventTime:   string;
  fetchedAt:   string;
  updatedAt:   string | null;
  favoriteTeam: string | null;
  spread:      number | null;
}

export interface VegasContext {
  games:           Map<string, VegasGameOdds>;
  teamImplied:     Map<string, number>;
  slateAvgTotal:   number;
  slateAvgImplied: number;
  sport:           string;
  source:          "odds_api" | "espn" | "none";
  provider:        string | null;
  fetchedAt:       string | null;
}

const _cache = new Map<string, { data: VegasGameOdds[]; expires: number }>();

function etDateStr(): string {
  const now = new Date();
  const et  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.toISOString().split("T")[0];
}

function cacheKey(sport: string): string {
  return `${sport.toUpperCase()}:${etDateStr()}`;
}

function americanToProb(price: number): number {
  if (price > 0) return 100 / (price + 100);
  return Math.abs(price) / (Math.abs(price) + 100);
}

function impliedTotals(
  total: number,
  homePrice: number | null,
  awayPrice: number | null,
): { homeImplied: number; awayImplied: number } {
  if (!homePrice || !awayPrice) {
    return { homeImplied: total / 2, awayImplied: total / 2 };
  }
  const hp  = americanToProb(homePrice);
  const ap  = americanToProb(awayPrice);
  const sum = hp + ap;
  const normHome = hp / sum;
  const normAway = ap / sum;
  return {
    homeImplied: Math.round(total * normHome * 10) / 10,
    awayImplied: Math.round(total * normAway * 10) / 10,
  };
}

async function fetchOddsAPI(sport: string): Promise<VegasGameOdds[] | null> {
  if (!ODDS_API_KEY) return null;
  const sportKey = ODDS_SPORT_KEYS[sport.toUpperCase()];
  if (!sportKey) return null;

  const url = `${ODDS_BASE}/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=totals,h2h&oddsFormat=american`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: ctrl.signal,
    });

    const remaining = res.headers.get("x-requests-remaining");
    const used      = res.headers.get("x-requests-used");
    if (remaining) console.log(`[VegasClient] Odds API quota: ${used} used, ${remaining} remaining`);

    if (res.status === 429) {
      console.warn("[VegasClient] Odds API quota exhausted — using ESPN fallback");
      return null;
    }
    if (!res.ok) {
      console.warn(`[VegasClient] Odds API HTTP ${res.status}`);
      return null;
    }

    const games: any[] = await res.json();
    const result: VegasGameOdds[] = [];
    const fetchedAt = new Date().toISOString();

    for (const g of games) {
      const homeAbbr = teamNameToAbbr(g.home_team);
      const awayAbbr = teamNameToAbbr(g.away_team);
      if (!homeAbbr || !awayAbbr) continue;

      const bm = g.bookmakers?.find((b: any) => b.key === "draftkings")
              ?? g.bookmakers?.[0];
      if (!bm) continue;

      const totalsMarket  = bm.markets?.find((m: any) => m.key === "totals");
      const h2hMarket     = bm.markets?.find((m: any) => m.key === "h2h");

      const total = totalsMarket?.outcomes?.find((o: any) => o.name === "Over")?.point;
      if (!total) continue;

      const homeML = h2hMarket?.outcomes?.find((o: any) => o.name === g.home_team)?.price ?? null;
      const awayML = h2hMarket?.outcomes?.find((o: any) => o.name === g.away_team)?.price ?? null;
      const favoriteTeam = Number.isFinite(Number(homeML)) && Number.isFinite(Number(awayML))
        ? Number(homeML) < Number(awayML) ? homeAbbr : Number(awayML) < Number(homeML) ? awayAbbr : null
        : null;

      const { homeImplied, awayImplied } = impliedTotals(total, homeML, awayML);
      const gameKey = [homeAbbr, awayAbbr].sort().join("-");

      result.push({
        gameKey, homeTeam: homeAbbr, awayTeam: awayAbbr, total, homeImplied, awayImplied,
        source: "odds_api", provider: bm.title || bm.key || "The Odds API",
        eventTime: new Date(g.commence_time).toISOString(), fetchedAt,
        updatedAt: bm.last_update && Number.isFinite(Date.parse(bm.last_update)) ? new Date(bm.last_update).toISOString() : null,
        favoriteTeam, spread: null,
      });
    }

    console.log(`[VegasClient] Odds API: ${result.length} games for ${sport}`);
    return result;
  } catch (err: any) {
    console.warn(`[VegasClient] Odds API fetch failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseESPNOdds(json: any, sport: string, fetchedAt = new Date().toISOString()): VegasGameOdds[] {
  const result: VegasGameOdds[] = [];
  const fetchedMs = Date.parse(fetchedAt);
  for (const event of (json?.events || [])) {
    const comp = event.competitions?.[0];
    const state = event.status?.type?.state ?? comp?.status?.type?.state;
    const eventMs = Date.parse(event.date ?? comp?.date ?? "");
    if (!comp || state !== "pre" || !Number.isFinite(eventMs) || eventMs <= fetchedMs) continue;

    const homeComp = comp.competitors?.find((c: any) => c.homeAway === "home");
    const awayComp = comp.competitors?.find((c: any) => c.homeAway === "away");
    const normalize = sport.toUpperCase() === "NFL" ? normalizeNFLTeam : (value: string) => String(value || "").trim().toUpperCase();
    const homeAbbr = normalize(homeComp?.team?.abbreviation);
    const awayAbbr = normalize(awayComp?.team?.abbreviation);
    if (!homeAbbr || !awayAbbr) continue;

    for (const odds of (comp.odds || [])) {
      const total = finiteNumber(odds?.overUnder);
      if (total === null || total <= 0) continue;
      const provider = String(odds.provider?.name || odds.provider?.displayName || odds.provider?.id || "").trim();
      if (!provider) continue;

      const details = String(odds.details || "").trim().toUpperCase();
      const detailMatch = details.match(/^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/);
      const detailTeam = detailMatch ? normalize(detailMatch[1]) : null;
      const detailSpread = detailMatch ? finiteNumber(detailMatch[2]) : null;
      const homeFavorite = odds.homeTeamOdds?.favorite === true;
      const awayFavorite = odds.awayTeamOdds?.favorite === true;
      const favoriteTeam = homeFavorite !== awayFavorite
        ? (homeFavorite ? homeAbbr : awayAbbr)
        : detailTeam === homeAbbr || detailTeam === awayAbbr ? detailTeam : null;
      const spread = detailSpread !== null && favoriteTeam ? Math.abs(detailSpread) : null;
      const homeImplied = spread !== null && favoriteTeam
        ? Math.round(((total + (favoriteTeam === homeAbbr ? spread : -spread)) / 2) * 10) / 10
        : total / 2;
      const awayImplied = Math.round((total - homeImplied) * 10) / 10;
      const updatedRaw = odds.lastUpdated || odds.lastUpdate || odds.updatedAt;
      const updatedAt = updatedRaw && Number.isFinite(Date.parse(updatedRaw)) ? new Date(updatedRaw).toISOString() : null;

      result.push({
        gameKey: sport.toUpperCase() === "NFL" ? nflGameKey(awayAbbr, homeAbbr) : [homeAbbr, awayAbbr].sort().join("-"),
        homeTeam: homeAbbr, awayTeam: awayAbbr, total, homeImplied, awayImplied,
        source: "espn", provider, eventTime: new Date(eventMs).toISOString(),
        fetchedAt: new Date(fetchedMs).toISOString(), updatedAt, favoriteTeam, spread,
      });
      break;
    }
  }
  return result;
}

async function fetchESPNOdds(sport: string): Promise<VegasGameOdds[]> {
  const url = ESPN_SCOREBOARD[sport.toUpperCase()];
  if (!url) return [];

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0)" },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];

    const json: any = await res.json();
    const result = parseESPNOdds(json, sport);

    console.log(`[VegasClient] ESPN fallback: ${result.length} games with odds for ${sport}`);
    return result;
  } catch (err: any) {
    console.warn(`[VegasClient] ESPN odds fetch failed: ${err.message}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

function extractGameKey(gameInfo: string): { home: string; away: string; key: string } | null {
  const parsed = parseGameInfo(gameInfo);
  if (!parsed.away || !parsed.home) return null;
  const away = normalizeNFLTeam(parsed.away);
  const home = normalizeNFLTeam(parsed.home);
  return { away, home, key: sportSafeGameKey(away, home) };
}

function sportSafeGameKey(away: string, home: string): string {
  return nflGameKey(away, home);
}

export async function buildVegasContext(
  players: Array<{ gameInfo?: string | null; team?: string | null }>,
  sport: string,
): Promise<VegasContext | null> {
  const ck = cacheKey(sport);

  const cached = _cache.get(ck);
  if (cached && Date.now() < cached.expires) {
    const rawSource = cached.data[0]?.source;
    const contextSource: VegasContext["source"] = rawSource === "odds_api" ? "odds_api" : rawSource === "espn" ? "espn" : "none";
    return assembleContext(cached.data, sport, contextSource);
  }

  let gameOdds = await fetchOddsAPI(sport);
  let source: VegasContext["source"] = "odds_api";

  if (!gameOdds || gameOdds.length === 0) {
    gameOdds = await fetchESPNOdds(sport);
    source = gameOdds.length > 0 ? "espn" : "none";
  }

  if (gameOdds.length === 0) {
    console.warn(`[VegasClient] No odds data available for ${sport}`);
    return null;
  }

  const nowET    = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const midnight = new Date(nowET);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - nowET.getTime();

  _cache.set(ck, { data: gameOdds, expires: Date.now() + msUntilMidnight });

  return assembleContext(gameOdds, sport, source);
}

function assembleContext(
  gameOdds: VegasGameOdds[],
  sport: string,
  source: VegasContext["source"],
): VegasContext {
  const games      = new Map<string, VegasGameOdds>();
  const teamImplied = new Map<string, number>();

  for (const g of gameOdds) {
    games.set(g.gameKey, g);
    teamImplied.set(g.homeTeam, g.homeImplied);
    teamImplied.set(g.awayTeam, g.awayImplied);
  }

  const totals     = gameOdds.map(g => g.total);
  const implieds   = [...teamImplied.values()];
  const slateAvgTotal   = totals.length   > 0 ? totals.reduce((a, b) => a + b, 0)   / totals.length   : 0;
  const slateAvgImplied = implieds.length > 0 ? implieds.reduce((a, b) => a + b, 0) / implieds.length : 0;

  return {
    games, teamImplied, slateAvgTotal, slateAvgImplied, sport, source,
    provider: gameOdds[0]?.provider ?? null,
    fetchedAt: gameOdds.map(game => game.fetchedAt).filter(Boolean).sort().at(-1) ?? null,
  };
}

export function clearVegasCache(): void {
  _cache.clear();
}
