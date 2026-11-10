import type { Player } from "@shared/schema";
import { stackGameKey } from "./sim-game-stacks";
import { solveClassicModel as solvePortfolioModelIsolated } from "./classic-mip-solver";
import { validatedIntegralResult } from "./solver-guard";

/** Joint roster search for disjoint small batches. Unlike candidate selection,
 * this can choose any eligible player in every roster simultaneously. */
export async function jointClassicSearch(o: {
  pool: Player[]; count: number; floor: number; maximum: Map<number, number>; minimum: Map<number, number>;
  base: any; settings: any; ownership: Map<number, number>; deadline: number;
  solve: (pool: Player[], constraints: any) => any;
}): Promise<Player[][] | undefined> {
  const {pool,count,settings:s}=o, c=s.classic;
  if (count > 5 || pool.some(p=>Math.floor(o.maximum.get(p.id)!*count/100+1e-8)>1)) return;
  const model:any={optimize:"jointScore",opType:"max",constraints:{},variables:{},ints:{}};
  const double=Math.round(c.doubleStackPct/100*count), full=Math.round(c.fullArchitecturePct/100*count);
  const back=Math.max(full,Math.round(c.bringBackPct/100*count));
  const games=Array.from(new Set(pool.map(p=>stackGameKey(p.gameInfo)).filter(Boolean)));
  for(let slot=0;slot<count;slot++){
    let roster:any;
    await o.solve(pool,{lockedPlayerIds:[],excludedPlayerIds:[],...o.base, contestType:"gpp", deterministicObjective:true, minProjection:undefined,
      projectedPointsFloor:o.floor, nflPortfolio:s,ownershipMap:o.ownership,
      nflPortfolioLineupPolicy:{catcherCount:slot<double?2:1,bringBack:slot<back,nakedQbIds:[],
        rbMinSalary:0,exemptLockedRbIds:[],minLowOwnedPlayers:0,lowOwnershipThreshold:10,
        stackGameKeys:o.base.stackGameKeys||[],classicOwnershipCap:115},
      captureModel:(value:any)=>{roster=value;}});
    if(!roster) return;
    const prefix=`r${slot}_`;
    for(const [key,value] of Object.entries(roster.constraints)) model.constraints[prefix+key]=value;
    for(const [name,raw] of Object.entries(roster.variables)){
      const v:any={jointScore:0};
      for(const [key,value] of Object.entries(raw as any)) if(key in roster.constraints) v[prefix+key]=value;
      model.variables[prefix+name]=v;
      if(roster.ints[name]) model.ints[prefix+name]=1;
    }
    for(const p of pool){
      const v=model.variables[`${prefix}p${p.id}`];
      if(v) v[`ex${p.id}`]=1;
    }
    if(slot<full){
      model.constraints[prefix+"secondary"]={min:1};
      games.forEach((game,g)=>{
        const key=prefix+"secondary"+g;
        model.variables[key]={[prefix+"secondary"]:1,[key+"bound"]:1,[key+"skill"]:-2,[key+"outside"]:1,jointScore:0};
        model.ints[key]=1;
        model.constraints[key+"bound"]={max:1};
        model.constraints[key+"skill"]={min:0};
        model.constraints[key+"outside"]={max:1};
        for(const p of pool.filter(p=>stackGameKey(p.gameInfo)===game)){
          const v=model.variables[`${prefix}p${p.id}`];
          if(!v) continue;
          if(p.position==="QB") v[key+"outside"]=1;
          if(["RB","WR","TE"].includes(p.position)) v[key+"skill"]=1;
        }
      });
    }
  }
  for(const p of pool) model.constraints[`ex${p.id}`]={
    min:Math.ceil(o.minimum.get(p.id)!*count/100-1e-8),max:Math.floor(o.maximum.get(p.id)!*count/100+1e-8)};
  const solved=await solvePortfolioModelIsolated(model,Math.max(1,o.deadline-Date.now()));
  const result=validatedIntegralResult(solved.result,model);
  if(!result) return;
  return Array.from({length:count},(_,i)=>pool.filter(p=>result[`r${i}_p${p.id}`]>.5));
}
