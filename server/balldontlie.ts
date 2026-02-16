import type { InsertPlayer } from "@shared/schema";

const BDL_BASE = "https://api.balldontlie.io";
const API_KEY = process.env.BALLDONTLIE_API_KEY || "";

interface BDLTeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string;
  weight: string;
  jersey_number: string;
  college: string;
  country: string;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: BDLTeam;
}

interface BDLGame {
  id: number;
  date: string;
  season: number;
  status: string;
  period: number;
  time: string;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team: BDLTeam;
  visitor_team: BDLTeam;
}

interface BDLResponse<T> {
  data: T[];
  meta: { next_cursor?: number; per_page: number };
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1200;

async function bdlFetch<T>(path: string, sport: string = "nba"): Promise<BDLResponse<T>> {
  if (!API_KEY) {
    console.log("[BDL] No API key configured, skipping fetch");
    return { data: [], meta: { per_page: 25 } };
  }

  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
  }

  const baseUrl = sport === "nba" ? `${BDL_BASE}/v1` : `${BDL_BASE}/${sport}/v1`;
  const url = `${baseUrl}${path}`;

  try {
    lastRequestTime = Date.now();
    const res = await fetch(url, {
      headers: { Authorization: API_KEY },
    });

    if (res.status === 429) {
      console.log("[BDL] Rate limited, waiting 60s...");
      await new Promise(r => setTimeout(r, 60000));
      lastRequestTime = Date.now();
      const retryRes = await fetch(url, { headers: { Authorization: API_KEY } });
      if (!retryRes.ok) {
        console.log(`[BDL] Retry failed: ${retryRes.status} ${await retryRes.text()}`);
        return { data: [], meta: { per_page: 25 } };
      }
      return retryRes.json();
    }

    if (!res.ok) {
      const text = await res.text();
      console.log(`[BDL] Error ${res.status}: ${text}`);
      return { data: [], meta: { per_page: 25 } };
    }

    return res.json();
  } catch (err) {
    console.error("[BDL] Fetch error:", err);
    return { data: [], meta: { per_page: 25 } };
  }
}

const NBA_POSITION_MAP: Record<string, string> = {
  G: "PG/SG",
  F: "SF/PF",
  C: "C",
  "G-F": "SG/SF",
  "F-G": "SF/SG",
  "F-C": "PF/C",
  "C-F": "C/PF",
  PG: "PG",
  SG: "SG",
  SF: "SF",
  PF: "PF",
};

function mapNBAPosition(pos: string): string {
  return NBA_POSITION_MAP[pos] || pos || "SF";
}

function generateSalaryAndProjection(
  playerIndex: number,
  totalPlayers: number,
  draftRound: number | null,
  _draftNumber: number | null,
  position: string,
  starTier?: number,
): { salary: number; projectedPoints: string; fppg: string } {
  let baseSalary: number;
  let baseProj: number;

  if (starTier === 1) {
    baseSalary = 9000 + Math.floor(Math.random() * 2200);
    baseProj = 42 + Math.random() * 13;
  } else if (starTier === 2) {
    baseSalary = 7200 + Math.floor(Math.random() * 2000);
    baseProj = 32 + Math.random() * 12;
  } else if (starTier === 3) {
    baseSalary = 5800 + Math.floor(Math.random() * 2000);
    baseProj = 25 + Math.random() * 10;
  } else {
    const tier = playerIndex / totalPlayers;
    if (draftRound === 1 && tier < 0.3) {
      baseSalary = 5500 + Math.floor(Math.random() * 2500);
      baseProj = 22 + Math.random() * 12;
    } else if (tier < 0.5) {
      baseSalary = 4500 + Math.floor(Math.random() * 2000);
      baseProj = 18 + Math.random() * 10;
    } else if (tier < 0.75) {
      baseSalary = 3800 + Math.floor(Math.random() * 1500);
      baseProj = 14 + Math.random() * 8;
    } else {
      baseSalary = 3000 + Math.floor(Math.random() * 1200);
      baseProj = 8 + Math.random() * 8;
    }
  }

  if (position.includes("C") && !position.includes("PG")) {
    baseSalary += 200;
    baseProj += 1.5;
  }
  if (position.includes("PG")) {
    baseProj += 1.0;
  }

  baseSalary = Math.round(baseSalary / 100) * 100;
  const projStr = baseProj.toFixed(1);

  return { salary: baseSalary, projectedPoints: projStr, fppg: projStr };
}

