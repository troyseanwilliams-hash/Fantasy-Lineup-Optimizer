import test from "node:test";
import assert from "node:assert/strict";
import type { Player } from "../shared/schema";
import { classicLogicSchema, CLASSIC_POSITION_CAPS, classicMinimum, rushingQualified } from "../shared/nfl-classic-logic";
import { nflPortfolioSettingsSchema } from "../shared/nfl-portfolio";
import { validateClassicEvidence, classicExposureBounds } from "../server/nfl-classic-readiness";
import { generateClassicPortfolio, classicArchitecture, classicLineupErrors } from "../server/nfl-classic-engine";
import { addNflPortfolioConstraints } from "../server/nfl-portfolio";
import { solveWithBudget, validatedIntegralResult } from "../server/solver-guard";
import { auditClassicUpload } from "../shared/nfl-classic-audit";
import { parseClassicInputs, classicInputHeaderCsv } from "../shared/nfl-classic-inputs";
import { buildAppClassicInputs } from "../server/nfl-classic-app-data";
import { classicCapacityIssue } from "../server/nfl-classic-capacity";

test("five-lineup batches keep rounded-down caps and find complementary rosters", async () => {
  const { pool, settings } = fixture();
  settings.classic = buildAppClassicInputs(pool, 77, new Map(pool.map(p => [p.id, 8])));
  const result = await generateClassicPortfolio({ pool, settings, count: 5, baseConstraints: {},
    deadline: Date.now() + 28000, solve });
  assert.equal(result.lineups.length, 5);
  const used = result.lineups.flatMap(l => l.lineup.map(p => p.id));
  assert.equal(new Set(used).size, 45, "each unanchored player may appear only once");
  assert.ok(result.lineups.filter(l => classicArchitecture(l.lineup).full).length >= 2);
  for (const l of result.lineups) assert.deepEqual(classicLineupErrors(l.lineup, settings, []), []);
});

test("capacity diagnostics distinguish proven shortages from an unproven search failure", () => {
  const { pool } = fixture();
  const max = new Map(pool.map(p => [p.id, CLASSIC_POSITION_CAPS[p.position]]));
  assert.equal(classicCapacityIssue(pool, max, 5), undefined);
  const limited = pool.filter(p => p.position !== "QB" || p.id <= 28);
  assert.match(classicCapacityIssue(limited, max, 5)!, /QB exposure capacity is 4.*require at least 5/);
  assert.match(classicCapacityIssue(pool, max, 5, 200)!, /below the required 200/);
  assert.equal(classicCapacityIssue(pool, max, 5, 100), undefined);
});

test("Sim may return a smaller complete portfolio, with caps on the actual size", async () => {
  const { pool, settings } = fixture();
  settings.classic = buildAppClassicInputs(pool, 77, new Map(pool.map(p => [p.id, 8])));
  const result = await generateClassicPortfolio({ pool, settings, count: 500, allowReducedCount: true,
    baseConstraints: {}, deadline: Date.now() + 28000, solve,
    scoreCandidates: candidates => candidates.map((_, i) => i) });
  const count = result.lineups.length;
  assert.ok(count >= 4 && count < 500);
  assert.equal(result.report.requestedCount, 500);
  assert.equal(result.report.generatedCount, count);
  assert.equal(result.report.partial, true);
  for (const p of pool) assert.ok(result.lineups.filter(l => l.lineup.some(q => q.id === p.id)).length <= Math.floor(CLASSIC_POSITION_CAPS[p.position] * count / 100));
  for (let i = 0; i < count; i++) {
    assert.deepEqual(classicLineupErrors(result.lineups[i].lineup, settings, []), []);
    for (let j = 0; j < i; j++) assert.ok(result.lineups[i].lineup.filter(p => result.lineups[j].lineup.some(q => q.id === p.id)).length <= 6);
  }
  assert.ok(result.lineups.filter(l => classicArchitecture(l.lineup).full).length >= Math.round(count * .34));
});

test("Normal mode never silently reduces the requested batch", async () => {
  const { pool, settings } = fixture();
  settings.classic = buildAppClassicInputs(pool, 77, new Map(pool.map(p => [p.id, 8])));
  await assert.rejects(generateClassicPortfolio({ pool, settings, count: 500,
    baseConstraints: {}, deadline: Date.now() + 2000, solve }), /12 eligible QBs/);
});

