const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const SPORT_KEY_MAP: Record<string, string> = {
  NBA: "basketball_nba",
  NHL: "icehockey_nhl",
  MLB: "baseball_mlb",
  NFL: "americanfootball_nfl",
};

const PLAYER_PROP_MARKETS: Record<string, string[]> = {
  NBA: ["player_points", "player_rebounds", "player_assists", "player_threes", "player_points_rebounds_assists"],
  NHL: ["player_points", "player_shots_on_goal", "player_assists"],
  MLB: ["pitcher_strikeouts", "batter_hits", "batter_total_bases", "batter_home_runs"],
  NFL: ["player_pass_yds", "player_rush_yds", "player_receptions", "player_pass_tds", "player_reception_yds"],
};

const MARKET_DISPLAY_NAME: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  player_shots_on_goal: "Shots on Goal",
  pitcher_strikeouts: "Strikeouts",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  player_pass_yds: "Pass Yards",
  player_rush_yds: "Rush Yards",
  player_receptions: "Receptions",
  player_pass_tds: "Pass TDs",
  player_reception_yds: "Rec Yards",
};

interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface OddsOutcome {
  name: string;
  description: string;
  price: number;
  point: number;
}

interface OddsMarket {
  key: string;
  last_update: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

interface OddsEventWithOdds extends OddsEvent {
  bookmakers: OddsBookmaker[];
}

export interface ParsedProp {
  sport: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: string;
  pick: string;
  confidence: string;
  gameInfo: string;
  commenceTime: string;
  americanOdds: number;
}

function getApiKey(): string {
  return process.env.ODDS_API_KEY || "";
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const remaining = res.headers.get("x-requests-remaining");
      console.error(`[OddsAPI] Error ${res.status}: ${res.statusText} (remaining: ${remaining})`);
      return null;
    }
    const remaining = res.headers.get("x-requests-remaining");
    const used = res.headers.get("x-requests-used");
    console.log(`[OddsAPI] Quota — used: ${used}, remaining: ${remaining}`);
    return await res.json() as T;
  } catch (err) {
    console.error("[OddsAPI] Fetch error:", err);
    return null;
  }
}

export async function getEvents(sport: string): Promise<OddsEvent[]> {
  const sportKey = SPORT_KEY_MAP[sport];
  if (!sportKey) return [];
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const url = `${ODDS_API_BASE}/sports/${sportKey}/events?apiKey=${apiKey}`;
  const data = await fetchJson<OddsEvent[]>(url);
  return data || [];
}

