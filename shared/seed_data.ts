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
