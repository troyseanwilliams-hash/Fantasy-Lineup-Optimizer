import assert from "node:assert/strict";
import {
  buildShowdownCSV,
  getShowdownDisplayData,
  isShowdownLineup,
} from "../shared/showdown-lineups";
import { validateShowdownRoster } from "../server/showdown-validation";

const classic = {
  playerSnapshot: [{ id: 1, name: "Classic Player" }],
};
const showdown = {
  platform: "draftkings",
  playerSnapshot: [
    { id: 3, name: "Flex Two", slot: "FLEX2", draftKingsPlayerId: 9003 },
    { id: 1, name: "Captain", slot: "CPT", isCaptain: true, draftKingsPlayerId: 9001 },
    { id: 2, name: "Flex One", slot: "FLEX1", draftKingsPlayerId: 9002 },
  ],
};

assert.equal(isShowdownLineup(classic), false);
assert.equal(isShowdownLineup(showdown), true);
assert.deepEqual(getShowdownDisplayData(showdown)?.slots, ["CPT", "FLEX1", "FLEX2"]);
assert.deepEqual(
  Object.values(getShowdownDisplayData(showdown)?.assignments || {}).map(player => player.name),
  ["Captain", "Flex One", "Flex Two"],
);
assert.equal(
  buildShowdownCSV([showdown]),
  '"CPT","FLEX1","FLEX2"\n"Captain (9001)","Flex One (9002)","Flex Two (9003)"',
);

const validRoster = validateShowdownRoster("1", ["2", 3], 3, [1, 2, 3]);
assert.deepEqual(validRoster, { valid: true, captainId: 1, flexPlayerIds: [2, 3] });
assert.equal(validateShowdownRoster(1, [1, 2], 3, [1, 2, 3]).valid, false);
assert.equal(validateShowdownRoster(1, [2, 2], 3, [1, 2, 3]).valid, false);
assert.equal(validateShowdownRoster(1, [2, 99], 3, [1, 2, 3]).valid, false);

console.log("Showdown lineup regression checks passed.");