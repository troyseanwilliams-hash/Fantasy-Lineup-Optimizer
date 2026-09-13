import assert from "node:assert/strict";
import test from "node:test";
import { parseGameInfo, sanitizeGameInfo } from "../shared/game-info";

test("player-facing game labels hide persisted DK lifecycle metadata", () => {
  const raw = "DAL @ NYG 8:15 PM ET [DK_START:2026-09-14T20:15:00.0000000]";
  assert.equal(sanitizeGameInfo(raw), "DAL @ NYG 8:15 PM ET");
  assert.equal(parseGameInfo(raw).display, "DAL @ NYG 8:15 PM ET");
  assert.equal(parseGameInfo(raw).away, "DAL");
  assert.equal(parseGameInfo(raw).home, "NYG");
  assert.equal(parseGameInfo(raw).time, "8:15 PM ET");
});

test("parses dotted matchup time after removing lifecycle metadata", () => {
  const parsed = parseGameInfo("LAL @ GSW · 8:30 PM ET [DK_START:2025-05-01T00:30:00.000Z]");

  assert.equal(parsed.display, "LAL @ GSW · 8:30 PM ET");
  assert.equal(parsed.matchup, "LAL @ GSW");
  assert.equal(parsed.away, "LAL");
  assert.equal(parsed.home, "GSW");
  assert.equal(parsed.time, "8:30 PM ET");
});

test("leaves unmarked legacy game strings unchanged", () => {
  const legacy = "Boston @ New York 7:00PM";
  assert.equal(sanitizeGameInfo(legacy), legacy);
  assert.equal(parseGameInfo(legacy).display, legacy);
});