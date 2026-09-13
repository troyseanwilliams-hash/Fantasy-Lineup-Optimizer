import assert from "node:assert/strict";
import test from "node:test";
import {
  applyExplicitProjections,
  filterByMinProjection,
  findLockedMinProjectionViolation,
  minProjectionLockMessage,
} from "../server/min-projection";

const players = [
  { id: 1, name: "High", projectedPoints: "12" },
  { id: 2, name: "Low", projectedPoints: 5 },
];

test("minProjection is an opt-in per-player cutoff and zero preserves the pool", () => {
  assert.deepEqual(filterByMinProjection(players, undefined).map(p => p.id), [1, 2]);
  assert.deepEqual(filterByMinProjection(players, 0).map(p => p.id), [1, 2]);
  assert.deepEqual(filterByMinProjection(players, 10).map(p => p.id), [1]);
});

test("locked players below minProjection produce an actionable violation", () => {
  const violation = findLockedMinProjectionViolation(players, 10, [2]);
  assert.ok(violation);
  assert.match(
    minProjectionLockMessage(violation!),
    /Locked player Low.*below the minProjection cutoff of 10.*Remove the lock or lower minProjection/,
  );
});

test("a zero cutoff never rejects a locked player", () => {
  assert.equal(findLockedMinProjectionViolation(players, 0, [2]), undefined);
});

test("explicit request projections are authoritative before server adjustments", () => {
  const adjustedPool = players.map(player => ({
    ...player,
    projectedPoints: player.id === 2 ? 100 : player.projectedPoints,
  }));
  const inputPool = applyExplicitProjections(players, { "2": 7 });
  const eligibleIds = new Set(filterByMinProjection(inputPool, 8).map(player => player.id));

  assert.deepEqual([...eligibleIds], [1]);
  assert.equal(adjustedPool.find(player => player.id === 2)?.projectedPoints, 100);
  assert.equal(inputPool.find(player => player.id === 2)?.projectedPoints, "7");
});