import type { Player, Slate } from "@shared/schema";

// User-supplied attachment, attributed to OneWeekSeason; not independently verified.
// DK IDs and identity fields checked against the read-only DG153428 pool.
export const SUPPLIED_OWNERSHIP_LABEL = "User-supplied · attributed to OneWeekSeason (not independently verified) · DK NFL Main · 2026-09-20 · DG153428";
export const SUPPLIED_NFL_OWNERSHIP = [
  [44132656, "Bijan Robinson", "RB", "ATL", 8200, 40.1],
  [44132714, "Aaron Jones Sr.", "RB", "MIN", 5100, 24.1],
  [44132660, "Derrick Henry", "RB", "BAL", 7200, 22.2],
  [44132674, "Javonte Williams", "RB", "DAL", 6400, 22.2],
  [44132658, "Christian McCaffrey", "RB", "SF", 8000, 21.9],
  [44133490, "Dalton Schultz", "TE", "HOU", 3200, 20.5],
  [44132968, "CeeDee Lamb", "WR", "DAL", 7300, 20.3],
  [44132984, "George Pickens", "WR", "DAL", 6300, 17.9],
  [44132966, "Ja'Marr Chase", "WR", "CIN", 7600, 17.2],
  [44133456, "Mark Andrews", "TE", "BAL", 4400, 17.1],
  [44132666, "Ashton Jeanty", "RB", "LV", 6800, 16.5],
  [44132964, "Justin Jefferson", "WR", "MIN", 7800, 15.4],
  [44133474, "Michael Mayer", "TE", "LV", 3600, 14.1],
  [44132962, "Jaxon Smith-Njigba", "WR", "SEA", 8100, 13.9],
  [44132996, "Garrett Wilson", "WR", "NYJ", 6000, 13.6],
  [44132682, "Bucky Irving", "RB", "TB", 6100, 13.5],
  [44132571, "Dak Prescott", "QB", "DAL", 6400, 12.0],
  [44133024, "Quentin Johnston", "WR", "LAC", 5000, 11.6],
  [44133016, "DK Metcalf", "WR", "PIT", 5200, 11.5],
  [44133036, "Matthew Golden", "WR", "GB", 4700, 11.3],
  [44132680, "Breece Hall", "RB", "NYJ", 6200, 11.1],
  [44133014, "Terry McLaurin", "WR", "WAS", 5200, 10.7],
  [44132998, "Parker Washington", "WR", "JAC", 5900, 10.5],
  [44132986, "Christian Watson", "WR", "GB", 6200, 10.3],
  [44132668, "De'Von Achane", "RB", "MIA", 6700, 10.1],
  [44132690, "Rhamondre Stevenson", "RB", "NE", 5700, 10.0],
  [44132573, "Brock Purdy", "QB", "SF", 6200, 9.9],
  [44133744, "Tampa Bay Buccaneers", "DST", "TB", 3600, 9.7],
  [44132662, "Saquon Barkley", "RB", "PHI", 7000, 9.6],
  [44133022, "Jalen Coker", "WR", "CAR", 5100, 9.1],
  [44133747, "Baltimore Ravens", "DST", "BAL", 3300, 8.4],
  [44133442, "Trey McBride", "TE", "ARI", 6900, 8.2],
  [44132576, "Jordan Love", "QB", "GB", 5900, 8.0],
  [44132970, "Chris Olave", "WR", "NO", 7200, 7.9],
  [44132992, "Tetairoa McMillan", "WR", "CAR", 6100, 7.7],
  [44133452, "George Kittle", "TE", "SF", 4600, 7.5],
  [44133446, "Colston Loveland", "TE", "CHI", 5000, 7.5],
  [44133052, "Rashod Bateman", "WR", "BAL", 4400, 7.2],
  [44132688, "Chuba Hubbard", "RB", "CAR", 5800, 7.1],
  [44133046, "Jayden Reed", "WR", "GB", 4500, 6.9],
  [44132670, "Omarion Hampton", "RB", "LAC", 6600, 6.7],
  [44132572, "Jayden Daniels", "QB", "WAS", 6300, 6.6],
  [44132980, "Jaylen Waddle", "WR", "DEN", 6500, 6.5],
  [44133754, "Denver Broncos", "DST", "DEN", 2800, 6.5],
  [44133012, "Stefon Diggs", "WR", "WAS", 5300, 6.4],
  [44132567, "Lamar Jackson", "QB", "BAL", 7300, 5.8],
  [44132594, "Carson Wentz", "QB", "MIN", 4600, 5.2],
  [44132978, "Mike Evans", "WR", "SF", 6600, 5.2],
  [44132994, "Drake London", "WR", "ATL", 6000, 5.1],
  [44132580, "C.J. Stroud", "QB", "HOU", 5500, 3.7],
] as const;

export type OwnershipScope = Pick<Slate, "id" | "sport" | "platform" | "startTime" | "isMain" | "draftGroupId" | "gameType">;

export function isSuppliedOwnershipSlate(slate: OwnershipScope | undefined): boolean {
  if (!slate || slate.sport.toUpperCase() !== "NFL" || slate.platform !== "draftkings" ||
      slate.draftGroupId !== 153428 || !slate.isMain ||
      (slate.gameType || "Classic").trim().toLowerCase() !== "classic") return false;
  const start = new Date(slate.startTime);
  return Number.isFinite(start.getTime()) &&
    start.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === "2026-09-20";
}

const teamKey = (team: string) => team === "JAX" ? "JAC" : team;
const dstAliases: Record<string, string> = {
  "Tampa Bay Buccaneers": "Buccaneers",
  "Baltimore Ravens": "Ravens",
  "Denver Broncos": "Broncos",
};

/** Overlay only after modeling/normalization; never rescale these percentages.
 * A present DK ID must match exactly. Missing IDs may use unique exact identities,
 * with only the four explicitly audited team/DST aliases accepted.
 */
export function suppliedOwnershipForPool(
  players: Player[],
  scopes: ReadonlyMap<number, OwnershipScope | undefined>,
  report: (message: string) => void = message => console.warn(message),
): Map<number, number> {
  const result = new Map<number, number>();
  const scoped = players.filter(p => isSuppliedOwnershipSlate(scopes.get(p.slateId)));
  for (const row of SUPPLIED_NFL_OWNERSHIP) {
    const [dkId, name, position, team, salary, ownership] = row;
    const nameMatches = (p: Player) => p.name === name || (position === "DST" && p.name === dstAliases[name]);
    const identityMatches = (p: Player) => nameMatches(p) && teamKey(p.team) === team && p.position === position && p.salary === salary;
    for (const slateId of Array.from(new Set(scoped.map(p => p.slateId)))) {
      const candidates = scoped.filter(p => p.slateId === slateId &&
        (p.draftKingsPlayerId === dkId || (p.draftKingsPlayerId == null && identityMatches(p))));
      const suspicious = scoped.filter(p => p.slateId === slateId && nameMatches(p) && !candidates.includes(p));
      if (suspicious.length) report(`[Ownership] DG153428 identity mismatch for ${name}; retained model estimate.`);
      if (candidates.length > 1) {
        report(`[Ownership] DG153428 ambiguous match for ${name}; retained model estimates.`);
        continue;
      }
      const player = candidates[0];
      if (!player) continue;
      if (!identityMatches(player)) {
        report(`[Ownership] DG153428 DK ID ${dkId} name/team/position/salary mismatch; retained model estimate.`);
        continue;
      }
      result.set(player.id, ownership);
    }
  }
  return result;
}