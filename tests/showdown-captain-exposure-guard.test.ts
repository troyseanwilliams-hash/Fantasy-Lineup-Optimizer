import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Showdown role exposure controls omit zero and send min/max maps", () => {
  const source = readFileSync("client/src/pages/ShowdownBuilder.tsx", "utf8");
  assert.match(source, /captainMinExposure \?\? 0\) > 0/);
  assert.match(source, /captainMaxExposure \?\? 0\) > 0/);
  assert.match(source, /perPlayerCaptainMinExposure:/);
  assert.match(source, /perPlayerCaptainMaxExposure:/);
  assert.match(source, /flexMinExposure \?\? 0\) > 0/);
  assert.match(source, /flexMaxExposure \?\? 0\) > 0/);
  assert.match(source, /perPlayerFlexMinExposure:/);
  assert.match(source, /perPlayerFlexMaxExposure:/);
  assert.match(source, /data-testid={`captain-min-exposure-\$\{player\.id\}`}/);
  assert.match(source, /data-testid={`captain-max-exposure-\$\{player\.id\}`}/);
  assert.match(source, /data-testid={`flex-min-exposure-\$\{player\.id\}`}/);
  assert.match(source, /data-testid={`flex-max-exposure-\$\{player\.id\}`}/);
  assert.match(source, /lineupCount: Math\.min\(lineupCount, maxLineups\),\s+numSims,/);
});