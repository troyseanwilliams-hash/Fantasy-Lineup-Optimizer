import assert from "node:assert/strict";
import test from "node:test";
import type { Player, Slate } from "../shared/schema";
import {
  buildSimRegenerateSolverConstraints,
  simRegenerateRestrictionSchema,
  solveLineup,
  validateSimRegenerateRestrictions,
} from "../server/routes";
import { stackGameKey } from "../server/sim-game-stacks";

function slate(sport = "NFL", gameType = "Classic", id = 1): Slate {
  return {
    id,
    sport,
    platform: "draftkings",
    name: `${sport} ${gameType}`,
    startTime: new Date("2099-01-01T00:00:00Z"),
    gameType,
  } as Slate;
}

function player(id: number, team: string, position: string, game: "BUF-HOU" | "DET-NO"): Player {
  const [away, home] = game.split("-");
  const opponent = team === away ? home : away;
  return {
    id,
    slateId: 1,
    name: `${team} ${position} ${id}`,
    team,
    opponent,
    position,
    salary: position === "DST" ? 2_500 : 5_000,
    projectedPoints: String(game === "DET-NO" ? 20 : 12),
    fppg: "12",
    gameInfo: `${away} @ ${home} 1:00 PM ET`,
    injuryStatus: null,
  } as Player;
}

const nflPool = [
  ...["BUF", "HOU"].flatMap((team, teamIndex) =>
    ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "DST"].map((position, index) =>
      player(teamIndex * 8 + index + 1, team, position, "BUF-HOU"),
    ),
  ),
  ...["DET", "NO"].flatMap((team, teamIndex) =>
    ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "DST"].map((position, index) =>
      player(17 + teamIndex * 8 + index, team, position, "DET-NO"),
    ),
  ),
];

test("sim-regenerate boundary rejects an empty FLEX allowed list", () => {
  assert.equal(simRegenerateRestrictionSchema.safeParse({ flexAllowedPositions: [] }).success, false);
});

test("sim-regenerate normalizes and deduplicates selected game alternatives", () => {
  const controls = validateSimRegenerateRestrictions(
    { flexAllowedPositions: ["RB"], stackGameKeys: ["hou-buf", "BUF-HOU", "no-det"] },
    slate(),
    nflPool,
  );
  assert.deepEqual(controls, {
    flexAllowedPositions: ["RB"],
    stackGameKeys: ["BUF-HOU", "DET-NO"],
  });
});

test("sim-regenerate validates selected games against every mixed-slate target", () => {
  const controls = { stackGameKeys: ["BUF-HOU"] };
  assert.doesNotThrow(() => validateSimRegenerateRestrictions(controls, slate("NFL", "Classic", 1), nflPool));
  assert.throws(
    () => validateSimRegenerateRestrictions(
      controls,
      slate("NFL", "Classic", 2),
      nflPool.filter(p => stackGameKey(p.gameInfo) === "DET-NO"),
    ),
    /not in every affected slate/i,
  );
});

test("sim-regenerate defaults do not add controls to Showdown", () => {
  assert.deepEqual(
    validateSimRegenerateRestrictions({}, slate("NFL", "Showdown"), nflPool),
    { flexAllowedPositions: undefined, stackGameKeys: undefined },
  );
});

test("sim-regenerate rejects explicitly incompatible Showdown and sport controls", () => {
  assert.throws(
    () => validateSimRegenerateRestrictions(
      { flexAllowedPositions: ["WR"] },
      slate("NFL", "Showdown"),
      nflPool,
    ),
    /NFL Classic/i,
  );
  assert.throws(
    () => validateSimRegenerateRestrictions(
      { stackGameKeys: ["BUF-HOU"] },
      slate("GOLF"),
      nflPool,
    ),
    /supported only/i,
  );
});

test("sim-regenerate controls propagated to the solver enforce FLEX and one selected game", () => {
  const controls = validateSimRegenerateRestrictions(
    { flexAllowedPositions: ["RB"], stackGameKeys: ["BUF-HOU", "DET-NO"] },
    slate(),
    nflPool,
  );
  const solverConstraints = buildSimRegenerateSolverConstraints(1, [], 50_000, "cash", controls);
  assert.deepEqual(solverConstraints.flexAllowedPositions, ["RB"]);
  assert.deepEqual(solverConstraints.stackGameKeys, ["BUF-HOU", "DET-NO"]);
  const result = solveLineup(nflPool, solverConstraints, "NFL", "draftkings");

  assert.ok(!result.error, result.error);
  assert.equal(result.lineup.filter(p => p.position === "RB").length, 3);
  assert.equal(result.lineup.filter(p => p.position === "WR").length, 3);
  assert.equal(result.lineup.filter(p => p.position === "TE").length, 1);
  const quarterback = result.lineup.find(p => p.position === "QB")!;
  assert.ok(controls.stackGameKeys!.includes(stackGameKey(quarterback.gameInfo)));
  assert.ok(result.lineup.some(p => p.team === quarterback.team && ["WR", "TE"].includes(p.position)));
  assert.ok(result.lineup.some(p => p.team === quarterback.opponent && ["RB", "WR", "TE"].includes(p.position)));
});