// Read-only diagnostic: never saves generated lineups.
import { storage } from "../server/storage";
import { calculateOwnership } from "../server/ownership-engine";
import { buildAppClassicInputs } from "../server/nfl-classic-app-data";
import { generateClassicPortfolio } from "../server/nfl-classic-engine";
import { nflPortfolioSettingsSchema } from "../shared/nfl-portfolio";
import { solveLineup } from "../server/routes";
import assert from "node:assert/strict";
import solver from "javascript-lp-solver";
import { validateClassicEvidence, classicExposureBounds } from "../server/nfl-classic-readiness";
import { jointClassicSearch } from "../server/classic-joint-search";

async function main() {
  const slateId = Number(process.argv[2]);
  const count = Number(process.argv[3] || 5);
  const slates = await storage.getSlates();
  const slate = slates.find(s => s.id === slateId);
  if (!slate || slate.sport !== "NFL") throw new Error("Supply an existing NFL Classic slate ID.");
  const pool = await storage.getPlayersBySlate(slateId);
  const ownership = await calculateOwnership(pool, "NFL", "gpp_large");
  const own = new Map(ownership.map(p => [p.playerId, p.projectedOwnership]));
  const settings = nflPortfolioSettingsSchema.parse({ enabled: true, classic: buildAppClassicInputs(pool, slateId, own) });
  if (process.argv.includes("--capacity")) {
    const eligible = validateClassicEvidence(pool, settings.classic);
    const {maximum} = classicExposureBounds(eligible, settings, {});
    const model: any = {optimize:"points",opType:"max",constraints:{size:{equal:9*count},salary:{max:50000*count},QB:{equal:count},DST:{equal:count},RB:{min:2*count},WR:{min:3*count},TE:{min:count},own:{max:115*count}},variables:{}};
    for (const p of eligible) {
      model.variables[`p${p.id}`]={points:Number(p.projectedPoints),size:1,salary:p.salary,[p.position]:1,own:own.get(p.id),[`cap${p.id}`]:1};
      model.constraints[`cap${p.id}`]={max:Math.floor(maximum.get(p.id)!*count/100+1e-8)};
    }
    const result=solver.Solve(model);
    console.log(JSON.stringify({feasible:result.feasible,upperAverage:result.result/count}));
    return;
  }
  const deadline = Date.now() + 110000;
  if (process.argv.includes("--joint")) {
    const eligible=validateClassicEvidence(pool,settings.classic);
    const dst=eligible.filter(p=>p.position==="DST").sort((a,b)=>Number(b.projectedPoints)-Number(a.projectedPoints)).slice(0,6);
    const jointPool=eligible.filter(p=>p.position!=="DST"||dst.includes(p));
    const bounds=classicExposureBounds(jointPool,settings,{});
    const end=Date.now()+90000;
    const result=await jointClassicSearch({pool:jointPool,count:5,floor:136.53,...bounds,base:{},
      settings,ownership:own,deadline:end,solve:(ps,cs)=>solveLineup(ps,cs,"NFL",slate.platform,cs.ownershipMap,{deadline:end})});
    console.log("Joint returned",result?.length ?? 0);
    return;
  }
  const result = await generateClassicPortfolio({
    pool, settings, count, allowReducedCount: process.argv.includes("--sim"), deadline, baseConstraints: {},
    solve: (players, constraints) => solveLineup(players, constraints, "NFL", slate.platform, constraints.ownershipMap, { deadline, timeoutMs: 250 }),
  });
  const size=result.lineups.length;
  const bounds=classicExposureBounds(validateClassicEvidence(pool,settings.classic),settings,{});
  for(const [id,max] of bounds.maximum) {
    const uses=result.lineups.filter(l=>l.lineup.some(p=>p.id===id)).length;
    assert.ok(uses<=Math.floor(max*size/100+1e-8));
    assert.ok(uses>=Math.ceil(bounds.minimum.get(id)!*size/100-1e-8));
  }
  for(let i=0;i<size;i++) for(let j=0;j<i;j++)
    assert.ok(result.lineups[i].lineup.filter(p=>result.lineups[j].lineup.some(q=>q.id===p.id)).length<=6);
  console.log(JSON.stringify({ requested: count, generated: result.lineups.length, partial: result.report.partial, candidates: result.report.candidateCount }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
