import assert from "node:assert/strict";
import { exportMmaLineups, optimizeMmaLineups, parseCsvRows, parseDraftKingsMmaCsv } from "../client/src/lib/mma-optimizer";

assert.deepEqual(parseCsvRows('A,B\n"x, ""quoted""",y\n'), [["A", "B"], ['x, "quoted"', "y"]]);
assert.throws(() => parseCsvRows('A\n"open'), /not closed/);
assert.throws(() => parseCsvRows(`A\n${"x".repeat(2 * 1024 * 1024 + 1)}`), /too large/);

const header = "Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame";
const rows = Array.from({ length: 12 }, (_, i) =>
  `F,"Fighter ${i + 1} (${9001 + i})",Fighter ${i + 1},${9001 + i},F,${6000 + i * 200},"A${Math.floor(i / 2)}@B${Math.floor(i / 2)} 12/31/2099 07:00PM ET",T${i},${80 + i}`,
);
const fighters = parseDraftKingsMmaCsv([header, ...rows].join("\n"));
assert.equal(fighters.length, 12);
assert.equal(fighters[0].id, "9001");
assert.equal(fighters[0].projection, null, "AvgPointsPerGame must never become a projection");
assert.throws(() => parseDraftKingsMmaCsv([header, rows[0], rows[0], ...rows.slice(2)].join("\n")), /Duplicate DraftKings ID/);
assert.throws(() => parseDraftKingsMmaCsv([header, rows[0].replace(/^F,/, "QB,"), ...rows.slice(1)].join("\n")), /Non-MMA position/);
assert.throws(() => parseDraftKingsMmaCsv([header, rows[0].replace(",9001,F,", ",9999,F,"), ...rows.slice(1)].join("\n")), /Conflicting DraftKings IDs/);
assert.throws(() => parseDraftKingsMmaCsv([header, `${rows[0]},extra`, ...rows.slice(1)].join("\n")), /expected 9 columns/);

const labelsOnly = parseDraftKingsMmaCsv([header, ...rows.map(row => row.replace(/"A\d+@B\d+ /, '"UFC 331 '))].join("\n"));
assert.ok(labelsOnly.every(f => f.boutKey === null), "event labels must not be inferred as bouts");
const datesOnly = parseDraftKingsMmaCsv([header, ...rows.map(row => row.replace(/"A\d+@B\d+ /, '"'))].join("\n"));
assert.ok(datesOnly.every(f => f.boutKey === null), "date-only game info must not be inferred as a bout");

const projected = fighters.map((fighter, i) => ({ ...fighter, projection: 100 - i }));
const lineups = optimizeMmaLineups(projected, 2, true, Date.UTC(2025, 0, 1));
assert.equal(lineups.length, 2);
for (const lineup of lineups) {
  assert.equal(lineup.fighters.length, 6);
  assert.equal(new Set(lineup.fighters.map(f => f.id)).size, 6);
  assert.ok(lineup.salary <= 50_000);
  assert.equal(new Set(lineup.fighters.map(f => f.boutKey)).size, 6, "opponents cannot share a lineup");
}
assert.throws(() => optimizeMmaLineups(projected.map(f => ({ ...f, projection: null })), 1, false), /manual projection/);
const exported = exportMmaLineups(lineups, projected, Date.UTC(2025, 0, 1));
assert.equal(exported.split("\n")[0], '"F","F","F","F","F","F"');
assert.equal(exported.split("\n")[1].split(",").length, 6);
assert.ok(exported.includes("(9001)"));
assert.ok(!exported.includes("Entry ID"));
assert.throws(
  () => optimizeMmaLineups(projected, 1, false, Date.UTC(2100, 0, 1)),
  /slate has started/,
);
assert.throws(
  () => exportMmaLineups(lineups, projected, Date.UTC(2100, 0, 1)),
  /Export is blocked/,
);
const earliest = Date.UTC(2025, 0, 1);
const mixedStarts = projected.map((f, index) => ({
  ...f,
  startTime: index === 0 ? earliest : Date.UTC(2025, 0, 2),
  excluded: index === 0,
}));
assert.throws(
  () => optimizeMmaLineups(mixedStarts, 1, false, earliest + 1),
  /slate has started/,
  "an excluded early fighter must still lock the entire imported slate",
);
assert.throws(
  () => exportMmaLineups(lineups, mixedStarts, earliest + 1),
  /Export is blocked/,
  "export must recheck the earliest start across the full imported slate",
);
assert.throws(
  () => exportMmaLineups(lineups, projected.map(f => lineupIds(lineups[0]).has(f.id) ? { ...f, salary: 10_000 } : f), Date.UTC(2025, 0, 1)),
  /salary cap/,
);

function lineupIds(lineup: (typeof lineups)[number]): Set<string> {
  return new Set(lineup.fighters.map(f => f.id));
}

console.log("MMA optimizer parser, solver, and export checks passed.");