export interface LiveSlateData {
  sport: string;
  games: { away: string; home: string; time: string; date: string }[];
  slateDate: Date;
  dkPlayers: Omit<InsertPlayer, "slateId">[];
  fdPlayers: Omit<InsertPlayer, "slateId">[];
}

const NBA_GAME_TIMES = ["7:00PM", "7:30PM", "8:00PM", "8:30PM", "9:00PM", "9:30PM", "10:00PM", "10:30PM"];
let gameTimeIndex = 0;

function formatGameTime(dateStr: string, status: string): string {
  if (status && status !== "Final" && status.includes(":") && !status.includes("T") && !status.startsWith("0:")) {
    return status.replace(" ET", "").trim() + " ET";
  }
  try {
    const d = new Date(dateStr);
    const utcHours = d.getUTCHours();
    if (utcHours === 0 && d.getUTCMinutes() === 0) {
      const time = NBA_GAME_TIMES[gameTimeIndex % NBA_GAME_TIMES.length];
      gameTimeIndex++;
      return `${time} ET`;
    }
    const etOffset = -5;
    let etHours = utcHours + etOffset;
    if (etHours < 0) etHours += 24;
    const period = etHours >= 12 ? "PM" : "AM";
    const h = etHours > 12 ? etHours - 12 : etHours === 0 ? 12 : etHours;
    return `${h}:${d.getUTCMinutes().toString().padStart(2, "0")}${period} ET`;
  } catch {
    return "7:00PM ET";
  }
}

