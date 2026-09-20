import assert from "node:assert/strict";
import test from "node:test";
import type { Player } from "../shared/schema";
import { DEFAULT_NFL_PORTFOLIO } from "../shared/nfl-portfolio";
import {
  createNflPortfolioValidationSnapshot,
  generateDeterministicBaseline,
  nflPortfolioValidationSnapshotSchema,
  scoreValidationArm,
  snapshotOwnershipReplay,
  validationArmProtocol,
} from "../server/nfl-portfolio-validation";
import { disableCliNetwork } from "../scripts/validate-nfl-portfolio";

function syntheticPlayer(id: number, projection: string = "12"): Player {
  return {
    id, slateId: 1, name: `SYNTHETIC Player ${id}`, team: "BUF",
    position: "WR", salary: 5000, fppg: "10", projectedPoints: projection,
    opponent: "MIA", gameInfo: "BUF @ MIA", injuryStatus: null,
  } as Player;
}

const base = {
  slateStartTime: "2024-09-08T17:00:00.000Z",
  capturedAt: "2024-09-08T16:00:00.000Z",
  projectionsAsOf: "2024-09-08T15:59:00.000Z",
  settingsAsOf: "2024-09-08T15:58:00.000Z",
  pool: [syntheticPlayer(1)],
  constraints: { slateId: 1, lockedPlayerIds: [], excludedPlayerIds: [] },
  settings: DEFAULT_NFL_PORTFOLIO,
};

test("SYNTHETIC fixture: snapshot helper is immutable and serializable", () => {
  const snapshot = createNflPortfolioValidationSnapshot(base);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.pool), true);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.equal(snapshot.ownership, null);
  assert.equal(snapshot.inputAsOf.ownership, null);
});

test("SYNTHETIC malicious fixture: rejects projection captured after lock", () => {
  assert.throws(() => createNflPortfolioValidationSnapshot({
    ...base,
    projectionsAsOf: "2024-09-08T17:01:00.000Z",
  }), /later than capturedAt/i);
});

test("SYNTHETIC malicious fixture: rejects late ownership provenance", () => {
  assert.throws(() => createNflPortfolioValidationSnapshot({
    ...base,
    ownership: {
      source: "archived-provider",
      provenance: "provided" as const,
      asOf: "2024-09-08T16:01:00.000Z",
      values: { 1: 10 },
    },
  }), /ownership provenance is later/i);
});

test("SYNTHETIC malicious fixture: rejects nonfinite projections, ownership, and actuals", () => {
  assert.throws(() => createNflPortfolioValidationSnapshot({
    ...base, pool: [syntheticPlayer(1, "NaN")],
  }), /must be finite/i);
  assert.equal(nflPortfolioValidationSnapshotSchema.safeParse({
    ...createNflPortfolioValidationSnapshot(base),
    ownership: { source: "archive", values: { 1: Number.POSITIVE_INFINITY } },
    inputAsOf: {
      ...createNflPortfolioValidationSnapshot(base).inputAsOf,
      ownership: "2024-09-08T15:00:00.000Z",
    },
  }).success, false);
  assert.throws(() => createNflPortfolioValidationSnapshot({
    ...base,
    actuals: { observedAt: "2024-09-08T18:00:00.000Z", points: { 1: Number.NaN } },
  }), /finite/i);
});

test("SYNTHETIC malicious fixture: rejects actuals observed before lock", () => {
  assert.throws(() => createNflPortfolioValidationSnapshot({
    ...base,
    actuals: { observedAt: "2024-09-08T16:30:00.000Z", points: { 1: 18 } },
  }), /after slate lock/i);
});

test("SYNTHETIC baseline: duplicate solver outputs are never used to pad count", async () => {
  const pool = Array.from({ length: 10 }, (_, index) => syntheticPlayer(index + 1, String(10 + index)));
  const result = await generateDeterministicBaseline({
    pool,
    constraints: { slateId: 1, lockedPlayerIds: [], excludedPlayerIds: [], contestType: "cash", outperformerMode: false },
    count: 3,
    seed: 2026,
    deadline: Date.now() + 5_000,
    budgetMs: 5_000,
    solve: async players => ({ lineup: players.slice(0, 9) }),
  });
  assert.equal(result.lineups.length, 1);
  assert.equal(result.execution.acceptedCandidates, 1);
  assert.equal(result.execution.solverAttempts, result.execution.attemptLimit);
});

test("SYNTHETIC protocol: arms receive equal independent budgets and attempt caps", () => {
  const protocol = validationArmProtocol(100, 30_000);
  assert.equal(protocol.baselineBudgetMs, 15_000);
  assert.equal(protocol.strategyBudgetMs, 15_000);
  assert.equal(protocol.attemptLimit, 1_200);
});

test("SYNTHETIC missing actuals: performance metrics remain unavailable, not zero", () => {
  const metrics = scoreValidationArm(
    [[syntheticPlayer(1)]],
    null,
    { solverAttempts: 1, acceptedCandidates: 1, attemptLimit: 48, budgetMs: 1_000 },
    2,
  );
  assert.equal(metrics.partial, true);
  assert.equal(metrics.meanActualPoints, null);
  assert.equal(metrics.bestActualPoints, null);
  assert.equal(metrics.topPercentileActualPoints, null);
});

test("CLI replay network guard rejects current API fetches", async () => {
  const originalFetch = globalThis.fetch;
  try {
    disableCliNetwork();
    await assert.rejects(() => fetch("https://example.com"), /Network access is disabled/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SYNTHETIC supplied ownership snapshot replays explicit provided provenance", () => {
  const settings = {
    ...DEFAULT_NFL_PORTFOLIO,
    ownershipMode: "provided" as const,
    ownershipOverrides: { "1": 9 },
  };
  const snapshot = createNflPortfolioValidationSnapshot({
    ...base,
    settings,
    ownership: {
      source: "archived-supplied-file",
      provenance: "provided",
      asOf: "2024-09-08T15:57:00.000Z",
      values: { 1: 11 },
    },
  });
  const replay = snapshotOwnershipReplay(snapshot);
  assert.equal(replay.ownershipProvenance, "provided");
  assert.equal(replay.ownershipMap?.get(1), 11);
  assert.equal(snapshot.inputAsOf.settings, "2024-09-08T15:58:00.000Z");
  assert.equal(snapshot.settings.ownershipOverrides["1"], 9);
});