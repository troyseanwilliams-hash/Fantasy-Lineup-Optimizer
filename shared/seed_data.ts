import { type Player, type Slate } from "./schema";

export const NBA_SLATE_FEB_19_DK: Partial<Slate> = {
  sport: "NBA",
  platform: "draftkings",
  name: "NBA Main Slate",
  startTime: new Date("2026-02-19T19:00:00-05:00"),
  isMain: true,
};

export const NBA_SLATE_FEB_19_FD: Partial<Slate> = {
  sport: "NBA",
  platform: "fanduel",
  name: "NBA Main Slate",
  startTime: new Date("2026-02-19T19:00:00-05:00"),
  isMain: true,
};

export const NBA_GAMES_FEB_19 = [
  { away: "ATL", home: "PHI", time: "7:00PM ET" },
  { away: "BKN", home: "CLE", time: "7:00PM ET" },
  { away: "HOU", home: "CHA", time: "7:00PM ET" },
  { away: "IND", home: "WAS", time: "7:00PM ET" },
  { away: "DET", home: "NYK", time: "7:30PM ET" },
  { away: "TOR", home: "CHI", time: "8:00PM ET" },
  { away: "PHX", home: "SAS", time: "8:30PM ET" },
];

const BASE_PLAYERS: Omit<Partial<Player> & { name: string; team: string; position: string; salary: number }, 'id'>[] = [
  { name: "Victor Wembanyama", team: "SAS", position: "C", salary: 10500, fppg: "52.3", projectedPoints: "52.3", opponent: "PHX", gameInfo: "PHX @ SAS 8:30PM" },
  { name: "Cade Cunningham", team: "DET", position: "PG", salary: 10300, fppg: "51.3", projectedPoints: "51.3", opponent: "NYK", gameInfo: "DET @ NYK 7:30PM" },
  { name: "Jalen Johnson", team: "ATL", position: "PF/SF", salary: 10400, fppg: "51.0", projectedPoints: "51.0", opponent: "PHI", gameInfo: "ATL @ PHI 7:00PM" },
  { name: "Tyrese Maxey", team: "PHI", position: "PG/SG", salary: 9600, fppg: "48.0", projectedPoints: "48.0", opponent: "ATL", gameInfo: "PHI vs ATL 7:00PM" },
  { name: "James Harden", team: "CLE", position: "PG/SG", salary: 9000, fppg: "47.0", projectedPoints: "47.0", opponent: "BKN", gameInfo: "CLE vs BKN 7:00PM" },
  { name: "Donovan Mitchell", team: "CLE", position: "SG", salary: 9500, fppg: "45.5", projectedPoints: "45.5", opponent: "BKN", gameInfo: "CLE vs BKN 7:00PM" },
  { name: "Alperen Sengun", team: "HOU", position: "PF/C", salary: 9200, fppg: "43.5", projectedPoints: "43.5", opponent: "CHA", gameInfo: "HOU @ CHA 7:00PM" },
  { name: "LaMelo Ball", team: "CHA", position: "PG", salary: 8400, fppg: "43.0", projectedPoints: "43.0", opponent: "HOU", gameInfo: "CHA vs HOU 7:00PM" },
  { name: "Scottie Barnes", team: "TOR", position: "PF/SF", salary: 9100, fppg: "42.3", projectedPoints: "42.3", opponent: "CHI", gameInfo: "TOR @ CHI 8:00PM" },
  { name: "Brandon Miller", team: "CHA", position: "SF/SG", salary: 8000, fppg: "42.0", projectedPoints: "42.0", opponent: "HOU", gameInfo: "CHA vs HOU 7:00PM" },
  { name: "Jalen Brunson", team: "NYK", position: "PG", salary: 8900, fppg: "41.5", projectedPoints: "41.5", opponent: "DET", gameInfo: "NYK vs DET 7:30PM" },
  { name: "Pascal Siakam", team: "IND", position: "PF", salary: 8700, fppg: "40.8", projectedPoints: "40.8", opponent: "WAS", gameInfo: "IND @ WAS 7:00PM" },
  { name: "Kevin Durant", team: "HOU", position: "SF/PF", salary: 8600, fppg: "40.8", projectedPoints: "40.8", opponent: "CHA", gameInfo: "HOU @ CHA 7:00PM" },
  { name: "Jarrett Allen", team: "CLE", position: "C", salary: 7100, fppg: "40.3", projectedPoints: "40.3", opponent: "BKN", gameInfo: "CLE vs BKN 7:00PM" },
  { name: "Day'Ron Sharpe", team: "BKN", position: "C", salary: 5900, fppg: "40.0", projectedPoints: "40.0", opponent: "CLE", gameInfo: "BKN @ CLE 7:00PM" },
  { name: "Amen Thompson", team: "HOU", position: "PG/SG", salary: 8200, fppg: "38.3", projectedPoints: "38.3", opponent: "CHA", gameInfo: "HOU @ CHA 7:00PM" },
  { name: "Karl-Anthony Towns", team: "NYK", position: "C/PF", salary: 8000, fppg: "38.0", projectedPoints: "38.0", opponent: "DET", gameInfo: "NYK vs DET 7:30PM" },
  { name: "Kon Knueppel", team: "CHA", position: "SG", salary: 7100, fppg: "37.5", projectedPoints: "37.5", opponent: "HOU", gameInfo: "CHA vs HOU 7:00PM" },
  { name: "Brandon Ingram", team: "TOR", position: "SF/SG", salary: 8200, fppg: "35.8", projectedPoints: "35.8", opponent: "CHI", gameInfo: "TOR @ CHI 8:00PM" },
  { name: "VJ Edgecombe", team: "PHI", position: "SG/SF", salary: 6500, fppg: "35.5", projectedPoints: "35.5", opponent: "ATL", gameInfo: "PHI vs ATL 7:00PM" },
  { name: "Trae Young", team: "ATL", position: "PG", salary: 8800, fppg: "35.0", projectedPoints: "35.0", opponent: "PHI", gameInfo: "ATL @ PHI 7:00PM" },
  { name: "Devin Booker", team: "PHX", position: "SG/SF", salary: 8500, fppg: "34.5", projectedPoints: "34.5", opponent: "SAS", gameInfo: "PHX @ SAS 8:30PM" },
  { name: "Tyrese Haliburton", team: "IND", position: "PG", salary: 7800, fppg: "34.0", projectedPoints: "34.0", opponent: "WAS", gameInfo: "IND @ WAS 7:00PM" },
  { name: "OG Anunoby", team: "NYK", position: "SF/PF", salary: 6200, fppg: "33.5", projectedPoints: "33.5", opponent: "DET", gameInfo: "NYK vs DET 7:30PM" },
  { name: "Evan Mobley", team: "CLE", position: "PF/C", salary: 7400, fppg: "33.0", projectedPoints: "33.0", opponent: "BKN", gameInfo: "CLE vs BKN 7:00PM" },
  { name: "Keldon Johnson", team: "SAS", position: "SF/SG", salary: 5500, fppg: "32.5", projectedPoints: "32.5", opponent: "PHX", gameInfo: "PHX @ SAS 8:30PM" },
  { name: "Zach LaVine", team: "CHI", position: "SG/SF", salary: 7200, fppg: "32.0", projectedPoints: "32.0", opponent: "TOR", gameInfo: "CHI vs TOR 8:00PM" },
  { name: "Mikal Bridges", team: "NYK", position: "SF/SG", salary: 5800, fppg: "31.5", projectedPoints: "31.5", opponent: "DET", gameInfo: "NYK vs DET 7:30PM" },
  { name: "Jordan Poole", team: "WAS", position: "SG/PG", salary: 6800, fppg: "31.0", projectedPoints: "31.0", opponent: "IND", gameInfo: "WAS vs IND 7:00PM" },
  { name: "Josh Hart", team: "NYK", position: "SG/SF", salary: 5200, fppg: "30.5", projectedPoints: "30.5", opponent: "DET", gameInfo: "NYK vs DET 7:30PM" },
  { name: "De'Andre Hunter", team: "ATL", position: "SF/PF", salary: 4800, fppg: "30.0", projectedPoints: "30.0", opponent: "PHI", gameInfo: "ATL @ PHI 7:00PM" },
  { name: "Tobias Harris", team: "DET", position: "PF/SF", salary: 5400, fppg: "29.5", projectedPoints: "29.5", opponent: "NYK", gameInfo: "DET @ NYK 7:30PM" },
  { name: "Clint Capela", team: "ATL", position: "C", salary: 4500, fppg: "29.0", projectedPoints: "29.0", opponent: "PHI", gameInfo: "ATL @ PHI 7:00PM" },
  { name: "Fred VanVleet", team: "HOU", position: "PG/SG", salary: 6000, fppg: "28.5", projectedPoints: "28.5", opponent: "CHA", gameInfo: "HOU @ CHA 7:00PM" },
  { name: "Nikola Vucevic", team: "CHI", position: "C", salary: 6400, fppg: "28.0", projectedPoints: "28.0", opponent: "TOR", gameInfo: "CHI vs TOR 8:00PM" },
  { name: "Bradley Beal", team: "PHX", position: "SG", salary: 5600, fppg: "27.5", projectedPoints: "27.5", opponent: "SAS", gameInfo: "PHX @ SAS 8:30PM" },
  { name: "Cam Thomas", team: "BKN", position: "SG/PG", salary: 7000, fppg: "27.0", projectedPoints: "27.0", opponent: "CLE", gameInfo: "BKN @ CLE 7:00PM" },
  { name: "Coby White", team: "CHI", position: "PG/SG", salary: 5300, fppg: "26.5", projectedPoints: "26.5", opponent: "TOR", gameInfo: "CHI vs TOR 8:00PM" },
  { name: "Jusuf Nurkic", team: "PHX", position: "C", salary: 4900, fppg: "26.0", projectedPoints: "26.0", opponent: "SAS", gameInfo: "PHX @ SAS 8:30PM" },
  { name: "Jeremy Sochan", team: "SAS", position: "PF/SF", salary: 5100, fppg: "25.5", projectedPoints: "25.5", opponent: "PHX", gameInfo: "PHX @ SAS 8:30PM" },
  { name: "Dennis Schroder", team: "BKN", position: "PG", salary: 5700, fppg: "25.0", projectedPoints: "25.0", opponent: "CLE", gameInfo: "BKN @ CLE 7:00PM" },
  { name: "Kyle Kuzma", team: "WAS", position: "PF/SF", salary: 5000, fppg: "24.5", projectedPoints: "24.5", opponent: "IND", gameInfo: "WAS vs IND 7:00PM" },
  { name: "Jalen Duren", team: "DET", position: "C", salary: 5600, fppg: "24.0", projectedPoints: "24.0", opponent: "NYK", gameInfo: "DET @ NYK 7:30PM" },
  { name: "RJ Barrett", team: "TOR", position: "SG/SF", salary: 6100, fppg: "23.5", projectedPoints: "23.5", opponent: "CHI", gameInfo: "TOR @ CHI 8:00PM" },
  { name: "Myles Turner", team: "IND", position: "C/PF", salary: 5800, fppg: "23.0", projectedPoints: "23.0", opponent: "WAS", gameInfo: "IND @ WAS 7:00PM" },
  { name: "Alex Sarr", team: "WAS", position: "C/PF", salary: 6300, fppg: "22.5", projectedPoints: "22.5", opponent: "IND", gameInfo: "WAS vs IND 7:00PM" },
  { name: "Jalen Smith", team: "CHI", position: "PF/C", salary: 3800, fppg: "22.0", projectedPoints: "22.0", opponent: "TOR", gameInfo: "CHI vs TOR 8:00PM" },
  { name: "Onyeka Okongwu", team: "ATL", position: "C/PF", salary: 4200, fppg: "21.5", projectedPoints: "21.5", opponent: "PHI", gameInfo: "ATL @ PHI 7:00PM" },
];

