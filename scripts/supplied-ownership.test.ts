import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Player } from "../shared/schema";
import { SUPPLIED_NFL_OWNERSHIP, suppliedOwnershipForPool, type OwnershipScope } from "../server/supplied-nfl-ownership";

// No connections or writes: all storage methods used by the engine are stubbed.
process.env.DATABASE_URL ||= "postgresql://unused:unused@localhost/unused";
const { storage } = await import("../server/storage");
const { calculateOwnership, computeOwnershipForPlayers } = await import("../server/ownership-engine");
const scope: OwnershipScope = {
  id: 18174, sport: "NFL", platform: "draftkings",
  startTime: new Date("2026-09-20T17:00:00Z"), isMain: true,
  draftGroupId: 153428, gameType: "Classic",
};
const pool = SUPPLIED_NFL_OWNERSHIP.map(([draftKingsPlayerId, name, position, team, salary], i) => ({
  id: i + 1, slateId: scope.id, draftKingsPlayerId, name, position, team, salary,
  projectedPoints: "20", fppg: "20", injuryStatus: null,
} as Player));
const attachment = readFileSync("attached_assets/Pasted--Here-s-a-more-complete-projected-ownership-list-for-to_1789879533885.txt", "utf8");
const sourceRows = [...attachment.matchAll(/^\|\s*(.*?)\s*\|\s*(QB|RB|WR|TE|DST)\s*\|\s*(\w+)\s*\|\s*\$([\d,]+)\s*\|\s*\**([\d.]+)%/gm)];
assert.equal(sourceRows.length, 50);
assert.equal(SUPPLIED_NFL_OWNERSHIP.length, 50);
assert.equal(new Set(SUPPLIED_NFL_OWNERSHIP.map(r => r[0])).size, 50);
sourceRows.forEach(([, name, position, team, salary, pct], i) => {
  assert.deepEqual(SUPPLIED_NFL_OWNERSHIP[i].slice(1), [name, position, team, Number(salary.replaceAll(",", "")), Number(pct)]);
});
const scopes = new Map([[scope.id, scope]]);
assert.equal(suppliedOwnershipForPool(pool, scopes).size, 50);
for (const change of [
  { platform: "fanduel" }, { platform: "yahoo" }, { sport: "NBA" },
  { startTime: new Date("2026-09-21T17:00:00Z") }, { draftGroupId: 153429 },
  { isMain: false }, { gameType: "Showdown" },
]) {
  assert.equal(suppliedOwnershipForPool(pool, new Map([[scope.id, { ...scope, ...change }]])).size, 0);
}
assert.equal(suppliedOwnershipForPool(pool, new Map()).size, 0);
const aliases = pool.map(p => ({
  ...p, team: p.team === "JAC" ? "JAX" : p.team,
  name: ({ "Tampa Bay Buccaneers": "Buccaneers", "Baltimore Ravens": "Ravens", "Denver Broncos": "Broncos" } as Record<string, string>)[p.name] ?? p.name,
}));
assert.equal(suppliedOwnershipForPool(aliases, scopes).size, 50);
assert.equal(suppliedOwnershipForPool(aliases.map(p => ({ ...p, draftKingsPlayerId: null })), scopes).size, 50);
for (const change of [{ draftKingsPlayerId: 999 }, { name: "Wrong player" }, { team: "NYG" }, { position: "WR" }, { salary: 8300 }]) {
  const warnings: string[] = [];
  assert.equal(suppliedOwnershipForPool([{ ...pool[0], ...change }], scopes, m => warnings.push(m)).size, 0);
  assert.ok(warnings.length > 0);
}
const warnings: string[] = [];
assert.equal(suppliedOwnershipForPool([pool[0], { ...pool[0], id: 999 }], scopes, m => warnings.push(m)).size, 0);
assert.ok(warnings.length > 0);

const originalHistory = storage.getPlayerHistoryBySport;
const originalSlate = storage.getSlate;
let metadataReads = 0;
storage.getPlayerHistoryBySport = async () => [];
storage.getSlate = async id => {
  metadataReads++;
  return { ...scope, id, draftGroupId: id === scope.id ? 153428 : 999 } as Awaited<ReturnType<typeof originalSlate>>;
};
try {
  const missing = { ...pool[0], id: 100, name: "Unlisted player", draftKingsPlayerId: 123456 };
  const withMissing = [...aliases, missing];
  const modeled = await calculateOwnership(withMissing.map(p => ({ ...p, slateId: 999 })), "NFL");
  const blended = await calculateOwnership(withMissing, "NFL");
  for (const contest of ["gpp_large", "gpp_small", "cash"] as const) {
    const results = await calculateOwnership(withMissing, "NFL", contest);
    for (const [i, row] of SUPPLIED_NFL_OWNERSHIP.entries()) {
      const result = results.find(r => r.playerId === i + 1)!;
      assert.equal(result.projectedOwnership, row[5]);
      assert.equal(result.ownershipSource, "supplied");
      assert.match(result.ownershipSourceLabel!, /not independently verified/);
    }
  }
  assert.equal(blended.find(p => p.playerId === 100)?.projectedOwnership, modeled.find(p => p.playerId === 100)?.projectedOwnership);
  assert.ok(blended.find(p => p.playerId === 100)!.projectedOwnership > 0);
  assert.equal(blended.find(p => p.playerId === 100)?.ownershipSource, "estimated");
  const ui = computeOwnershipForPlayers(withMissing, blended);
  assert.equal(ui[0].ownershipProjection, 40.1);
  assert.equal(ui[0].ownershipSource, "supplied");
  assert.equal(ui.at(-1)?.ownershipSource, "estimated");
  assert.equal(metadataReads, 2, "only slate metadata is cached");
  const changed = await calculateOwnership([{ ...missing, projectedPoints: "1000" }, ...pool], "NFL");
  assert.notEqual(changed.find(p => p.playerId === 100)?.projectedOwnership, blended.find(p => p.playerId === 100)?.projectedOwnership);
  const mixed = await calculateOwnership([pool[0], { ...pool[1], slateId: 999 }], "NFL");
  assert.equal(mixed.find(p => p.playerId === 1)?.ownershipSource, "supplied");
  assert.equal(mixed.find(p => p.playerId === 2)?.ownershipSource, "estimated");
} finally {
  storage.getPlayerHistoryBySport = originalHistory;
  storage.getSlate = originalSlate;
}
console.log("PASS: exact 50 attachment values, aliases, identity guards, scope isolation, blended estimates, no rescaling, all contest types, metadata-only cache, and API/UI provenance.");