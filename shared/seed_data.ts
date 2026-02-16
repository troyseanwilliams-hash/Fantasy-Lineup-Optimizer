import { type Player, type Slate } from "./schema";

export const NBA_SLATE_FEB_19: Slate = {
  id: 101,
  sport: "NBA",
  name: "NBA Feb 19 Main Slate",
  startTime: new Date("2026-02-19T19:00:00Z"),
};

export const NBA_PLAYERS_FEB_19: Partial<Player>[] = [
  {
    slateId: 101,
    name: "Victor Wembanyama",
    team: "SAS",
    position: "C",
    salary: 10500,
    fppg: "52.3",
    projectedPoints: "52.3",
    opponent: "PHX",
    gameInfo: "PHX @ SAS 8:30PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "Cade Cunningham",
    team: "DET",
    position: "PG",
    salary: 10300,
    fppg: "51.3",
    projectedPoints: "51.3",
    opponent: "NYK",
    gameInfo: "DET @ NYK 7:30PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "Jalen Johnson",
    team: "ATL",
    position: "PF",
    salary: 10400,
    fppg: "51.0",
    projectedPoints: "51.0",
    opponent: "PHI",
    gameInfo: "ATL @ PHI 7:00PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "Tyrese Maxey",
    team: "PHI",
    position: "PG",
    salary: 9600,
    fppg: "48.0",
    projectedPoints: "48.0",
    opponent: "ATL",
    gameInfo: "PHI vs ATL 7:00PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "James Harden",
    team: "LAC",
    position: "PG",
    salary: 9000,
    fppg: "47.0",
    projectedPoints: "47.0",
    opponent: "BKN",
    gameInfo: "BKN @ LAC 10:30PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "Donovan Mitchell",
    team: "CLE",
    position: "SG",
    salary: 9500,
    fppg: "45.5",
    projectedPoints: "45.5",
    opponent: "BKN",
    gameInfo: "BKN @ CLE 7:00PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "Alperen Sengun",
    team: "HOU",
    position: "PF/C",
    salary: 9200,
    fppg: "43.5",
    projectedPoints: "43.5",
    opponent: "CHA",
    gameInfo: "HOU @ CHA 7:00PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "LaMelo Ball",
    team: "CHA",
    position: "PG",
    salary: 8400,
    fppg: "43.0",
    projectedPoints: "43.0",
    opponent: "HOU",
    gameInfo: "HOU @ CHA 7:00PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "Scottie Barnes",
    team: "TOR",
    position: "PF",
    salary: 9100,
    fppg: "42.3",
    projectedPoints: "42.3",
    opponent: "CHI",
    gameInfo: "TOR @ CHI 8:00PM",
    sport: "NBA"
  },
  {
    slateId: 101,
    name: "Brandon Miller",
    team: "CHA",
    position: "SF",
    salary: 8000,
    fppg: "42.0",
    projectedPoints: "42.0",
    opponent: "HOU",
    gameInfo: "HOU @ CHA 7:00PM",
    sport: "NBA"
  }
];