test("app inputs need no import, never fabricate reviews, and preserve caps", async () => {
  const { pool, settings } = fixture();
  // Real feed regression: Kyle Allen's -0.2 projection is valid, but ineligible.
  pool.push({ ...pool[0], id: 999, name: "Kyle Allen", projectedPoints: "-0.2" });
  settings.classic = buildAppClassicInputs(pool, 77, new Map(pool.map(p => [p.id, 8])));
  assert.equal(settings.classic.players["999"].projection, -0.2);
  assert.deepEqual(settings.classic.anchors, {});
  assert.equal(settings.classic.players["1"].statusCheckedAt, undefined);
  assert.equal(settings.classic.players["1"].weatherCheckedAt, undefined);
  assert.equal(settings.classic.players["1"].recent.length, 0);
  assert.equal(validateClassicEvidence(pool, settings.classic, 77).length, pool.length - 1);
  assert.ok(!validateClassicEvidence(pool, settings.classic, 77).some(p => p.id === 999));
  assert.throws(() => buildAppClassicInputs(pool, 77, new Map()), /unavailable/);
  assert.throws(() => validateClassicEvidence(pool, settings.classic, 78), /different slate/);
  const injured = pool.map((p, i) => i === 0 ? { ...p, injuryStatus: "OUT" } : p);
  assert.equal(validateClassicEvidence(injured, settings.classic).length, pool.length - 2);
  const result = await generateClassicPortfolio({ pool, settings, count: 20, baseConstraints: {},
    deadline: Date.now() + 28000, solve });
  assert.equal(result.lineups.length, 20);
  assert.ok(result.lineups.every(l => l.lineup.every(p => p.id !== 999)));
  assert.equal(result.report.dataSources?.ownership, "estimated");
  assert.ok(result.report.warnings.some(w => w.includes("Not verified")));
  for (const p of pool) assert.ok(result.lineups.filter(l => l.lineup.some(q => q.id === p.id)).length <= Math.floor(CLASSIC_POSITION_CAPS[p.position] * 20 / 100));
  for (const l of result.lineups) assert.deepEqual(classicLineupErrors(l.lineup, settings, []), []);
});

test("app inputs accept finite negative values but reject genuinely missing projections", () => {
  const { pool } = fixture();
  for (const value of ["-0.2", "0", "3.9", "4"]) {
    const player = { ...pool[0], projectedPoints: value };
    const classic = buildAppClassicInputs([player], 77, new Map([[player.id, 8]]));
    assert.equal(validateClassicEvidence([player], classic).length, Number(value) >= 4 ? 1 : 0);
  }
  for (const value of ["", " ", "NaN", "Infinity", null, undefined]) {
    const player = { ...pool[0], projectedPoints: value } as unknown as Player;
    assert.throws(() => buildAppClassicInputs([player], 77, new Map([[player.id, 8]])), /unavailable/);
  }
});