function scaleSalaryForFD(dkSalary: number): number {
  return Math.round((dkSalary / 50000) * 60000 / 100) * 100;
}

function scaleProjForFD(dkProj: string): string {
  return (Number(dkProj) * 0.92).toFixed(1);
}

export const NBA_PLAYERS_FEB_19_DK = BASE_PLAYERS.map(p => ({ ...p }));

export const NBA_PLAYERS_FEB_19_FD = BASE_PLAYERS.map(p => ({
  ...p,
  salary: scaleSalaryForFD(p.salary),
  fppg: scaleProjForFD(p.fppg || "0"),
  projectedPoints: scaleProjForFD(p.projectedPoints?.toString() || "0"),
}));

// ===================== NHL SEED DATA =====================

export const NHL_SLATE_FEB_20_DK: Partial<Slate> = {
  sport: "NHL",
  platform: "draftkings",
  name: "NHL Main Slate",
  startTime: new Date("2026-02-20T19:00:00-05:00"),
  isMain: true,
};

export const NHL_SLATE_FEB_20_FD: Partial<Slate> = {
  sport: "NHL",
  platform: "fanduel",
  name: "NHL Main Slate",
  startTime: new Date("2026-02-20T19:00:00-05:00"),
  isMain: true,
};

export const NHL_GAMES_FEB_20 = [
  { away: "BOS", home: "TOR", time: "7:00PM ET" },
  { away: "NYR", home: "PIT", time: "7:00PM ET" },
  { away: "CAR", home: "FLA", time: "7:00PM ET" },
  { away: "COL", home: "DAL", time: "8:00PM ET" },
  { away: "EDM", home: "VGK", time: "9:00PM ET" },
  { away: "VAN", home: "SEA", time: "10:00PM ET" },
];

