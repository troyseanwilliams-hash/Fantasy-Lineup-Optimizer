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

// ── Full team name → DK abbreviation ─────────────────────────────────────────
// Covers Odds API full names, ESPN full names, and common variants.

const TEAM_NAME_TO_ABBR: Record<string, string> = {
  // NBA
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
  // NFL
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
  // MLB
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
  // NHL
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

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface VegasGameOdds {
  gameKey:     string;   // sorted DK abbr pair: "GSW-LAL"
  homeTeam:    string;   // DK abbr
  awayTeam:    string;   // DK abbr
  total:       number;   // over/under (e.g., 228.5)
  homeImplied: number;   // home team implied points total
  awayImplied: number;   // away team implied points total
  source:      "odds_api" | "espn" | "fallback";
}

export interface VegasContext {
  games:           Map<string, VegasGameOdds>;  // gameKey → odds
  teamImplied:     Map<string, number>;          // DK abbr → implied total
  slateAvgTotal:   number;                       // mean game total across slate
  slateAvgImplied: number;                       // mean team implied total
  sport:           string;
  source:          "odds_api" | "espn" | "none";
}

// ── Daily cache keyed by {sport}:{ET-date} ────────────────────────────────────

const _cache = new Map<string, { data: VegasGameOdds[]; expires: number }>();

function etDateStr(): string {
  const now = new Date();
  const et  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.toISOString().split("T")[0];
}

function cacheKey(sport: string): string {
  return `${sport.toUpperCase()}:${etDateStr()}`;
}

// ── American odds → implied probability ──────────────────────────────────────

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
  const sum = hp + ap;  // > 1.0 due to vig
  const normHome = hp / sum;
  const normAway = ap / sum;
  return {
    homeImplied: Math.round(total * normHome * 10) / 10,
    awayImplied: Math.round(total * normAway * 10) / 10,
  };
}

// ── The Odds API fetch ────────────────────────────────────────────────────────

async function fetchOddsAPI(sport: string): Promise<VegasGameOdds[] | null> {
  if (!ODDS_API_KEY) return null;
  const sportKey = ODDS_SPORT_KEYS[sport.toUpperCase()];
  if (!sportKey) return null;

  const url = `${ODDS_BASE}/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=totals,h2h&oddsFormat=american`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    // Log quota usage
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

    for (const g of games) {
      const homeAbbr = teamNameToAbbr(g.home_team);
      const awayAbbr = teamNameToAbbr(g.away_team);
      if (!homeAbbr || !awayAbbr) continue;

      // Prefer DraftKings bookmaker, fall back to any
      const bm = g.bookmakers?.find((b: any) => b.key === "draftkings")
              ?? g.bookmakers?.[0];
      if (!bm) continue;

      const totalsMarket  = bm.markets?.find((m: any) => m.key === "totals");
      const h2hMarket     = bm.markets?.find((m: any) => m.key === "h2h");

      const total = totalsMarket?.outcomes?.find((o: any) => o.name === "Over")?.point;
      if (!total) continue;

      // Moneyline prices for implied-total calculation
      const homeML = h2hMarket?.outcomes?.find((o: any) => o.name === g.home_team)?.price ?? null;
      const awayML = h2hMarket?.outcomes?.find((o: any) => o.name === g.away_team)?.price ?? null;

      const { homeImplied, awayImplied } = impliedTotals(total, homeML, awayML);
      const gameKey = [homeAbbr, awayAbbr].sort().join("-");

      result.push({ gameKey, homeTeam: homeAbbr, awayTeam: awayAbbr, total, homeImplied, awayImplied, source: "odds_api" });
    }

    console.log(`[VegasClient] Odds API: ${result.length} games for ${sport}`);
    return result;
  } catch (err: any) {
    console.warn(`[VegasClient] Odds API fetch failed: ${err.message}`);
    return null;
  }
}

// ── ESPN scoreboard fallback ──────────────────────────────────────────────────

async function fetchESPNOdds(sport: string): Promise<VegasGameOdds[]> {
  const url = ESPN_SCOREBOARD[sport.toUpperCase()];
  if (!url) return [];

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0)" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];

    const json: any = await res.json();
    const result: VegasGameOdds[] = [];

    for (const event of (json.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      // Extract team abbreviations from competitors
      const homeComp = comp.competitors?.find((c: any) => c.homeAway === "home");
      const awayComp = comp.competitors?.find((c: any) => c.homeAway === "away");
      const homeAbbr = homeComp?.team?.abbreviation?.toUpperCase();
      const awayAbbr = awayComp?.team?.abbreviation?.toUpperCase();
      if (!homeAbbr || !awayAbbr) continue;

      // Find odds (prefer DraftKings provider id "23")
      const odds = comp.odds?.find((o: any) => o.provider?.id === "23") ?? comp.odds?.[0];
      if (!odds?.overUnder) continue;

      const total   = Number(odds.overUnder);
      const homeML  = odds.homeTeamOdds?.moneyLine ?? null;
      const awayML  = odds.awayTeamOdds?.moneyLine ?? null;

      const { homeImplied, awayImplied } = impliedTotals(total, homeML, awayML);
      const gameKey = [homeAbbr, awayAbbr].sort().join("-");

      result.push({ gameKey, homeTeam: homeAbbr, awayTeam: awayAbbr, total, homeImplied, awayImplied, source: "espn" });
    }

    console.log(`[VegasClient] ESPN fallback: ${result.length} games with odds for ${sport}`);
    return result;
  } catch (err: any) {
    console.warn(`[VegasClient] ESPN odds fetch failed: ${err.message}`);
    return [];
  }
}

// ── Build VegasContext from player pool ───────────────────────────────────────

function extractGameKey(gameInfo: string): { home: string; away: string; key: string } | null {
  const m = gameInfo?.match(/^([A-Z0-9]+)\s*@\s*([A-Z0-9]+)/i)
          ?? gameInfo?.match(/^([A-Z0-9]+)\s*vs\.?\s*([A-Z0-9]+)/i);
  if (!m) return null;
  const away = m[1].toUpperCase();
  const home = m[2].toUpperCase();
  return { away, home, key: [away, home].sort().join("-") };
}

export async function buildVegasContext(
  players: Array<{ gameInfo?: string | null; team?: string | null }>,
  sport: string,
): Promise<VegasContext | null> {
  const ck = cacheKey(sport);

  // Return from cache if still valid (within same ET calendar day)
  const cached = _cache.get(ck);
  if (cached && Date.now() < cached.expires) {
    return assembleContext(cached.data, sport, cached.data[0]?.source ?? "odds_api");
  }

  // Fetch — try Odds API first, ESPN fallback second
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

  // Cache until next midnight ET
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

  return { games, teamImplied, slateAvgTotal, slateAvgImplied, sport, source };
}

export function clearVegasCache(): void {
  _cache.clear();
}
