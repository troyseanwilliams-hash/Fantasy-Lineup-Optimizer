import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const startup = readFileSync("server/index.ts", "utf8");

test("startup and scheduled jobs retain saved lineups and player history", () => {
  assert.doesNotMatch(startup, /storage\.(deleteOldReviewLineups|cleanOldPlayerHistory|deleteLineup)\s*\(/);
  assert.doesNotMatch(startup, /db\.delete\((lineupsTable|playerHistory)\)/);
});

test("archiving and historical collection continue without retention cleanup", () => {
  assert.match(startup, /storage\.moveLineupsToReview\(expiredSlateIds\)/);
  assert.match(startup, /await runNightlyAnalysis\(\)/);
  assert.match(startup, /await runNightlyDKBackfill\(\)/);
  assert.match(startup, /await backfillActualPointsForHistory\(storage, 7\)/);
});