const NHL_BASE_PLAYERS: Omit<Partial<Player> & { name: string; team: string; position: string; salary: number }, 'id'>[] = [
  { name: "Connor McDavid", team: "EDM", position: "C", salary: 8500, fppg: "45.0", projectedPoints: "45.0", opponent: "VGK", gameInfo: "EDM @ VGK 9:00PM" },
  { name: "Nathan MacKinnon", team: "COL", position: "C", salary: 8400, fppg: "44.0", projectedPoints: "44.0", opponent: "DAL", gameInfo: "COL @ DAL 8:00PM" },
  { name: "Auston Matthews", team: "TOR", position: "C", salary: 8200, fppg: "42.5", projectedPoints: "42.5", opponent: "BOS", gameInfo: "TOR vs BOS 7:00PM" },
  { name: "Nikita Kucherov", team: "FLA", position: "W", salary: 8300, fppg: "43.0", projectedPoints: "43.0", opponent: "CAR", gameInfo: "FLA vs CAR 7:00PM" },
  { name: "Leon Draisaitl", team: "EDM", position: "C", salary: 8100, fppg: "41.5", projectedPoints: "41.5", opponent: "VGK", gameInfo: "EDM @ VGK 9:00PM" },
  { name: "Artemi Panarin", team: "NYR", position: "W", salary: 7800, fppg: "40.0", projectedPoints: "40.0", opponent: "PIT", gameInfo: "NYR @ PIT 7:00PM" },
  { name: "David Pastrnak", team: "BOS", position: "W", salary: 7900, fppg: "39.5", projectedPoints: "39.5", opponent: "TOR", gameInfo: "BOS @ TOR 7:00PM" },
  { name: "Mitch Marner", team: "TOR", position: "W", salary: 7600, fppg: "38.0", projectedPoints: "38.0", opponent: "BOS", gameInfo: "TOR vs BOS 7:00PM" },
  { name: "Sidney Crosby", team: "PIT", position: "C", salary: 7500, fppg: "37.5", projectedPoints: "37.5", opponent: "NYR", gameInfo: "PIT vs NYR 7:00PM" },
  { name: "Sebastian Aho", team: "CAR", position: "C", salary: 7300, fppg: "36.5", projectedPoints: "36.5", opponent: "FLA", gameInfo: "CAR @ FLA 7:00PM" },
  { name: "Cale Makar", team: "COL", position: "D", salary: 7700, fppg: "38.5", projectedPoints: "38.5", opponent: "DAL", gameInfo: "COL @ DAL 8:00PM" },
  { name: "Adam Fox", team: "NYR", position: "D", salary: 7200, fppg: "35.0", projectedPoints: "35.0", opponent: "PIT", gameInfo: "NYR @ PIT 7:00PM" },
  { name: "Aleksander Barkov", team: "FLA", position: "C", salary: 7100, fppg: "34.5", projectedPoints: "34.5", opponent: "CAR", gameInfo: "FLA vs CAR 7:00PM" },
  { name: "Jack Eichel", team: "VGK", position: "C", salary: 7000, fppg: "34.0", projectedPoints: "34.0", opponent: "EDM", gameInfo: "VGK vs EDM 9:00PM" },
  { name: "Andrei Svechnikov", team: "CAR", position: "W", salary: 6800, fppg: "33.0", projectedPoints: "33.0", opponent: "FLA", gameInfo: "CAR @ FLA 7:00PM" },
  { name: "Mikko Rantanen", team: "COL", position: "W", salary: 7400, fppg: "37.0", projectedPoints: "37.0", opponent: "DAL", gameInfo: "COL @ DAL 8:00PM" },
  { name: "Jason Robertson", team: "DAL", position: "W", salary: 6900, fppg: "33.5", projectedPoints: "33.5", opponent: "COL", gameInfo: "DAL vs COL 8:00PM" },
  { name: "Elias Pettersson", team: "VAN", position: "C", salary: 6700, fppg: "32.0", projectedPoints: "32.0", opponent: "SEA", gameInfo: "VAN @ SEA 10:00PM" },
  { name: "Roope Hintz", team: "DAL", position: "C", salary: 6500, fppg: "31.0", projectedPoints: "31.0", opponent: "COL", gameInfo: "DAL vs COL 8:00PM" },
  { name: "Brad Marchand", team: "BOS", position: "W", salary: 6600, fppg: "31.5", projectedPoints: "31.5", opponent: "TOR", gameInfo: "BOS @ TOR 7:00PM" },
  { name: "Jake Guentzel", team: "FLA", position: "W", salary: 6400, fppg: "30.5", projectedPoints: "30.5", opponent: "CAR", gameInfo: "FLA vs CAR 7:00PM" },
  { name: "Evan Bouchard", team: "EDM", position: "D", salary: 6300, fppg: "30.0", projectedPoints: "30.0", opponent: "VGK", gameInfo: "EDM @ VGK 9:00PM" },
  { name: "Quinn Hughes", team: "VAN", position: "D", salary: 6200, fppg: "29.5", projectedPoints: "29.5", opponent: "SEA", gameInfo: "VAN @ SEA 10:00PM" },
  { name: "Miro Heiskanen", team: "DAL", position: "D", salary: 6100, fppg: "29.0", projectedPoints: "29.0", opponent: "COL", gameInfo: "DAL vs COL 8:00PM" },
  { name: "Jared McCann", team: "SEA", position: "C", salary: 5900, fppg: "28.0", projectedPoints: "28.0", opponent: "VAN", gameInfo: "SEA vs VAN 10:00PM" },
  { name: "Chris Kreider", team: "NYR", position: "W", salary: 5800, fppg: "27.5", projectedPoints: "27.5", opponent: "PIT", gameInfo: "NYR @ PIT 7:00PM" },
  { name: "Evgeni Malkin", team: "PIT", position: "C", salary: 5700, fppg: "27.0", projectedPoints: "27.0", opponent: "NYR", gameInfo: "PIT vs NYR 7:00PM" },
  { name: "William Nylander", team: "TOR", position: "W", salary: 7000, fppg: "35.5", projectedPoints: "35.5", opponent: "BOS", gameInfo: "TOR vs BOS 7:00PM" },
  { name: "Mark Stone", team: "VGK", position: "W", salary: 5600, fppg: "26.5", projectedPoints: "26.5", opponent: "EDM", gameInfo: "VGK vs EDM 9:00PM" },
  { name: "Kris Letang", team: "PIT", position: "D", salary: 5500, fppg: "26.0", projectedPoints: "26.0", opponent: "NYR", gameInfo: "PIT vs NYR 7:00PM" },
  { name: "Charlie McAvoy", team: "BOS", position: "D", salary: 5400, fppg: "25.5", projectedPoints: "25.5", opponent: "TOR", gameInfo: "BOS @ TOR 7:00PM" },
  { name: "Brock Boeser", team: "VAN", position: "W", salary: 5300, fppg: "25.0", projectedPoints: "25.0", opponent: "SEA", gameInfo: "VAN @ SEA 10:00PM" },
  { name: "Morgan Rielly", team: "TOR", position: "D", salary: 5200, fppg: "24.5", projectedPoints: "24.5", opponent: "BOS", gameInfo: "TOR vs BOS 7:00PM" },
  { name: "Alex Shesterkin", team: "NYR", position: "G", salary: 8000, fppg: "30.0", projectedPoints: "30.0", opponent: "PIT", gameInfo: "NYR @ PIT 7:00PM" },
  { name: "Sergei Bobrovsky", team: "FLA", position: "G", salary: 7500, fppg: "28.0", projectedPoints: "28.0", opponent: "CAR", gameInfo: "FLA vs CAR 7:00PM" },
  { name: "Stuart Skinner", team: "EDM", position: "G", salary: 6500, fppg: "22.0", projectedPoints: "22.0", opponent: "VGK", gameInfo: "EDM @ VGK 9:00PM" },
  { name: "Joseph Woll", team: "TOR", position: "G", salary: 6000, fppg: "20.0", projectedPoints: "20.0", opponent: "BOS", gameInfo: "TOR vs BOS 7:00PM" },
  { name: "Vince Dunn", team: "SEA", position: "D", salary: 4800, fppg: "20.5", projectedPoints: "20.5", opponent: "VAN", gameInfo: "SEA vs VAN 10:00PM" },
  { name: "Matty Beniers", team: "SEA", position: "C", salary: 4500, fppg: "19.0", projectedPoints: "19.0", opponent: "VAN", gameInfo: "SEA vs VAN 10:00PM" },
  { name: "Bryan Rust", team: "PIT", position: "W", salary: 4200, fppg: "18.0", projectedPoints: "18.0", opponent: "NYR", gameInfo: "PIT vs NYR 7:00PM" },
];

