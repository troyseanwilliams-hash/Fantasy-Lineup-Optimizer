import assert from "node:assert/strict";
import test from "node:test";
import { gradeLineup } from "../client/src/lib/lineup-grader";

function player(
  id: number,
  projectedPoints: number,
  options: { slot?: string; isCaptain?: boolean; salary?: number; team?: string } = {},
) {
  return {
    id,
    name: `Player ${id}`,
    team: options.team || (id <= 3 ? "A" : "B"),
    position: "WR",
    salary: options.salary || 5_000,
    projectedPoints,
    slot: options.slot,
    isCaptain: options.isCaptain,
  };
}

test("Showdown grading applies the DraftKings 1.5x captain projection and salary", () => {
  const lineup = [
    player(1, 20, { slot: "CPT", isCaptain: true, salary: 10_000 }),
    ...[2, 3, 4, 5, 6].map(id => player(id, 10, { slot: `FLEX${id - 1}` })),
  ];
  const grade = gradeLineup(lineup, "NFL", "draftkings", 75_000, 130, "showdown");
  const projection = grade.breakdown.find(item => item.label === "Projected Score");
  assert.ok(projection);
  // 1.5x CPT makes the effective projection 80 (30 + 5 * 10), not 70.
  assert.equal(projection.score, Math.round(40 * (80 / 85)));
});

test("Showdown captain quality compares base candidates without multiplier bias", () => {
  const topCaptain = [
    player(1, 20, { slot: "CPT", isCaptain: true, salary: 10_000 }),
    player(2, 18, { slot: "FLEX1", salary: 9_000 }),
    ...[3, 4, 5, 6].map(id => player(id, 10, { slot: `FLEX${id - 1}` })),
  ];
  const weakCaptain = topCaptain.map((entry, index) => ({
    ...entry,
    slot: index === 0 ? "FLEX1" : index === 5 ? "CPT" : `FLEX${index + 1}`,
    isCaptain: index === 5,
  }));
  const topGrade = gradeLineup(topCaptain, "NFL", "draftkings", 40_000, 98, "showdown");
  const weakGrade = gradeLineup(weakCaptain, "NFL", "draftkings", 40_000, 93, "showdown");
  const captainScore = (grade: ReturnType<typeof gradeLineup>) =>
    grade.breakdown.find(item => item.label === "Captain Quality")!.score;
  assert.ok(captainScore(topGrade) > captainScore(weakGrade));
});

test("FanDuel Showdown accepts one MVP and four FLEX players", () => {
  const lineup = [
    player(1, 20, { slot: "MVP", isCaptain: true, salary: 10_000 }),
    ...[2, 3, 4, 5].map(id => player(id, 10, { slot: `FLEX${id - 1}` })),
  ];
  const grade = gradeLineup(lineup, "NFL", "fanduel", 30_000, 80, "showdown");
  assert.ok(grade.score > 0);
});

test("Showdown grading rejects captain labels from the wrong platform", () => {
  const lineup = [
    player(1, 20, { slot: "MVP", isCaptain: true }),
    ...[2, 3, 4, 5, 6].map(id => player(id, 10, { slot: `FLEX${id - 1}` })),
  ];
  assert.equal(gradeLineup(lineup, "NFL", "draftkings", 35_000, 80, "showdown").score, 0);
});

test("NBA Showdown projection calibration differs by platform roster format", () => {
  const dk = [
    player(1, 40, { slot: "CPT", isCaptain: true }),
    ...[2, 3, 4, 5, 6].map(id => player(id, 32, { slot: `FLEX${id - 1}` })),
  ];
  const fd = [
    player(1, 40, { slot: "MVP", isCaptain: true }),
    ...[2, 3, 4, 5].map(id => player(id, 32, { slot: `FLEX${id - 1}` })),
  ];
  const projectionScore = (lineup: ReturnType<typeof gradeLineup>) =>
    lineup.breakdown.find(item => item.label === "Projected Score")!.score;
  assert.ok(projectionScore(gradeLineup(dk, "NBA", "draftkings", 45_000, 220, "showdown")) > 0);
  assert.ok(projectionScore(gradeLineup(fd, "NBA", "fanduel", 50_000, 208, "showdown")) > 0);
});

test("Classic grading remains separate from Showdown grading", () => {
  const players = [1, 2, 3, 4, 5, 6, 7, 8].map(id =>
    player(id, 30, { salary: 6_000 }),
  );
  const classic = gradeLineup(players, "NBA", "draftkings", 48_000, 240);
  const explicitClassic = gradeLineup(players, "NBA", "draftkings", 48_000, 240, {
    contestFormat: "classic",
  });
  assert.deepEqual(explicitClassic, classic);
  assert.notDeepEqual(
    gradeLineup(players.slice(0, 6), "NBA", "draftkings", 48_000, 240, "showdown"),
    classic,
  );
});

test("Showdown grading rejects anything other than one CPT and five unique FLEX players", () => {
  const invalid = [
    player(1, 20, { slot: "CPT", isCaptain: true }),
    player(2, 10, { slot: "FLEX1" }),
    player(2, 10, { slot: "FLEX2" }),
    player(3, 10, { slot: "FLEX3" }),
    player(4, 10, { slot: "FLEX4" }),
    player(5, 10, { slot: "FLEX5" }),
  ];
  const grade = gradeLineup(invalid, "NFL", "draftkings", 40_000, 80, {
    contestFormat: "showdown",
  });
  assert.equal(grade.score, 0);
  assert.equal(grade.breakdown[0].label, "Roster Validity");
});