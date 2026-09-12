import type { Player } from "@shared/schema";

export function stackGameKey(gameInfo: string | null | undefined): string {
  const teams = gameInfo?.match(/^([A-Z0-9]+)\s+(?:@|vs\.?)\s+([A-Z0-9]+)/i);
  return teams ? [teams[1].toUpperCase(), teams[2].toUpperCase()].sort().join("-") : "";
}

/** Require one selected game, never all selected games in the same roster. */
export function addSimGameStacks(model: any, pool: Player[], keys: string[], sport: string) {
  if (!keys.length) return;
  const available = pool.filter(p => model.variables[`p${p.id}`]);
  model.constraints.sim_stack_choice = { equal: 1 };
  keys.forEach((key, index) => {
    const selector = `sim_stack_${index}`;
    model.variables[selector] = { sim_stack_choice: 1, [`${selector}_bound`]: 1 };
    model.ints[selector] = 1;
    model.constraints[`${selector}_bound`] = { max: 1 };
    const game = available.filter(p => stackGameKey(p.gameInfo) === key);
    const requirePlayers = (name: string, candidates: Player[], count: number, trigger = selector) => {
      model.constraints[name] = { min: 0 };
      model.variables[trigger][name] = -count;
      for (const p of candidates) model.variables[`p${p.id}`][name] = 1;
    };
    if (sport === "NFL") {
      const qbs = game.filter(p => p.position.split("/").includes("QB"));
      requirePlayers(`${selector}_qb`, qbs, 1);
      for (const qb of qbs) {
        const trigger = `p${qb.id}`;
        // QB constraints are conditional on choosing that quarterback.
        requirePlayers(`${selector}_catch_${qb.id}`,
          game.filter(p => p.team === qb.team && /^(WR|TE)$/.test(p.position)), 1, trigger);
        requirePlayers(`${selector}_back_${qb.id}`,
          game.filter(p => p.team !== qb.team && /^(RB|WR|TE)$/.test(p.position)), 1, trigger);
      }
    } else {
      requirePlayers(`${selector}_size`, game, 3);
      for (const team of key.split("-")) {
        requirePlayers(`${selector}_team_${team}`, game.filter(p => p.team.toUpperCase() === team), 1);
      }
    }
  });
}