function fixture() {
  const teams = ["A","B","C","D","E","F","G","H","I","J"];
  const pool = teams.flatMap((team,t)=>["QB","RB","RB","WR","WR","WR","TE","TE","DST"].map((position,i)=>({
    id:t*9+i+1,slateId:77,name:`${team} ${position} ${i}`,team,position,
    salary:position==="DST"?3000:5000,projectedPoints:position==="DST"?"8":"14",fppg:"14",
    gameInfo:`${teams[t-t%2]} @ ${teams[t-t%2+1]}`,opponent:teams[t%2?t-1:t+1],injuryStatus:null,injuryDetail:null,
  }))) as Player[];
  const now=new Date().toISOString();
  const players=Object.fromEntries(pool.map(p=>[p.id,{
    projection:Number(p.projectedPoints),ownership:5,status:"ACTIVE",statusCheckedAt:now,
    depthChartNotes:"Full depth chart checked; no changes",weatherNotes:"Game reviewed; no automatic veto",weatherCheckedAt:now,
    recent:[{targets:5,carries:6,routes:20,rushYards:35},{targets:6,carries:7,routes:22,rushYards:37}],
    opportunity:"producing",punt:false,valueTier:false,chalk:p.position==="RB",rushingQb:p.position==="QB",
    roadUnderdogSpread:0,opponentImpliedTotal:19,opponentSackRate:7,opponentFumbleRate:2,opponentIntRate:3,
    eliteTurnoverMatchup:false,topDefense:false,ceiling:25,
  }]));
  const classic=classicLogicSchema.parse({projectionSource:"DFS Army",slateId:77,players,anchors:{"2":40,"11":40}});
  return {pool,classic,settings:nflPortfolioSettingsSchema.parse({enabled:true,classic})};
}
function solve(pool:Player[], constraints:any) {
  const m:any={optimize:"points",opType:"max",constraints:{size:{equal:9},salary:{max:50000},QB:{equal:1},RB:{equal:2},WR:{equal:4},TE:{equal:1},DST:{equal:1}},variables:{},ints:{}};
  for(const p of pool) {
    m.variables[`p${p.id}`]={points:Number(p.projectedPoints),size:1,salary:p.salary,[p.position]:1,[`one${p.id}`]:1};
    m.ints[`p${p.id}`]=1;m.constraints[`one${p.id}`]={max:1};
    if(constraints.lockedPlayerIds?.includes(p.id)) {m.constraints[`lock${p.id}`]={equal:1};m.variables[`p${p.id}`][`lock${p.id}`]=1;}
    if(constraints.excludedPlayerIds?.includes(p.id)) {m.constraints[`out${p.id}`]={equal:0};m.variables[`p${p.id}`][`out${p.id}`]=1;}
  }
  addNflPortfolioConstraints(m,pool,constraints.nflPortfolioLineupPolicy,constraints.ownershipMap);
  const r=validatedIntegralResult(solveWithBudget(m,{timeoutMs:100}).result,m);
  return {lineup:r?pool.filter(p=>r[`p${p.id}`]>.5):[]};
}
test("full-list readiness rejects missing/stale data and mechanically excludes unavailable players",()=>{
  const {pool,classic}=fixture();
  assert.equal(validateClassicEvidence(pool,classic,77).length,90);
  const missing=structuredClone(classic);delete missing.players["4"];
  assert.throws(()=>validateClassicEvidence(pool,missing,77),/Full-list/);
  assert.throws(()=>validateClassicEvidence(pool,classic,88),/different slate/);
  classic.players["3"].status="PUP";
  classic.players["4"].status="EXEMPT";
  classic.players["5"].projection=3.99;
  classic.players["12"].roadUnderdogSpread=10;
  classic.players["18"].opponentImpliedTotal=24;
  const allowed=new Set(validateClassicEvidence(pool,classic,77).map(p=>p.id));
  for(const id of [3,4,5,12,18]) assert.ok(!allowed.has(id));
  classic.players["1"].statusCheckedAt=new Date(Date.now()-40*60000).toISOString();
  assert.throws(()=>validateClassicEvidence(pool,classic,77,new Date(Date.now()+60*60000)),/within 30/);
});
test("role floors include RB/TE, rushing requires logs, anchor overrides remain subordinate to explicit caps",()=>{
  const {pool,settings,classic}=fixture();
  const e=classic.players["3"];e.valueTier=true;e.punt=true;
  assert.equal(classicMinimum(e,"RB"),5);assert.equal(classicMinimum(e,"TE"),5);
  e.opportunity="fading";assert.equal(classicMinimum(e,"RB"),0);
  assert.ok(rushingQualified(classic.players["1"]));
  classic.players["1"].recent[1].carries=1;assert.equal(rushingQualified(classic.players["1"]),false);
  settings.classic=classic;
  assert.equal(classicExposureBounds(pool,settings,{}).maximum.get(2),40);
  classic.players["2"].topDefense=true;
  assert.equal(classicExposureBounds(pool,settings,{}).maximum.get(2),30);
  assert.throws(()=>classicExposureBounds(pool,settings,{globalMaxExposure:20}),/minimum exceeds/);
});
test("a real solver builds a capped Classic set and Sim scorer cannot bypass legality",async()=>{
  const {pool,settings}=fixture();
  let scored=0;
  const result=await generateClassicPortfolio({pool,settings,count:20,baseConstraints:{},deadline:Date.now()+28000,solve,
    scoreCandidates:cs=>{scored=cs.length;return cs.map((c,i)=>c.totalProjectedPoints+i/100);}});
  assert.ok(scored>=20);assert.equal(result.lineups.length,20);assert.ok(result.report.classicLogic);
  for(let i=0;i<20;i++) {
    const l=result.lineups[i];
    assert.deepEqual(classicLineupErrors(l.lineup,settings,pool.filter(p=>p.position==="QB").map(p=>p.id)),[]);
    for(let j=0;j<i;j++) assert.ok(l.lineup.filter(p=>result.lineups[j].lineup.some(q=>q.id===p.id)).length<=6);
  }
  for(const p of pool) {
    const count=result.lineups.filter(l=>l.lineup.some(q=>q.id===p.id)).length;
    const cap=settings.classic!.anchors[String(p.id)]??CLASSIC_POSITION_CAPS[p.position];
    assert.ok(count<=Math.floor(cap*20/100));
  }
  assert.ok(result.lineups.filter(l=>classicArchitecture(l.lineup).full).length>=7);
  assert.ok(result.lineups.filter(l=>classicArchitecture(l.lineup).catchers>=2).length>=13);
  const official=pool.map(p=>({name:p.name,team:p.team,pos:p.position,flexId:String(p.id),flexSalary:p.salary,gameInfo:p.gameInfo!}));
  const entries=result.lineups.map((l,i)=>{
    const at=(pos:string)=>l.lineup.filter(p=>p.position===pos);
    const roster=[at("QB")[0],...at("RB"),...at("WR").slice(0,3),at("TE")[0],at("WR")[3],at("DST")[0]];
    const playerIds=roster.map(p=>String(p.id));
    return {entryId:String(i),cells:playerIds,playerIds};
  });
  const audit=auditClassicUpload({header:["QB","RB","RB","WR","WR","WR","TE","FLEX","DST"],slotIndices:[0,1,2,3,4,5,6,7,8],entries},official,[],settings.classic);
  assert.deepEqual(audit.unresolved,[]);
});
test("new importer rejects guessed matches and audit cannot use superseded caps",()=>{
  const {pool,classic}=fixture();
  assert.equal(parseClassicInputs(JSON.stringify(classic),pool,77).slateId,77);
  assert.throws(()=>parseClassicInputs(JSON.stringify(classic),pool,78),/different slate/);
  assert.match(classicInputHeaderCsv(),/StatusCheckedAt/);
  assert.throws(()=>auditClassicUpload({header:[],slotIndices:[],entries:[]},[],[]),/superseded/);
});