function scaleSalaryForNHL(dkSalary: number): number {
  return Math.round((dkSalary / 50000) * 55000 / 100) * 100;
}

export const NHL_PLAYERS_FEB_20_DK = NHL_BASE_PLAYERS.map(p => ({ ...p }));

export const NHL_PLAYERS_FEB_20_FD = NHL_BASE_PLAYERS.map(p => ({
  ...p,
  salary: scaleSalaryForNHL(p.salary),
  fppg: scaleProjForFD(p.fppg || "0"),
  projectedPoints: scaleProjForFD(p.projectedPoints?.toString() || "0"),
}));

// ===================== MLB SEED DATA =====================

export const MLB_SLATE_FEB_20_DK: Partial<Slate> = {
  sport: "MLB",
  platform: "draftkings",
  name: "MLB Main Slate",
  startTime: new Date("2026-02-20T19:05:00-05:00"),
  isMain: true,
};

export const MLB_SLATE_FEB_20_FD: Partial<Slate> = {
  sport: "MLB",
  platform: "fanduel",
  name: "MLB Main Slate",
  startTime: new Date("2026-02-20T19:05:00-05:00"),
  isMain: true,
};

export const MLB_GAMES_FEB_20 = [
  { away: "NYY", home: "BOS", time: "7:05PM ET" },
  { away: "LAD", home: "ATL", time: "7:20PM ET" },
  { away: "HOU", home: "PHI", time: "7:05PM ET" },
  { away: "CHC", home: "STL", time: "7:45PM ET" },
  { away: "SEA", home: "TEX", time: "8:05PM ET" },
  { away: "SD", home: "SF", time: "9:45PM ET" },
  { away: "NYM", home: "MIA", time: "6:40PM ET" },
];

