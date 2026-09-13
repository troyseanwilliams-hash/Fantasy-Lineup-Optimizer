import assert from "node:assert/strict";
import test from "node:test";
import { solveLineup } from "../server/routes";
import {
  optimizationConstraintSchema,
  type OptimizationConstraints,
  type Player,
} from "../shared/schema";

function player(
  id: number,
  position: string,
  platform: "draftkings" | "fanduel" | "yahoo",
  projectedPoints = 10,
): Player {
  const defense = position === "DST" || position === "DEF";
  const kicker = position === "K";
  return {
    id,
    slateId: 1,
    name: `FLEX Fixture ${id}`,
    team: id % 2 === 0 ? "BUF" : "HOU",
    position,
    salary: defense ? 2_000 : kicker ? 5 : 5_000,
    fppg: String(projectedPoints),
    projectedPoints: String(projectedPoints),
    opponent: id % 2 === 0 ? "HOU" : "BUF",
    gameInfo: "HOU @ BUF 1:00 PM ET",
    injuryStatus: null,
    ...(platform === "draftkings"
      ? { draftKingsPlayerId: id }
      : platform === "fanduel"
        ? { fanDuelPlayerId: id }
        : { yahooPlayerId: String(id) }),
  } as Player;
}

function nflPool(platform: "draftkings" | "fanduel" | "yahoo"): Player[] {
  const positions = platform === "fanduel"
    ? ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE", "DEF"]
    : platform === "yahoo"
      ? ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE", "K"]
      : ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE", "DST"];
  return positions.map((position, index) => player(index + 1, position, platform, 100 - index));
}

function solveRestricted(
  platform: "draftkings" | "fanduel" | "yahoo",
  flexAllowedPositions: string[],
  lockedPlayerIds: number[] = [],
) {
  return solveLineup(
    nflPool(platform),
    {
      slateId: 1,
      lockedPlayerIds,
      excludedPlayerIds: [],
      flexAllowedPositions,
      lineupCount: 1,
      maxSalary: 60_000,
    } as OptimizationConstraints,
    "NFL",
    platform,
  );
}

for (const platform of ["draftkings", "fanduel", "yahoo"] as const) {
  test(`${platform} restricted TE still fills the required TE base slot`, () => {
    const result = solveRestricted(platform, ["RB", "WR"]);
    assert.ok(!result.error, result.error);
    assert.equal(result.lineup.filter(p => p.position === "TE").length, 1);
    assert.ok(result.lineup.filter(p => p.position === "RB").length >= 2);
    assert.ok(result.lineup.filter(p => p.position === "WR").length >= 3);
  });

  test(`${platform} RB-only FLEX excludes extra WR and TE players`, () => {
    const result = solveRestricted(platform, ["RB"]);
    assert.ok(!result.error, result.error);
    assert.equal(result.lineup.filter(p => p.position === "RB").length, 3);
    assert.equal(result.lineup.filter(p => p.position === "WR").length, 3);
    assert.equal(result.lineup.filter(p => p.position === "TE").length, 1);
  });
}

test("NFL FLEX restriction honors locks with a clear infeasibility error", () => {
  const result = solveRestricted("draftkings", ["RB"], [5, 6, 7, 8]);
  assert.match(result.error || "", /FLEX restriction|locked/i);
});

test("FLEX restriction schema rejects an empty allowed-position list", () => {
  const result = optimizationConstraintSchema.safeParse({
    slateId: 1,
    flexAllowedPositions: [],
  });
  assert.equal(result.success, false);
});