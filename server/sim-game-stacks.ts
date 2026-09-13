import type { Player } from "@shared/schema";
import { parseGameInfo } from "@shared/game-info";

export function stackGameKey(gameInfo: string | null | undefined): string {
  const parsed = parseGameInfo(gameInfo);
  return parsed.away && parsed.home
    ? [parsed.away, parsed.home].map(team => team.toUpperCase()).sort().join("-")
    : "";
}

export interface SimStackAlternative {
  kind: "game" | "players";
  /** Canonical sorted team-pair key for a game alternative. */
  gameKey?: string;
  /** Exact slate-local player IDs for a player alternative. */
  playerIds?: number[];
  /** Optional persistence metadata carried through to simulation results. */
  id?: number;
  name?: string;
}

/**
 * Add one-of-N stack alternatives to a lineup model.
 *
 * A selector is created for every game or exact-player favorite and the
 * aggregate `sim_stack_choice = 1` constraint means a lineup chooses exactly
 * one alternative.  Exact-player alternatives only require the IDs supplied
 * by the caller; no replacement player from the same game can satisfy them.
 */
export function addSimStackAlternatives(
  model: any,
  pool: Player[],
  alternatives: SimStackAlternative[],
  sport: string,
) {
  if (!alternatives.length) return;
  const available = pool.filter(p => model.variables[`p${p.id}`]);
  // Child requirements (catcher/bring-back) are conditional on both the
  // alternative selector and the triggering QB.  Keep this larger than any
  // possible lineup so an unselected alternative cannot constrain a lineup
  // that selected a different exact-player alternative.
  const selectorBigM = available.length + 1;
  model.constraints.sim_stack_choice = { equal: 1 };
  alternatives.forEach((alternative, index) => {
    const selector = `sim_stack_${index}`;
    model.variables[selector] = { sim_stack_choice: 1, [`${selector}_bound`]: 1 };
    model.ints[selector] = 1;
    model.constraints[`${selector}_bound`] = { max: 1 };
    const key = alternative.kind === "game" ? (alternative.gameKey || "") : "";
    const game = available.filter(p => stackGameKey(p.gameInfo) === key);
    const requirePlayers = (name: string, candidates: Player[], count: number, trigger = selector) => {
      const childRequirement = trigger !== selector;
      model.constraints[name] = { min: childRequirement ? -selectorBigM : 0 };
      model.variables[trigger][name] = -count;
      if (childRequirement) model.variables[selector][name] = -selectorBigM;
      for (const p of candidates) model.variables[`p${p.id}`][name] = 1;
    };
    if (alternative.kind === "players") {
      // Every selected player is represented exactly once in the pool.  If
      // one was excluded, ruled out, or otherwise removed before solving,
      // this constraint makes this selector infeasible rather than silently
      // substituting another player from the game.
      const playerIds = Array.from(new Set(alternative.playerIds || []));
      requirePlayers(`${selector}_players`, available.filter(p => playerIds.includes(p.id)), playerIds.length);
    } else if (sport.toUpperCase() === "NFL") {
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

/** Require one selected game, never all selected games in the same roster. */
export function addSimGameStacks(
  model: any,
  pool: Player[],
  keys: string[] | SimStackAlternative[],
  sport: string,
) {
  const alternatives: SimStackAlternative[] = keys.map(key =>
    typeof key === "string" ? { kind: "game", gameKey: key } : key,
  );
  addSimStackAlternatives(model, pool, alternatives, sport);
}