export async function getEventPlayerProps(
  sport: string,
  eventId: string,
  homeTeam: string,
  awayTeam: string,
  commenceTime: string = ""
): Promise<ParsedProp[]> {
  const sportKey = SPORT_KEY_MAP[sport];
  if (!sportKey) return [];
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const markets = PLAYER_PROP_MARKETS[sport] || [];
  if (markets.length === 0) return [];

  const marketsParam = markets.join(",");
  const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&oddsFormat=american&bookmakers=draftkings`;

  const data = await fetchJson<OddsEventWithOdds>(url);
  if (!data || !data.bookmakers || data.bookmakers.length === 0) return [];

  const props: ParsedProp[] = [];
  const gameInfo = `${awayTeam} @ ${homeTeam}`;

  for (const bookmaker of data.bookmakers) {
    for (const market of bookmaker.markets) {
      const displayName = MARKET_DISPLAY_NAME[market.key] || market.key;

      const playerOutcomes = new Map<string, OddsOutcome[]>();
      for (const outcome of market.outcomes) {
        if (!outcome.description) continue;
        const key = `${outcome.description}_${outcome.point}`;
        if (!playerOutcomes.has(key)) playerOutcomes.set(key, []);
        playerOutcomes.get(key)!.push(outcome);
      }

      playerOutcomes.forEach((outcomes) => {
        const overOutcome = outcomes.find((o: OddsOutcome) => o.name === "Over");
        const underOutcome = outcomes.find((o: OddsOutcome) => o.name === "Under");
        if (!overOutcome || !underOutcome) return;

        const overProb = americanToImpliedProb(overOutcome.price);
        const underProb = americanToImpliedProb(underOutcome.price);

        let pick: string;
        let odds: number;
        let confidence: number;

        if (overProb >= underProb) {
          pick = "Over";
          odds = overOutcome.price;
          confidence = Math.min(85, Math.max(52, overProb * 100 * 0.95));
        } else {
          pick = "Under";
          odds = underOutcome.price;
          confidence = Math.min(85, Math.max(52, underProb * 100 * 0.95));
        }

        const playerName = overOutcome.description;
        const homeAbbr = abbreviateTeam(homeTeam);
        const awayAbbr = abbreviateTeam(awayTeam);
        const abbrevGameInfo = `${awayAbbr} @ ${homeAbbr}`;

        props.push({
          sport,
          playerName,
          team: homeAbbr,
          opponent: awayAbbr,
          propType: displayName,
          line: overOutcome.point.toString(),
          pick,
          confidence: confidence.toFixed(1),
          gameInfo: abbrevGameInfo,
          commenceTime,
          americanOdds: odds,
        });
      });
    }
  }

  return props;
}

function americanToImpliedProb(american: number): number {
  if (american < 0) {
    return Math.abs(american) / (Math.abs(american) + 100);
  }
  return 100 / (american + 100);
}

const TEAM_ABBREV: Record<string, string> = {
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
  "Golden State Warriors": "GS", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
  "Anaheim Ducks": "ANA", "Arizona Coyotes": "ARI", "Boston Bruins": "BOS",
  "Buffalo Sabres": "BUF", "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR",
  "Chicago Blackhawks": "CHI", "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ",
  "Dallas Stars": "DAL", "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM",
  "Florida Panthers": "FLA", "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN",
  "Montreal Canadiens": "MTL", "Nashville Predators": "NSH", "New Jersey Devils": "NJD",
  "New York Islanders": "NYI", "New York Rangers": "NYR", "Ottawa Senators": "OTT",
  "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS",
  "Seattle Kraken": "SEA", "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL",
  "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA", "Vancouver Canucks": "VAN",
  "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
  "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
  "Chicago Cubs": "CHC", "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE", "Colorado Rockies": "COL", "Houston Astros": "HOU",
  "Kansas City Royals": "KC", "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN",
  "New York Mets": "NYM", "New York Yankees": "NYY", "Oakland Athletics": "OAK",
  "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD",
  "San Francisco Giants": "SF", "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE", "Denver Broncos": "DEN", "Green Bay Packers": "GB",
  "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LAR",
  "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN", "New England Patriots": "NE",
  "New Orleans Saints": "NO", "New York Giants": "NYG", "New York Jets": "NYJ",
  "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

function abbreviateTeam(fullName: string): string {
  return TEAM_ABBREV[fullName] || fullName;
}

function guessTeam(playerName: string, homeTeam: string, awayTeam: string): string {
  return homeTeam;
}

export async function fetchAllPropsForSport(sport: string, maxEvents: number = 3, playerTeamMap?: Map<string, string>): Promise<ParsedProp[]> {
  const events = await getEvents(sport);
  if (events.length === 0) {
    console.log(`[OddsAPI] No events found for ${sport}`);
    return [];
  }

  const upcomingEvents = events
    .filter(e => new Date(e.commence_time) > new Date())
    .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime())
    .slice(0, maxEvents);

  if (upcomingEvents.length === 0) {
    console.log(`[OddsAPI] No upcoming events for ${sport}`);
    return [];
  }

  console.log(`[OddsAPI] Fetching props for ${upcomingEvents.length} ${sport} events`);

  const allProps: ParsedProp[] = [];
  for (const event of upcomingEvents) {
    try {
      const props = await getEventPlayerProps(sport, event.id, event.home_team, event.away_team, event.commence_time);
      if (playerTeamMap) {
        for (const prop of props) {
          const knownTeam = playerTeamMap.get(prop.playerName.toLowerCase());
          if (knownTeam) {
            const homeAbbr = abbreviateTeam(event.home_team);
            const awayAbbr = abbreviateTeam(event.away_team);
            prop.team = knownTeam;
            prop.opponent = knownTeam === homeAbbr ? awayAbbr : homeAbbr;
          }
        }
      }
      allProps.push(...props);
      console.log(`[OddsAPI] Got ${props.length} props from ${event.away_team} @ ${event.home_team}`);
    } catch (err) {
      console.error(`[OddsAPI] Error fetching props for event ${event.id}:`, err);
    }
  }

  return allProps;
}
