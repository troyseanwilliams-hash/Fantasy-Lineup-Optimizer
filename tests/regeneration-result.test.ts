import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRegeneration } from "../client/src/lib/regeneration-result";

test("summarizes cloned regeneration results without treating clones as failures", () => {
  const summary = summarizeRegeneration({
    cloned: 2,
    results: [
      { sourceLineupId: 41, newLineupId: 901, status: "cloned" },
      { sourceLineupId: 42, newLineupId: 902, status: "cloned" },
      { sourceLineupId: 43, status: "skipped", error: "Slate unavailable" },
    ],
  });

  assert.equal(summary.cloned, 2);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.newLineupIds, [901, 902]);
  assert.equal(summary.outcomes[0].sourceLineupId, 41);
});

test("accepts legacy updates and top-level clone IDs during rollout", () => {
  const summary = summarizeRegeneration({
    updated: 1,
    created: 1,
    newLineupIds: [1002],
    results: [
      { id: 7, status: "updated" },
      { sourceId: 8, lineupId: 1001, status: "clone" },
      { id: 9, status: "failed", error: "No unique lineup" },
    ],
  });

  assert.equal(summary.updated, 1);
  assert.equal(summary.cloned, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.newLineupIds, [1001, 1002]);
  assert.equal(summary.outcomes[1].sourceLineupId, 8);
});