const MLB_BASE_PLAYERS: Omit<Partial<Player> & { name: string; team: string; position: string; salary: number }, 'id'>[] = [
  { name: "Shohei Ohtani", team: "LAD", position: "P", salary: 10500, fppg: "25.0", projectedPoints: "25.0", opponent: "ATL", gameInfo: "LAD @ ATL 7:20PM" },
  { name: "Gerrit Cole", team: "NYY", position: "P", salary: 10200, fppg: "24.0", projectedPoints: "24.0", opponent: "BOS", gameInfo: "NYY @ BOS 7:05PM" },
  { name: "Spencer Strider", team: "ATL", position: "P", salary: 9800, fppg: "23.0", projectedPoints: "23.0", opponent: "LAD", gameInfo: "ATL vs LAD 7:20PM" },
  { name: "Framber Valdez", team: "HOU", position: "P", salary: 9200, fppg: "21.5", projectedPoints: "21.5", opponent: "PHI", gameInfo: "HOU @ PHI 7:05PM" },
  { name: "Zack Wheeler", team: "PHI", position: "P", salary: 9500, fppg: "22.5", projectedPoints: "22.5", opponent: "HOU", gameInfo: "PHI vs HOU 7:05PM" },
  { name: "Logan Webb", team: "SF", position: "P", salary: 8800, fppg: "20.5", projectedPoints: "20.5", opponent: "SD", gameInfo: "SF vs SD 9:45PM" },
  { name: "Luis Castillo", team: "SEA", position: "P", salary: 8500, fppg: "19.5", projectedPoints: "19.5", opponent: "TEX", gameInfo: "SEA @ TEX 8:05PM" },
  { name: "Sonny Gray", team: "STL", position: "P", salary: 8200, fppg: "18.5", projectedPoints: "18.5", opponent: "CHC", gameInfo: "STL vs CHC 7:45PM" },
  { name: "Aaron Judge", team: "NYY", position: "OF", salary: 6500, fppg: "18.0", projectedPoints: "18.0", opponent: "BOS", gameInfo: "NYY @ BOS 7:05PM" },
  { name: "Mookie Betts", team: "LAD", position: "OF", salary: 6300, fppg: "17.5", projectedPoints: "17.5", opponent: "ATL", gameInfo: "LAD @ ATL 7:20PM" },
  { name: "Ronald Acuna Jr.", team: "ATL", position: "OF", salary: 6200, fppg: "17.0", projectedPoints: "17.0", opponent: "LAD", gameInfo: "ATL vs LAD 7:20PM" },
  { name: "Juan Soto", team: "NYY", position: "OF", salary: 6100, fppg: "16.5", projectedPoints: "16.5", opponent: "BOS", gameInfo: "NYY @ BOS 7:05PM" },
  { name: "Freddie Freeman", team: "LAD", position: "1B", salary: 5900, fppg: "16.0", projectedPoints: "16.0", opponent: "ATL", gameInfo: "LAD @ ATL 7:20PM" },
  { name: "Trea Turner", team: "PHI", position: "SS", salary: 5800, fppg: "15.5", projectedPoints: "15.5", opponent: "HOU", gameInfo: "PHI vs HOU 7:05PM" },
  { name: "Corey Seager", team: "TEX", position: "SS", salary: 5700, fppg: "15.0", projectedPoints: "15.0", opponent: "SEA", gameInfo: "TEX vs SEA 8:05PM" },
  { name: "Rafael Devers", team: "BOS", position: "3B", salary: 5600, fppg: "14.5", projectedPoints: "14.5", opponent: "NYY", gameInfo: "BOS vs NYY 7:05PM" },
  { name: "Jose Altuve", team: "HOU", position: "2B", salary: 5500, fppg: "14.0", projectedPoints: "14.0", opponent: "PHI", gameInfo: "HOU @ PHI 7:05PM" },
  { name: "Marcus Semien", team: "TEX", position: "2B", salary: 5400, fppg: "13.5", projectedPoints: "13.5", opponent: "SEA", gameInfo: "TEX vs SEA 8:05PM" },
  { name: "Kyle Tucker", team: "HOU", position: "OF", salary: 5800, fppg: "15.5", projectedPoints: "15.5", opponent: "PHI", gameInfo: "HOU @ PHI 7:05PM" },
  { name: "Julio Rodriguez", team: "SEA", position: "OF", salary: 5300, fppg: "13.0", projectedPoints: "13.0", opponent: "TEX", gameInfo: "SEA @ TEX 8:05PM" },
  { name: "Matt Olson", team: "ATL", position: "1B", salary: 5200, fppg: "12.5", projectedPoints: "12.5", opponent: "LAD", gameInfo: "ATL vs LAD 7:20PM" },
  { name: "Bryce Harper", team: "PHI", position: "1B", salary: 5700, fppg: "15.0", projectedPoints: "15.0", opponent: "HOU", gameInfo: "PHI vs HOU 7:05PM" },
  { name: "Pete Alonso", team: "NYM", position: "1B", salary: 5000, fppg: "12.0", projectedPoints: "12.0", opponent: "MIA", gameInfo: "NYM @ MIA 6:40PM" },
  { name: "Francisco Lindor", team: "NYM", position: "SS", salary: 5500, fppg: "14.0", projectedPoints: "14.0", opponent: "MIA", gameInfo: "NYM @ MIA 6:40PM" },
  { name: "Manny Machado", team: "SD", position: "3B", salary: 5100, fppg: "12.5", projectedPoints: "12.5", opponent: "SF", gameInfo: "SD @ SF 9:45PM" },
  { name: "Nolan Arenado", team: "STL", position: "3B", salary: 4800, fppg: "11.5", projectedPoints: "11.5", opponent: "CHC", gameInfo: "STL vs CHC 7:45PM" },
  { name: "Dansby Swanson", team: "CHC", position: "SS", salary: 4700, fppg: "11.0", projectedPoints: "11.0", opponent: "STL", gameInfo: "CHC @ STL 7:45PM" },
  { name: "J.T. Realmuto", team: "PHI", position: "C", salary: 4600, fppg: "10.5", projectedPoints: "10.5", opponent: "HOU", gameInfo: "PHI vs HOU 7:05PM" },
  { name: "Will Smith", team: "LAD", position: "C", salary: 4500, fppg: "10.0", projectedPoints: "10.0", opponent: "ATL", gameInfo: "LAD @ ATL 7:20PM" },
  { name: "Adley Rutschman", team: "MIA", position: "C", salary: 4400, fppg: "9.5", projectedPoints: "9.5", opponent: "NYM", gameInfo: "MIA vs NYM 6:40PM" },
  { name: "Sean Murphy", team: "ATL", position: "C", salary: 4200, fppg: "9.0", projectedPoints: "9.0", opponent: "LAD", gameInfo: "ATL vs LAD 7:20PM" },
  { name: "Fernando Tatis Jr.", team: "SD", position: "OF", salary: 5600, fppg: "14.5", projectedPoints: "14.5", opponent: "SF", gameInfo: "SD @ SF 9:45PM" },
  { name: "Yordan Alvarez", team: "HOU", position: "OF", salary: 5400, fppg: "13.5", projectedPoints: "13.5", opponent: "PHI", gameInfo: "HOU @ PHI 7:05PM" },
  { name: "Mike Trout", team: "SEA", position: "OF", salary: 4900, fppg: "12.0", projectedPoints: "12.0", opponent: "TEX", gameInfo: "SEA @ TEX 8:05PM" },
  { name: "Ian Happ", team: "CHC", position: "OF", salary: 4300, fppg: "10.0", projectedPoints: "10.0", opponent: "STL", gameInfo: "CHC @ STL 7:45PM" },
  { name: "Ozzie Albies", team: "ATL", position: "2B", salary: 4600, fppg: "11.0", projectedPoints: "11.0", opponent: "LAD", gameInfo: "ATL vs LAD 7:20PM" },
  { name: "Gleyber Torres", team: "NYY", position: "2B", salary: 4100, fppg: "9.0", projectedPoints: "9.0", opponent: "BOS", gameInfo: "NYY @ BOS 7:05PM" },
  { name: "Alex Bregman", team: "HOU", position: "3B", salary: 4900, fppg: "12.0", projectedPoints: "12.0", opponent: "PHI", gameInfo: "HOU @ PHI 7:05PM" },
  { name: "Austin Riley", team: "ATL", position: "3B", salary: 4500, fppg: "10.5", projectedPoints: "10.5", opponent: "LAD", gameInfo: "ATL vs LAD 7:20PM" },
  { name: "Brandon Crawford", team: "SF", position: "SS", salary: 3500, fppg: "7.5", projectedPoints: "7.5", opponent: "SD", gameInfo: "SF vs SD 9:45PM" },
  { name: "Starling Marte", team: "NYM", position: "OF", salary: 3800, fppg: "8.5", projectedPoints: "8.5", opponent: "MIA", gameInfo: "NYM @ MIA 6:40PM" },
  { name: "Lars Nootbaar", team: "STL", position: "OF", salary: 3400, fppg: "7.0", projectedPoints: "7.0", opponent: "CHC", gameInfo: "STL vs CHC 7:45PM" },
  { name: "Jose Ramirez", team: "CHC", position: "2B", salary: 5000, fppg: "13.0", projectedPoints: "13.0", opponent: "STL", gameInfo: "CHC @ STL 7:45PM" },
  { name: "Willy Adames", team: "SF", position: "SS", salary: 4000, fppg: "8.5", projectedPoints: "8.5", opponent: "SD", gameInfo: "SF vs SD 9:45PM" },
  { name: "Cody Bellinger", team: "CHC", position: "OF", salary: 3600, fppg: "8.0", projectedPoints: "8.0", opponent: "STL", gameInfo: "CHC @ STL 7:45PM" },
];

