import test from "node:test";
import assert from "node:assert/strict";
import { buildShowdownPortfolio, captainLaws, correlationMultiplier, defaultShowdownConfig, legalShowdownLineup, rosterDifference } from "../shared/nfl-showdown-strategy";
import { csvText, exportClassicUpload, exportShowdownUpload, parseCheatSheet, parseClassicUpload, parseOfficialTemplate, readCsv } from "../shared/nfl-gpp-csv";
import { auditClassicUpload } from "../shared/nfl-classic-audit";
import type { GppPlayer, OfficialPlayer } from "../shared/nfl-gpp-types";

export function fixturePool(): GppPlayer[] {
  const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "DST"] as const;
  const salaries = [10000, 8800, 3800, 9600, 6400, 3200, 5600, 2200, 4400, 4000];
  const projections = [21, 18, 7, 19, 13, 6, 11, 5, 8, 7];
  return ["AAA", "BBB"].flatMap((team, t) => positions.map((pos, i) => ({
    id: `${team}${i}`, name: `${team} Player ${i}`, pos, team, flexSalary: salaries[i],
    cptSalary: salaries[i] * 1.5, projection: projections[i] + t, cptOwn: 5 + i, flexOwn: 17 + i,
  })));
}
test("all specified correlation deck multipliers and captain laws", () => {
  const pool = fixturePool(), c = pool[0];
  const candidate = (pos: GppPlayer["pos"], same: boolean) => ({ ...pool[3], pos, team: same ? c.team : "BBB" });
  const cases: [GppPlayer["pos"], GppPlayer["pos"], boolean, number][] = [
    ["QB","WR",true,1.25],["QB","TE",true,1.25],["QB","RB",true,1.12],["QB","DST",false,.75],
    ["RB","DST",true,1.25],["RB","K",true,1.25],["RB","RB",true,1.12],["RB","QB",false,1.12],
    ["WR","QB",true,1.25],["WR","K",true,1.12],["WR","RB",true,1.12],["WR","WR",true,.75],
    ["TE","QB",true,1.25],["TE","QB",false,1.12],["TE","WR",false,1.12],
    ["TE","K",true,.75],["TE","TE",true,.75],["TE","DST",true,.75],["TE","K",false,.75],["TE","DST",false,.75],
  ];
  for (const [cap, pos, same, multiplier] of cases) assert.equal(correlationMultiplier({ ...c, pos: cap }, candidate(pos, same)), multiplier);
  assert.equal(captainLaws(c, [candidate("RB", true)]), false);
  assert.equal(captainLaws(c, [candidate("WR", true)]), true);
  assert.equal(captainLaws({ ...c, pos: "WR" }, [candidate("QB", false)]), false);
  assert.equal(captainLaws({ ...c, pos: "RB" }, [candidate("DST", true), candidate("WR", false)]), true);
});
test("19-lineup portfolio satisfies laws, strict uniqueness, exact quotas and raw scoring", async () => {
  const pool = fixturePool(), config = defaultShowdownConfig(pool, 19);
  const a = await buildShowdownPortfolio(pool, config);
  const b = await buildShowdownPortfolio(pool, config);
  assert.deepEqual(a, b, "identical seed/config must reproduce the exact set");
  assert.equal(a.lineups.length, 19);
  const byId = new Map(pool.map(p => [p.id, p]));
  for (let i = 0; i < a.lineups.length; i++) {
    const l = a.lineups[i];
    assert.ok(legalShowdownLineup(l, byId));
    assert.equal(l.projection, byId.get(l.captain)!.projection * 1.5 + l.flex.reduce((s, id) => s + byId.get(id)!.projection, 0));
    for (let j = 0; j < i; j++) assert.ok(rosterDifference(l, a.lineups[j]) >= 2);
  }
  for (const p of pool) {
    assert.equal(a.lineups.filter(l => l.captain === p.id).length, config.captainPlan[p.id]);
    assert.ok(a.lineups.filter(l => l.flex.includes(p.id)).length >= config.flexMinimums[p.id]);
  }
  const teams = a.lineups.map(l => [l.captain, ...l.flex].filter(id => byId.get(id)!.team === config.favoriteTeam).length);
  assert.deepEqual([teams.filter(n => n === 4).length, teams.filter(n => n === 2).length, teams.filter(n => n === 3).length, teams.filter(n => n === 1 || n === 5).length], [6,4,6,3]);
  assert.equal(a.lineups.filter(l => [l.captain, ...l.flex].some(id => byId.get(id)!.pos === "K")).length, config.kickerTarget);
});
test("invalid and excluded captain targets fail without returning partial portfolios", async () => {
  const pool = fixturePool(), c = defaultShowdownConfig(pool, 19);
  c.captainPlan[pool[0].id] = 99;
  await assert.rejects(buildShowdownPortfolio(pool, c), /counts/);
  const d = defaultShowdownConfig(pool, 19); d.excludedIds = [pool[0].id];
  await assert.rejects(buildShowdownPortfolio(pool, d), /excluded/);
  const e = defaultShowdownConfig(pool, 19); e.flexTargets[pool[0].id] = 19;
  await assert.rejects(buildShowdownPortfolio(pool, e), /exceed/);
});
test("cheat sheet merges slot rows and rejects missing ownership or non-Showdown salary", () => {
  const pool = fixturePool();
  const header = ["Player","Position","Team","CPT salary","FLEX salary","Projection","CPT ownership %","FLEX ownership %"];
  const rows = pool.map(p => [p.name,p.pos,p.team,p.cptSalary,p.flexSalary,p.projection,p.cptOwn,p.flexOwn]);
  assert.equal(parseCheatSheet(csvText([header,...rows])).length, 20);
  const bad = rows.map(r => [...r]); bad[0][6] = "";
  assert.throws(() => parseCheatSheet(csvText([header,...bad])), /Missing/);
  bad[0][6] = 10; bad[0][3] = 11000;
  assert.throws(() => parseCheatSheet(csvText([header,...bad])), /1.5/);
  const sections = pool.flatMap(p => [
    [p.name,p.pos,p.team,"CPT",p.cptSalary,p.projection*1.5,p.cptOwn],
    [p.name,p.pos,p.team,"FLEX",p.flexSalary,p.projection,p.flexOwn],
  ]);
  const merged = parseCheatSheet(csvText([["Player","Position","Team","Roster Position","Salary","Projection","Ownership %"],...sections]));
  assert.equal(merged[0].projection, pool[0].projection);
});
test("official export uses distinct CPT IDs, repeated FLEX headers, and rejects salary/name mismatches", () => {
  const pool = fixturePool();
  const rows = pool.flatMap((p,i) => [
    [p.pos,p.name,1000+i,"FLEX",p.flexSalary,p.team],
    [p.pos,p.name,2000+i,"CPT",p.cptSalary,p.team],
  ]);
  const official = parseOfficialTemplate(csvText([["Position","Name","ID","Roster Position","Salary","TeamAbbrev"],...rows]));
  const lineup = { captain: pool[0].id, flex: [pool[3],pool[5],pool[6],pool[12],pool[14]].map(p => p.id), salary: 0, projection: 0, ownership: 0 };
  const out = readCsv(exportShowdownUpload([lineup],pool,official));
  assert.deepEqual(out[0], ["Entry ID","CPT","FLEX","FLEX","FLEX","FLEX","FLEX"]);
  assert.equal(out[1][1], "2000"); assert.equal(out[1][2], "1003");
  assert.throws(() => exportShowdownUpload([lineup],pool,official.map(p=>({...p,flexSalary:p.flexSalary+100}))), /salary/i);
  assert.throws(() => exportShowdownUpload([lineup],pool,official.map(p=>({...p,name:"Wrong"}))), /exact/);
});
export function classicFixture() {
  const slots = ["QB","RB","RB","WR","WR","WR","TE","FLEX","DST"];
  const official: OfficialPlayer[] = [];
  for (const pos of ["QB","RB","WR","TE","DST"]) for (let i=0;i<20;i++) official.push({
    name:`${pos} ${i}`,pos,team: i%2 ? "AAA":"BBB",flexId:String(10000+official.length),flexSalary: pos==="DST"?3000:5000,
  });
  const base = ["QB","RB","RB","WR","WR","WR","TE","TE","DST"].map((pos,i)=>official.filter(p=>p.pos===pos)[i].flexId);
  const upload = parseClassicUpload(csvText([["Entry ID",...slots], ...Array.from({length:20},(_,i)=>[String(9000+i),...base])]),official);
  return {official,upload};
}
test("Classic legacy audit input cannot bypass new evidence requirements", () => {
  const {official,upload} = classicFixture(), before=JSON.stringify(upload);
  const excluded = [upload.entries[0].playerIds[0]];
  assert.throws(()=>auditClassicUpload(upload, official, excluded),/evidence/);
  assert.equal(JSON.stringify(upload),before);
});
test("Classic small sets and missing alternatives report unresolved rather than relaxing caps", () => {
  const {official,upload} = classicFixture();
  upload.entries=upload.entries.slice(0,2);
  assert.throws(()=>auditClassicUpload(upload,official,[]),/superseded/);
});
