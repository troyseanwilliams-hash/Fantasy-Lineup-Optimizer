import assert from "node:assert/strict";
import test from "node:test";
import { buildShowdownCSV } from "../shared/showdown-lineups";

function player(id: number, slot: string, isCaptain = false) {
  return {
    id,
    name: `Player ${id}`,
    slot,
    isCaptain,
    draftKingsPlayerId: 1000 + id,
    fanDuelPlayerId: 2000 + id,
  };
}

test("DraftKings Showdown export uses repeated FLEX upload columns", () => {
  const csv = buildShowdownCSV([{
    platform: "draftkings",
    playerSnapshot: [
      player(1, "CPT", true),
      player(2, "FLEX1"),
      player(3, "FLEX2"),
      player(4, "FLEX3"),
      player(5, "FLEX4"),
      player(6, "FLEX5"),
    ],
  }]);

  assert.equal(csv.split("\n")[0], '"CPT","FLEX","FLEX","FLEX","FLEX","FLEX"');
  assert.match(csv, /"Player 1 \(1001\)"/);
  assert.doesNotMatch(csv, /FLEX1/);
});

test("DraftKings Showdown export preserves captain-first and numbered-flex ordering", () => {
  const csv = buildShowdownCSV([{
    platform: "draftkings",
    playerSnapshot: [
      player(3, "FLEX2"),
      player(1, "CPT", true),
      player(2, "FLEX1"),
    ],
  }]);

  assert.equal(csv.split("\n")[1], '"Player 1 (1001)","Player 2 (1002)","Player 3 (1003)"');
});