function scaleSalaryForMLB(dkSalary: number): number {
  return Math.round((dkSalary / 50000) * 35000 / 100) * 100;
}

export const MLB_PLAYERS_FEB_20_DK = MLB_BASE_PLAYERS.map(p => ({ ...p }));

export const MLB_PLAYERS_FEB_20_FD = MLB_BASE_PLAYERS.map(p => ({
  ...p,
  salary: scaleSalaryForMLB(p.salary),
  fppg: scaleProjForFD(p.fppg || "0"),
  projectedPoints: scaleProjForFD(p.projectedPoints?.toString() || "0"),
}));

// ===================== NFL SEED DATA =====================

export const NFL_SLATE_FEB_20_DK: Partial<Slate> = {
  sport: "NFL",
  platform: "draftkings",
  name: "NFL Main Slate",
  startTime: new Date("2026-02-20T13:00:00-05:00"),
  isMain: true,
};

export const NFL_SLATE_FEB_20_FD: Partial<Slate> = {
  sport: "NFL",
  platform: "fanduel",
  name: "NFL Main Slate",
  startTime: new Date("2026-02-20T13:00:00-05:00"),
  isMain: true,
};

export const NFL_GAMES_FEB_20 = [
  { away: "KC", home: "BUF", time: "1:00PM ET" },
  { away: "DAL", home: "PHI", time: "1:00PM ET" },
  { away: "SF", home: "SEA", time: "4:05PM ET" },
  { away: "BAL", home: "CIN", time: "1:00PM ET" },
  { away: "DET", home: "GB", time: "1:00PM ET" },
  { away: "MIA", home: "NYJ", time: "1:00PM ET" },
  { away: "MIN", home: "CHI", time: "1:00PM ET" },
  { away: "LAR", home: "ARI", time: "4:25PM ET" },
];

