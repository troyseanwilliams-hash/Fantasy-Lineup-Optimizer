import type { Player } from "@shared/schema";

type StackPlayer = Pick<Player, "id" | "team" | "position">;
const hasPosition = (player: StackPlayer, positions: string[]) =>
  player.position.toUpperCase().split("/").some(position => positions.includes(position.trim()));
const sameTeam = (a: StackPlayer, b: StackPlayer) =>
  a.team.trim().toUpperCase() === b.team.trim().toUpperCase();

/**
 * Every selected QB needs a same-team WR/TE, including a fixed Showdown
 * captain. A lineup may never contain two QBs from the same NFL team.
 */
export function addNFLQuarterbackStacks(
  model: any,
  pool: StackPlayer[],
  sport: string,
  captain?: StackPlayer,
) {
  if (sport.toUpperCase() !== "NFL") return;
  const selectable = pool.filter(player => model.variables[`p${player.id}`]);
  const quarterbacks = [...selectable, ...(captain ? [captain] : [])]
    .filter(player => hasPosition(player, ["QB"]));
  const quarterbackTeams = new Set(
    quarterbacks.map(player => player.team.trim().toUpperCase()).filter(Boolean),
  );
  Array.from(quarterbackTeams).forEach((team, teamIndex) => {
    const captainUsesTeamQuarterback = !!captain &&
      hasPosition(captain, ["QB"]) &&
      captain.team.trim().toUpperCase() === team;
    const name = `nfl_qb_team_max_${teamIndex}`;
    model.constraints[name] = { max: captainUsesTeamQuarterback ? 0 : 1 };
    for (const quarterback of selectable) {
      if (
        hasPosition(quarterback, ["QB"]) &&
        quarterback.team.trim().toUpperCase() === team
      ) {
        model.variables[`p${quarterback.id}`][name] = 1;
      }
    }
  });
  for (const quarterback of quarterbacks) {
    const name = `nfl_qb_pair_${quarterback.id}`;
    const captainIsQuarterback = captain?.id === quarterback.id;
    const captainIsCatcher = !!captain && captain.id !== quarterback.id && sameTeam(captain, quarterback) &&
      hasPosition(captain, ["WR", "TE"]);
    model.constraints[name] = {
      min: Number(captainIsQuarterback) - Number(captainIsCatcher),
    };
    if (!captainIsQuarterback) model.variables[`p${quarterback.id}`][name] = -1;
    for (const catcher of selectable) {
      if (catcher.id !== quarterback.id && sameTeam(catcher, quarterback) && hasPosition(catcher, ["WR", "TE"])) {
        model.variables[`p${catcher.id}`][name] = 1;
      }
    }
    // With no eligible catcher, this forbids the QB rather than skipping the rule.
  }
}