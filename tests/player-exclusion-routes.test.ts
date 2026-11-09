import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("saved exclusions propagate through Standard, Pro, Sim and Resim HTTP handlers", () => {
  // Reuse the isolated route fixture without running its superseded Classic
  // preset expectations. This entry runs in normal test discovery, not just CI env.
  const env = { ...process.env, EXCLUSION_REGRESSION: "1" };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "--test", "tests/nfl-portfolio-routes.integration.test.ts",
  ], { env, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Saved exclusion propagation verified for 4 routes/);
});