const NFL_BASE_PLAYERS: Omit<Partial<Player> & { name: string; team: string; position: string; salary: number }, 'id'>[] = [
  { name: "Patrick Mahomes", team: "KC", position: "QB", salary: 9000, fppg: "25.0", projectedPoints: "25.0", opponent: "BUF", gameInfo: "KC @ BUF 1:00PM" },
  { name: "Josh Allen", team: "BUF", position: "QB", salary: 8800, fppg: "24.5", projectedPoints: "24.5", opponent: "KC", gameInfo: "BUF vs KC 1:00PM" },
  { name: "Lamar Jackson", team: "BAL", position: "QB", salary: 8600, fppg: "24.0", projectedPoints: "24.0", opponent: "CIN", gameInfo: "BAL @ CIN 1:00PM" },
  { name: "Jalen Hurts", team: "PHI", position: "QB", salary: 8400, fppg: "23.0", projectedPoints: "23.0", opponent: "DAL", gameInfo: "PHI vs DAL 1:00PM" },
  { name: "Jared Goff", team: "DET", position: "QB", salary: 7800, fppg: "21.5", projectedPoints: "21.5", opponent: "GB", gameInfo: "DET @ GB 1:00PM" },
  { name: "Brock Purdy", team: "SF", position: "QB", salary: 7600, fppg: "20.5", projectedPoints: "20.5", opponent: "SEA", gameInfo: "SF @ SEA 4:05PM" },
  { name: "Jordan Love", team: "GB", position: "QB", salary: 7200, fppg: "19.0", projectedPoints: "19.0", opponent: "DET", gameInfo: "GB vs DET 1:00PM" },
  { name: "Saquon Barkley", team: "PHI", position: "RB", salary: 8200, fppg: "22.5", projectedPoints: "22.5", opponent: "DAL", gameInfo: "PHI vs DAL 1:00PM" },
  { name: "Christian McCaffrey", team: "SF", position: "RB", salary: 8000, fppg: "22.0", projectedPoints: "22.0", opponent: "SEA", gameInfo: "SF @ SEA 4:05PM" },
  { name: "Derrick Henry", team: "BAL", position: "RB", salary: 7800, fppg: "21.0", projectedPoints: "21.0", opponent: "CIN", gameInfo: "BAL @ CIN 1:00PM" },
  { name: "Jahmyr Gibbs", team: "DET", position: "RB", salary: 7400, fppg: "19.5", projectedPoints: "19.5", opponent: "GB", gameInfo: "DET @ GB 1:00PM" },
  { name: "Isiah Pacheco", team: "KC", position: "RB", salary: 6800, fppg: "17.5", projectedPoints: "17.5", opponent: "BUF", gameInfo: "KC @ BUF 1:00PM" },
  { name: "Josh Jacobs", team: "GB", position: "RB", salary: 6600, fppg: "16.5", projectedPoints: "16.5", opponent: "DET", gameInfo: "GB vs DET 1:00PM" },
  { name: "Kyren Williams", team: "LAR", position: "RB", salary: 6400, fppg: "15.5", projectedPoints: "15.5", opponent: "ARI", gameInfo: "LAR @ ARI 4:25PM" },
  { name: "De'Von Achane", team: "MIA", position: "RB", salary: 7000, fppg: "18.0", projectedPoints: "18.0", opponent: "NYJ", gameInfo: "MIA @ NYJ 1:00PM" },
  { name: "Breece Hall", team: "NYJ", position: "RB", salary: 6200, fppg: "15.0", projectedPoints: "15.0", opponent: "MIA", gameInfo: "NYJ vs MIA 1:00PM" },
  { name: "Aaron Jones", team: "MIN", position: "RB", salary: 5800, fppg: "14.0", projectedPoints: "14.0", opponent: "CHI", gameInfo: "MIN @ CHI 1:00PM" },
  { name: "Tyreek Hill", team: "MIA", position: "WR", salary: 8400, fppg: "23.0", projectedPoints: "23.0", opponent: "NYJ", gameInfo: "MIA @ NYJ 1:00PM" },
  { name: "CeeDee Lamb", team: "DAL", position: "WR", salary: 8200, fppg: "22.0", projectedPoints: "22.0", opponent: "PHI", gameInfo: "DAL @ PHI 1:00PM" },
  { name: "Ja'Marr Chase", team: "CIN", position: "WR", salary: 8000, fppg: "21.5", projectedPoints: "21.5", opponent: "BAL", gameInfo: "CIN vs BAL 1:00PM" },
  { name: "A.J. Brown", team: "PHI", position: "WR", salary: 7600, fppg: "20.0", projectedPoints: "20.0", opponent: "DAL", gameInfo: "PHI vs DAL 1:00PM" },
  { name: "Amon-Ra St. Brown", team: "DET", position: "WR", salary: 7400, fppg: "19.5", projectedPoints: "19.5", opponent: "GB", gameInfo: "DET @ GB 1:00PM" },
  { name: "Stefon Diggs", team: "BUF", position: "WR", salary: 7200, fppg: "18.5", projectedPoints: "18.5", opponent: "KC", gameInfo: "BUF vs KC 1:00PM" },
  { name: "Justin Jefferson", team: "MIN", position: "WR", salary: 8000, fppg: "21.0", projectedPoints: "21.0", opponent: "CHI", gameInfo: "MIN @ CHI 1:00PM" },
  { name: "Deebo Samuel", team: "SF", position: "WR", salary: 6800, fppg: "17.0", projectedPoints: "17.0", opponent: "SEA", gameInfo: "SF @ SEA 4:05PM" },
  { name: "DK Metcalf", team: "SEA", position: "WR", salary: 6600, fppg: "16.5", projectedPoints: "16.5", opponent: "SF", gameInfo: "SEA vs SF 4:05PM" },
  { name: "Rashee Rice", team: "KC", position: "WR", salary: 6400, fppg: "15.5", projectedPoints: "15.5", opponent: "BUF", gameInfo: "KC @ BUF 1:00PM" },
  { name: "Puka Nacua", team: "LAR", position: "WR", salary: 6800, fppg: "17.0", projectedPoints: "17.0", opponent: "ARI", gameInfo: "LAR @ ARI 4:25PM" },
  { name: "Jaylen Waddle", team: "MIA", position: "WR", salary: 5800, fppg: "14.0", projectedPoints: "14.0", opponent: "NYJ", gameInfo: "MIA @ NYJ 1:00PM" },
  { name: "DJ Moore", team: "CHI", position: "WR", salary: 5600, fppg: "13.5", projectedPoints: "13.5", opponent: "MIN", gameInfo: "CHI vs MIN 1:00PM" },
  { name: "Cooper Kupp", team: "LAR", position: "WR", salary: 6200, fppg: "15.5", projectedPoints: "15.5", opponent: "ARI", gameInfo: "LAR @ ARI 4:25PM" },
  { name: "Travis Kelce", team: "KC", position: "TE", salary: 7400, fppg: "19.0", projectedPoints: "19.0", opponent: "BUF", gameInfo: "KC @ BUF 1:00PM" },
  { name: "Sam LaPorta", team: "DET", position: "TE", salary: 6200, fppg: "15.0", projectedPoints: "15.0", opponent: "GB", gameInfo: "DET @ GB 1:00PM" },
  { name: "Mark Andrews", team: "BAL", position: "TE", salary: 5800, fppg: "14.0", projectedPoints: "14.0", opponent: "CIN", gameInfo: "BAL @ CIN 1:00PM" },
  { name: "George Kittle", team: "SF", position: "TE", salary: 5600, fppg: "13.5", projectedPoints: "13.5", opponent: "SEA", gameInfo: "SF @ SEA 4:05PM" },
  { name: "Dallas Goedert", team: "PHI", position: "TE", salary: 5200, fppg: "12.0", projectedPoints: "12.0", opponent: "DAL", gameInfo: "PHI vs DAL 1:00PM" },
  { name: "T.J. Hockenson", team: "MIN", position: "TE", salary: 5000, fppg: "11.5", projectedPoints: "11.5", opponent: "CHI", gameInfo: "MIN @ CHI 1:00PM" },
  { name: "Evan Engram", team: "CIN", position: "TE", salary: 4600, fppg: "10.0", projectedPoints: "10.0", opponent: "BAL", gameInfo: "CIN vs BAL 1:00PM" },
  { name: "Kansas City Chiefs", team: "KC", position: "DST", salary: 4200, fppg: "10.0", projectedPoints: "10.0", opponent: "BUF", gameInfo: "KC @ BUF 1:00PM" },
  { name: "San Francisco 49ers", team: "SF", position: "DST", salary: 4000, fppg: "9.5", projectedPoints: "9.5", opponent: "SEA", gameInfo: "SF @ SEA 4:05PM" },
  { name: "Baltimore Ravens", team: "BAL", position: "DST", salary: 3800, fppg: "9.0", projectedPoints: "9.0", opponent: "CIN", gameInfo: "BAL @ CIN 1:00PM" },
  { name: "Buffalo Bills", team: "BUF", position: "DST", salary: 3600, fppg: "8.5", projectedPoints: "8.5", opponent: "KC", gameInfo: "BUF vs KC 1:00PM" },
  { name: "Philadelphia Eagles", team: "PHI", position: "DST", salary: 3400, fppg: "8.0", projectedPoints: "8.0", opponent: "DAL", gameInfo: "PHI vs DAL 1:00PM" },
  { name: "Detroit Lions", team: "DET", position: "DST", salary: 3200, fppg: "7.5", projectedPoints: "7.5", opponent: "GB", gameInfo: "DET @ GB 1:00PM" },
  { name: "Marvin Harrison Jr.", team: "ARI", position: "WR", salary: 5400, fppg: "13.0", projectedPoints: "13.0", opponent: "LAR", gameInfo: "ARI vs LAR 4:25PM" },
];

function scaleSalaryForNFL(dkSalary: number): number {
  return Math.round((dkSalary / 50000) * 60000 / 100) * 100;
}

export const NFL_PLAYERS_FEB_20_DK = NFL_BASE_PLAYERS.map(p => ({ ...p }));

export const NFL_PLAYERS_FEB_20_FD = NFL_BASE_PLAYERS.map(p => ({
  ...p,
  salary: scaleSalaryForNFL(p.salary),
  fppg: scaleProjForFD(p.fppg || "0"),
  projectedPoints: scaleProjForFD(p.projectedPoints?.toString() || "0"),
}));