export async function fetchNBALiveData(): Promise<LiveSlateData | null> {
  if (!API_KEY) return null;
  gameTimeIndex = 0;

  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }

  const dateParams = dates.map(d => `dates[]=${d}`).join("&");
  const gamesRes = await bdlFetch<BDLGame>(`/games?${dateParams}&per_page=100`);

  if (!gamesRes.data || gamesRes.data.length === 0) {
    console.log("[BDL] No upcoming NBA games found in next 7 days");
    return null;
  }

  const futureGames = gamesRes.data.filter(g => g.status !== "Final");
  const gamesToUse = futureGames.length > 0 ? futureGames : gamesRes.data;

  const gamesByDate = new Map<string, BDLGame[]>();
  for (const game of gamesToUse) {
    const date = game.date.split("T")[0];
    if (!gamesByDate.has(date)) gamesByDate.set(date, []);
    gamesByDate.get(date)!.push(game);
  }

  let bestDate = "";
  let bestGames: BDLGame[] = [];
  for (const [date, games] of Array.from(gamesByDate.entries())) {
    if (games.length > bestGames.length) {
      bestDate = date;
      bestGames = games;
    }
  }

  if (bestGames.length === 0) {
    console.log("[BDL] No suitable game date found");
    return null;
  }

  console.log(`[BDL] Found ${bestGames.length} NBA games on ${bestDate}`);

  const teamIds = new Set<number>();
  const teamAbbrevMap = new Map<number, string>();
  const gameInfoMap = new Map<string, { opponent: string; gameInfo: string }>();

  for (const game of bestGames) {
    teamIds.add(game.home_team.id);
    teamIds.add(game.visitor_team.id);
    teamAbbrevMap.set(game.home_team.id, game.home_team.abbreviation);
    teamAbbrevMap.set(game.visitor_team.id, game.visitor_team.abbreviation);

    const timeStr = formatGameTime(game.date, game.status);

    const homeInfo = `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation} ${timeStr}`;
    const awayInfo = `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation} ${timeStr}`;
    gameInfoMap.set(game.home_team.abbreviation, {
      opponent: game.visitor_team.abbreviation,
      gameInfo: homeInfo,
    });
    gameInfoMap.set(game.visitor_team.abbreviation, {
      opponent: game.home_team.abbreviation,
      gameInfo: awayInfo,
    });
  }

  const allPlayers: BDLPlayer[] = [];
  const teamIdArr = Array.from(teamIds);
  const batchSize = 6;

  for (let i = 0; i < teamIdArr.length; i += batchSize) {
    const batch = teamIdArr.slice(i, i + batchSize);
    const teamParams = batch.map(id => `team_ids[]=${id}`).join("&");
    const playersRes = await bdlFetch<BDLPlayer>(`/players?${teamParams}&per_page=100`);
    allPlayers.push(...playersRes.data);

    if (playersRes.meta.next_cursor) {
      const page2 = await bdlFetch<BDLPlayer>(
        `/players?${teamParams}&per_page=100&cursor=${playersRes.meta.next_cursor}`
      );
      allPlayers.push(...page2.data);
    }
  }

  const VETERAN_STARS: Record<string, { pos: string; tier: number }> = {
    "LeBron James": { pos: "SF/PF", tier: 1 }, "Kevin Durant": { pos: "SF/PF", tier: 1 },
    "Giannis Antetokounmpo": { pos: "PF/C", tier: 1 }, "Nikola Jokic": { pos: "C", tier: 1 },
    "Stephen Curry": { pos: "PG/SG", tier: 1 }, "Joel Embiid": { pos: "C", tier: 1 },
    "Jayson Tatum": { pos: "SF/PF", tier: 1 }, "Luka Doncic": { pos: "PG/SG", tier: 1 },
    "Shai Gilgeous-Alexander": { pos: "PG/SG", tier: 1 }, "Anthony Edwards": { pos: "SG/SF", tier: 1 },
    "Donovan Mitchell": { pos: "SG/PG", tier: 1 }, "Trae Young": { pos: "PG", tier: 1 },
    "Damian Lillard": { pos: "PG", tier: 1 }, "Jimmy Butler": { pos: "SF/PF", tier: 1 },
    "Anthony Davis": { pos: "PF/C", tier: 1 }, "Bam Adebayo": { pos: "C/PF", tier: 2 },
    "Karl-Anthony Towns": { pos: "C/PF", tier: 2 }, "De'Aaron Fox": { pos: "PG", tier: 2 },
    "Devin Booker": { pos: "SG/SF", tier: 2 }, "Jaylen Brown": { pos: "SG/SF", tier: 2 },
    "Tyrese Haliburton": { pos: "PG/SG", tier: 2 }, "Ja Morant": { pos: "PG", tier: 2 },
    "Darius Garland": { pos: "PG", tier: 2 }, "Tyler Herro": { pos: "SG/PG", tier: 2 },
    "Cade Cunningham": { pos: "PG/SG", tier: 2 }, "Evan Mobley": { pos: "PF/C", tier: 2 },
    "Scottie Barnes": { pos: "SF/PF", tier: 2 }, "Paolo Banchero": { pos: "PF/SF", tier: 2 },
    "Brandon Ingram": { pos: "SF/PF", tier: 2 }, "Zion Williamson": { pos: "PF", tier: 2 },
    "LaMelo Ball": { pos: "PG/SG", tier: 2 }, "Jalen Brunson": { pos: "PG/SG", tier: 2 },
    "Kristaps Porzingis": { pos: "PF/C", tier: 2 }, "Myles Turner": { pos: "C/PF", tier: 3 },
    "Jarrett Allen": { pos: "C", tier: 3 }, "Anfernee Simons": { pos: "SG/PG", tier: 3 },
    "Mikal Bridges": { pos: "SF/SG", tier: 3 }, "Fred VanVleet": { pos: "PG/SG", tier: 3 },
    "Jalen Williams": { pos: "SG/SF", tier: 3 }, "Franz Wagner": { pos: "SF/PF", tier: 3 },
    "Desmond Bane": { pos: "SG/SF", tier: 3 }, "Michael Porter Jr.": { pos: "SF/PF", tier: 3 },
    "Lauri Markkanen": { pos: "PF/SF", tier: 3 }, "Miles Bridges": { pos: "SF/PF", tier: 3 },
    "Domantas Sabonis": { pos: "PF/C", tier: 2 }, "Pascal Siakam": { pos: "PF/SF", tier: 2 },
    "OG Anunoby": { pos: "SF/PF", tier: 3 }, "RJ Barrett": { pos: "SG/SF", tier: 3 },
    "Alperen Sengun": { pos: "C/PF", tier: 3 }, "Jalen Green": { pos: "SG", tier: 3 },
  };

  const bdlPlayers = allPlayers.filter(p => {
    if (!p.position || p.position.length === 0) return false;
    if (!teamIds.has(p.team.id)) return false;
    const fullName = `${p.first_name} ${p.last_name}`;
    if (VETERAN_STARS[fullName]) return true;
    if (p.draft_year && p.draft_year < 2021) return false;
    if (!p.draft_year && !p.jersey_number) return false;
    return true;
  });

  const byTeam = new Map<string, BDLPlayer[]>();
  for (const p of bdlPlayers) {
    const key = p.team.abbreviation;
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key)!.push(p);
  }

  const rosterPlayers: BDLPlayer[] = [];
  for (const [_team, teamPlayers] of Array.from(byTeam.entries())) {
    const sorted = [...teamPlayers].sort((a, b) => {
      const aName = `${a.first_name} ${a.last_name}`;
      const bName = `${b.first_name} ${b.last_name}`;
      const aStar = VETERAN_STARS[aName]?.tier || 99;
      const bStar = VETERAN_STARS[bName]?.tier || 99;
      if (aStar !== bStar) return aStar - bStar;
      const aRecent = a.draft_year ? (a.draft_year - 2000) : 0;
      const bRecent = b.draft_year ? (b.draft_year - 2000) : 0;
      return bRecent - aRecent;
    });
    rosterPlayers.push(...sorted.slice(0, 10));
  }

  console.log(`[BDL] Found ${rosterPlayers.length} players across ${teamIds.size} teams`);

  if (rosterPlayers.length < 20) {
    console.log("[BDL] Too few players found, skipping NBA live data");
    return null;
  }

  const sorted = [...rosterPlayers].sort((a, b) => {
    const aName = `${a.first_name} ${a.last_name}`;
    const bName = `${b.first_name} ${b.last_name}`;
    const aTier = VETERAN_STARS[aName]?.tier || 4;
    const bTier = VETERAN_STARS[bName]?.tier || 4;
    if (aTier !== bTier) return aTier - bTier;
    const aScore = (a.draft_round === 1 ? 60 - (a.draft_number || 30) : 5);
    const bScore = (b.draft_round === 1 ? 60 - (b.draft_number || 30) : 5);
    return bScore - aScore;
  });

  const maxPlayers = Math.min(sorted.length, 55);
  const selected = sorted.slice(0, maxPlayers);

  const dkPlayers: Omit<InsertPlayer, "slateId">[] = [];
  const fdPlayers: Omit<InsertPlayer, "slateId">[] = [];

  for (let i = 0; i < selected.length; i++) {
    const p = selected[i];
    const teamAbbrev = p.team.abbreviation;
    const info = gameInfoMap.get(teamAbbrev);
    const fullName = `${p.first_name} ${p.last_name}`;
    const starInfo = VETERAN_STARS[fullName];
    const pos = starInfo ? starInfo.pos : mapNBAPosition(p.position);

    const { salary, projectedPoints, fppg } = generateSalaryAndProjection(
      i, selected.length, p.draft_round, p.draft_number, pos, starInfo?.tier
    );

    const playerData = {
      name: `${p.first_name} ${p.last_name}`,
      team: teamAbbrev,
      position: pos,
      salary,
      fppg,
      projectedPoints,
      opponent: info?.opponent || "TBD",
      gameInfo: info?.gameInfo || `${teamAbbrev} TBD`,
    };

    dkPlayers.push(playerData);

    fdPlayers.push({
      ...playerData,
      salary: Math.round((salary / 50000) * 60000 / 100) * 100,
      fppg: (Number(fppg) * 0.92).toFixed(1),
      projectedPoints: (Number(projectedPoints) * 0.92).toFixed(1),
    });
  }

  const games = bestGames.map(g => ({
    away: g.visitor_team.abbreviation,
    home: g.home_team.abbreviation,
    time: formatGameTime(g.date, g.status),
    date: bestDate,
  }));

  const slateDate = new Date(bestDate + "T19:00:00-05:00");

  return {
    sport: "NBA",
    games,
    slateDate,
    dkPlayers,
    fdPlayers,
  };
}

function generateRollingDate(daysAhead: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(19, 0, 0, 0);
  return d;
}

export function getRollingSlateDate(sport: string): Date {
  switch (sport) {
    case "NBA": return generateRollingDate(2);
    case "NHL": return generateRollingDate(3);
    case "MLB": return generateRollingDate(3);
    case "NFL": return generateRollingDate(4);
    default: return generateRollingDate(3);
  }
}
