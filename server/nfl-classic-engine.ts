import type { Player } from "@shared/schema";
import type { NflPortfolioSettings, NflPortfolioReport, NflPortfolioLineupPolicy } from "@shared/nfl-portfolio";
import { CLASSIC_OWNERSHIP_CAP, hasRole } from "@shared/nfl-classic-logic";
import { classicExposureBounds, classicPos, validateClassicEvidence } from "./nfl-classic-readiness";
import { stackGameKey } from "./sim-game-stacks";
import { solvePortfolioModelIsolated } from "./nfl-portfolio";
import { validatedIntegralResult } from "./solver-guard";
import { qualityFloor } from "./lineup-quality";

type Candidate = { lineup: Player[]; totalSalary: number; totalProjectedPoints: number; [key: string]: any };
export function classicArchitecture(lineup: Player[]) {
  const qb = lineup.find(p => classicPos(p) === "QB")!;
  if (!qb) return { catchers: 0, bringBack: false, secondary: false, full: false };
  const game = stackGameKey(qb.gameInfo);
  const catchers = lineup.filter(p => p.team === qb.team && ["WR", "TE"].includes(classicPos(p))).length;
  const bringBack = lineup.some(p => p.team !== qb.team && stackGameKey(p.gameInfo) === game && ["RB", "WR", "TE"].includes(classicPos(p)));
  const otherGames = new Map<string, number>();
  for (const p of lineup) if (["RB", "WR", "TE"].includes(classicPos(p)) && stackGameKey(p.gameInfo) !== game) {
    const key = stackGameKey(p.gameInfo);
    if (key) otherGames.set(key, (otherGames.get(key) || 0) + 1);
  }
  const secondary = Array.from(otherGames.values()).some(n => n >= 2);
  return { catchers, bringBack, secondary, full: catchers >= 2 && bringBack && secondary };
}
export function classicLineupErrors(lineup: Player[], s: NflPortfolioSettings, nakedQbIds: number[]): string[] {
  const c = s.classic!, errors: string[] = [];
  const counts = (pos: string) => lineup.filter(p => classicPos(p) === pos).length;
  if (lineup.length !== 9 || new Set(lineup.map(p => p.id)).size !== 9 ||
      counts("QB") !== 1 || counts("DST") !== 1 || counts("RB") < 2 || counts("WR") < 3 || counts("TE") < 1 ||
      counts("RB") + counts("WR") + counts("TE") !== 7) errors.push("Invalid Classic roster");
  if (lineup.reduce((sum, p) => sum + p.salary, 0) > 50000) errors.push("Salary exceeds $50,000");
  if (lineup.some(p => !c.players[String(p.id)])) return [...errors, "Missing player inputs"];
  if (lineup.reduce((sum, p) => sum + c.players[String(p.id)].ownership, 0) > CLASSIC_OWNERSHIP_CAP + 1e-8) errors.push("Ownership exceeds 115%");
  if (lineup.some(p => classicPos(p) !== "DST" && c.players[String(p.id)].projection < 4)) errors.push("Skill projection below 4");
  const qb = lineup.find(p => classicPos(p) === "QB");
  if (qb && !classicArchitecture(lineup).catchers && !nakedQbIds.includes(qb.id)) errors.push("Unverified naked QB");
  if (new Set(lineup.map(p => stackGameKey(p.gameInfo))).size < 2) errors.push("Needs at least two games");
  return errors;
}
export async function generateClassicPortfolio(options: {
  pool: Player[]; settings: NflPortfolioSettings; count: number; baseConstraints: any; deadline?: number;
  solve: (pool: Player[], constraints: any) => any;
  scoreCandidates?: (lineups: Candidate[]) => Promise<number[]> | number[];
}): Promise<{ lineups: Candidate[]; report: NflPortfolioReport }> {
  const { settings: s, count, baseConstraints: base } = options, c = s.classic!;
  if (count < 4) throw new Error("Classic position caps require a portfolio of at least four lineups. Use the Pro batch builder or set Sim quantity to four or more.");
  const deadline = options.deadline ?? Date.now() + 30_000;
  const locks: number[] = base.lockedPlayerIds || [], excluded: number[] = base.excludedPlayerIds || [];
  const raw = validateClassicEvidence(options.pool, c);
  const pool = raw.filter(p => !excluded.includes(p.id) && (classicPos(p) === "DST" || Number(p.projectedPoints) >= Math.max(4, base.minProjection || 0)));
  const { maximum, minimum, nakedQbIds } = classicExposureBounds(pool, s, base);
  if (locks.some(id => !pool.some(p => p.id === id))) throw new Error("A locked player is unavailable, excluded or below the Classic projection floor.");
  if (locks.some(id => (maximum.get(id) ?? 0) < 100)) throw new Error("A global lock forces 100% exposure and conflicts with Classic caps. Use an anchor/minimum instead.");
  const ownership = new Map(pool.map(p => [p.id, c.players[String(p.id)].ownership]));
  const originals = new Map(pool.map(p => [p.id, p]));
  const ranking = new Map(options.pool.map(p => [p.id, Number(p.projectedPoints)]));
  const defs = pool.filter(p => classicPos(p) === "DST").sort((a, b) => {
    const score = (p: Player) => {
      const e = c.players[String(p.id)];
      return (21 - e.opponentImpliedTotal!) * 2 + e.opponentSackRate! + e.opponentFumbleRate! + e.opponentIntRate! + e.projection;
    };
    return score(b) - score(a);
  });
  if (defs.length < 4) throw new Error("Classic needs at least four defenses that pass the opponent ≤21 implied-total screen and salary/turnover rules.");
  const defenses = defs.slice(0, 6);
  const leverageDst = defs.find(p => ownership.get(p.id)! < 10 && c.players[String(p.id)].eliteTurnoverMatchup);
  if (leverageDst && !defenses.includes(leverageDst)) defenses[defenses.length - 1] = leverageDst;
  for (const p of defenses.slice(0, 2)) minimum.set(p.id, Math.max(minimum.get(p.id) || 0, 25));
  if (leverageDst) minimum.set(leverageDst.id, Math.max(minimum.get(leverageDst.id) || 0, 10));
  const allowedDst = new Set(defenses.map(p => p.id));
  const eligible = pool.filter(p => classicPos(p) !== "DST" || allowedDst.has(p.id));
  for (const p of pool) if ((minimum.get(p.id) || 0) > 0 && !eligible.includes(p)) throw new Error(`${p.name}: minimum conflicts with the six-defense script pool.`);
  for (const p of eligible) if (Math.ceil(count * minimum.get(p.id)! / 100 - 1e-8) > Math.floor(count * maximum.get(p.id)! / 100 + 1e-8)) throw new Error(`${p.name}: rounded minimum exceeds maximum for ${count} lineups. Increase count or adjust the conflicting settings.`);
  const qbs = eligible.filter(p => classicPos(p) === "QB" && maximum.get(p.id)! > 0);
  if (count >= 150 && qbs.length < 12) throw new Error("The 150-lineup identity needs at least 12 eligible QBs. Expand the QB pool or request a smaller set.");
  let seed = s.seed >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const candidates: Candidate[] = [], seen = new Set<string>(), usage = new Map<number, number>();
  const maxCandidates = Math.min(1200, Math.max(120, count * 7));
  const generationDeadline = deadline - Math.min(8000, Math.max(2500, (deadline - Date.now()) * .35));
  const targetPlayers = eligible.filter(p => minimum.get(p.id)! > 0);
  for (let attempt = 0; attempt < Math.max(400, count * 25) && candidates.length < maxCandidates && Date.now() < generationDeadline; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
    const qb = qbs[attempt % qbs.length];
    if (!qb) break;
    const phase = (attempt * 37) % 100;
    const full = phase < c.fullArchitecturePct;
    const double = full || phase < c.doubleStackPct;
    const naked = !double && phase >= 100 - c.nakedPct && nakedQbIds.includes(qb.id);
    const back = full || (!naked && random() * 100 < (c.bringBackPct - c.fullArchitecturePct) / (100 - c.fullArchitecturePct) * 100);
    const policy: NflPortfolioLineupPolicy = {
      catcherCount: naked ? 0 : double ? 2 : 1, bringBack: back, nakedQbIds,
      rbMinSalary: 0, exemptLockedRbIds: [], minLowOwnedPlayers: 0, lowOwnershipThreshold: 10,
      stackGameKeys: base.stackGameKeys || [], classicOwnershipCap: 115,
    };
    const attemptLocks = [qb.id];
    if (targetPlayers.length && attempt % 3 === 0) {
      const targets = targetPlayers.filter(p => classicPos(p) !== "QB" && (!naked || p.team !== qb.team));
      const forced = targets.sort((a, b) => (usage.get(a.id) || 0) / Math.max(1, minimum.get(a.id)!) - (usage.get(b.id) || 0) / Math.max(1, minimum.get(b.id)!))[0];
      if (forced) attemptLocks.push(forced.id);
    }
    if (full) {
      const other = eligible.filter(p => ["RB", "WR", "TE"].includes(classicPos(p)) && stackGameKey(p.gameInfo) !== stackGameKey(qb.gameInfo));
      const a = other[Math.floor(random() * other.length)];
      const alternatives = a && other.filter(p => p.id !== a.id && stackGameKey(p.gameInfo) === stackGameKey(a.gameInfo));
      if (!a || !alternatives?.length) continue;
      attemptLocks.push(a.id, alternatives[Math.floor(random() * alternatives.length)].id);
    }
    const pressured = eligible.filter(p => !attemptLocks.includes(p.id) && candidates.length > 10 &&
      (usage.get(p.id) || 0) / candidates.length * 100 > maximum.get(p.id)!);
    const excludedAttempt = [...excluded, ...pressured.filter(() => random() < .45).map(p => p.id)];
    const jittered = eligible.filter(p => classicPos(p) !== "QB" || p.id === qb.id).map(p => {
      const catcher = p.team === qb.team && ["WR", "TE"].includes(classicPos(p));
      const runback = p.team !== qb.team && stackGameKey(p.gameInfo) === stackGameKey(qb.gameInfo) && ["RB", "WR", "TE"].includes(classicPos(p));
      const score = (ranking.get(p.id) ?? Number(p.projectedPoints)) * (catcher ? 1.22 : runback ? 1.07 : 1) * (.7 + random() * .6);
      return { ...p, projectedPoints: String(score) };
    });
    const solved = await options.solve(jittered, {
      ...base, minProjection: undefined, projectedPointsFloor: undefined, deterministicObjective: true,
      lockedPlayerIds: Array.from(new Set([...locks, ...attemptLocks])), excludedPlayerIds: excludedAttempt,
      nflPortfolio: s, nflPortfolioLineupPolicy: policy, ownershipMap: ownership,
    });
    if (!solved?.lineup?.length || solved.error) continue;
    const lineup: Player[] = solved.lineup.map((p: Player) => originals.get(p.id)).filter(Boolean);
    if (classicLineupErrors(lineup, s, nakedQbIds).length) continue;
    if (full && !classicArchitecture(lineup).full) continue;
    const key = lineup.map(p => p.id).sort((a,b) => a-b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...solved, lineup, totalSalary: lineup.reduce((n,p)=>n+p.salary,0), totalProjectedPoints: lineup.reduce((n,p)=>n+Number(p.projectedPoints),0) });
    for (const p of lineup) usage.set(p.id, (usage.get(p.id) || 0) + 1);
  }
  if (candidates.length < count) throw new Error(`Classic search produced ${candidates.length} candidates for ${count} requested lineups. No saved changes; broaden eligible inputs or adjust conflicting controls.`);
  const floor = qualityFloor(Math.max(...candidates.map(l=>l.totalProjectedPoints)), base.projectedPointsFloor);
  const qualified = candidates.filter(l=>l.totalProjectedPoints >= floor);
  if (qualified.length < count) throw new Error("Insufficient high-quality candidates under the Classic rules. The projection floor will not be lowered to fill the set.");
  const scores = options.scoreCandidates ? await options.scoreCandidates(qualified) : qualified.map(l=>l.totalProjectedPoints);
  if (scores.length !== qualified.length || scores.some(v=>!Number.isFinite(v))) throw new Error("The selected Sim scoring mode failed; no unadjusted fallback was used.");
  const model: any = { optimize: "score", opType: "max", constraints: { count: { equal: count } }, variables: {}, ints: {} };
  for (const p of eligible) model.constraints[`ex_${p.id}`] = {
    min: Math.ceil(minimum.get(p.id)! * count / 100 - 1e-8),
    max: Math.floor(maximum.get(p.id)! * count / 100 + 1e-8),
  };
  const doubleCount = Math.round(c.doubleStackPct / 100 * count);
  const backCount = Math.round(c.bringBackPct / 100 * count);
  model.constraints.double = { min: doubleCount, max: Math.min(count, doubleCount + 1) };
  model.constraints.back = { min: Math.max(1, backCount - 1), max: Math.min(count - 1, backCount + 1) };
  model.constraints.full = { min: Math.round(c.fullArchitecturePct / 100 * count) };
  model.constraints.naked = { max: Math.floor(c.nakedPct / 100 * count) };
  // Portfolio barbell targets are preferences, never a reason to admit a roleless punt.
  for (const [key, target] of [["punts", 1.6], ["chalk", 2.1]] as const) {
    model.constraints[key] = { equal: target * count };
    model.variables[`${key}_under`] = { [key]: 1, score: -2 };
    model.variables[`${key}_over`] = { [key]: -1, score: -2 };
  }
  for (const qb of qbs) model.constraints[`naked_${qb.id}`] = { max: 0 };
  qualified.forEach((l, i) => {
    const shape = classicArchitecture(l.lineup), qb = l.lineup.find(p=>classicPos(p)==="QB")!;
    const v: any = { score: scores[i], count: 1, double: Number(shape.catchers >= 2), back: Number(shape.bringBack), full: Number(shape.full), naked: Number(shape.catchers === 0), [`naked_${qb.id}`]: Number(shape.catchers === 0) - .14 };
    v.punts = l.lineup.filter(p=>c.players[String(p.id)].punt && hasRole(c.players[String(p.id)])).length;
    v.chalk = l.lineup.filter(p=>c.players[String(p.id)].chalk).length;
    for (const p of l.lineup) v[`ex_${p.id}`] = 1;
    const key = `l${i}`;
    model.variables[key] = v; model.ints[key] = 1;
    model.constraints[`one_${i}`] = { max: 1 }; v[`one_${i}`] = 1;
  });
  // Hard three-player difference for every selected pair, including Sim-ranked sets.
  for (let i = 0; i < qualified.length; i++) {
    const ids = new Set(qualified[i].lineup.map(p=>p.id));
    for (let j = 0; j < i; j++) if (qualified[j].lineup.filter(p=>ids.has(p.id)).length > 6) {
      const key = `different_${i}_${j}`;
      model.constraints[key] = { max: 1 }; model.variables[`l${i}`][key] = 1; model.variables[`l${j}`][key] = 1;
    }
  }
  if (count >= 150) {
    model.constraints.qbRoom = { min: 12, max: 19 };
    for (const qb of qbs) {
      const key = `useQb${qb.id}`, link = `linkQb${qb.id}`, used = `usedQb${qb.id}`;
      model.variables[key] = { qbRoom: 1, [link]: -count, [used]: -1, [`boundQb${qb.id}`]: 1 };
      model.ints[key] = 1; model.constraints[`boundQb${qb.id}`] = { max: 1 };
      model.constraints[link] = { max: 0 }; model.constraints[used] = { min: 0 };
      qualified.forEach((l,i)=> { if (l.lineup.some(p=>p.id===qb.id)) { model.variables[`l${i}`][link]=1; model.variables[`l${i}`][used]=1; } });
    }
  }
  const budget = deadline - Date.now();
  if (budget <= 100) throw new Error("Classic candidate search exhausted the request budget before final selection. No changes were saved.");
  const solved = await solvePortfolioModelIsolated(model, budget);
  const valid = validatedIntegralResult(solved.result, model);
  if (!valid) throw new Error(`Classic portfolio ${solved.timedOut ? "selection timed out" : "could not satisfy all caps, architecture and uniqueness constraints"}. No rules were relaxed and no lineups saved.`);
  const lineups = qualified.filter((_,i)=>valid[`l${i}`]>.5).sort((a,b)=>b.totalProjectedPoints-a.totalProjectedPoints);
  if (lineups.length !== count || lineups.some(l=>classicLineupErrors(l.lineup,s,nakedQbIds).length)) throw new Error("Final Classic audit failed; no lineups saved.");
  const warnings = [
    "Uses DFS Army inputs. Sim controls rank eligible candidates; hard Classic rules remain enforced.",
    "Final injury/inactive and weather review plus explicit approval are required before uploading. Weather is not an automatic veto.",
    "Anchor shares explicitly override position caps; a top-defense matchup trims the anchor toward 30%.",
  ];
  const metrics: NflPortfolioReport["metrics"] = [];
  const metric = (key:string,label:string,target:number,achieved:number,unit:"percent"|"lineups", detail?:string) =>
    metrics.push({key,label,target,achieved,unit,status:Math.abs(target-achieved)<=1?"met":"info",detail});
  metric("double","Double stacks",doubleCount,lineups.filter(l=>classicArchitecture(l.lineup).catchers>=2).length,"lineups");
  metric("full","Full architecture",Math.round(c.fullArchitecturePct/100*count),lineups.filter(l=>classicArchitecture(l.lineup).full).length,"lineups");
  metric("back","Conditional bring-backs",backCount,lineups.filter(l=>classicArchitecture(l.lineup).bringBack).length,"lineups");
  metric("punt","Role-verified punts per 100 lineups",160,lineups.reduce((n,l)=>n+l.lineup.filter(p=>c.players[String(p.id)].punt && hasRole(c.players[String(p.id)])).length,0)/count*100,"percent");
  metric("chalk","Chalk pieces per 100 lineups",210,lineups.reduce((n,l)=>n+l.lineup.filter(p=>c.players[String(p.id)].chalk).length,0)/count*100,"percent");
  for (const p of eligible) {
    const n = lineups.filter(l=>l.lineup.some(q=>q.id===p.id)).length;
    if (n || minimum.get(p.id)) metric(`ex_${p.id}`,`${p.name} exposure`, maximum.get(p.id)!, n/count*100,"percent",`minimum ${minimum.get(p.id)}%; ${n}/${count}${c.players[String(p.id)].topDefense ? "; tough-defense concentration trimmed" : ""}`);
    if (c.players[String(p.id)].topDefense && (c.anchors[String(p.id)] || 0) > 30) {
      const alternatives = eligible.filter(q=>q.id!==p.id && classicPos(q)===classicPos(p) && !c.players[String(q.id)].topDefense && hasRole(c.players[String(q.id)]))
        .sort((a,b)=>Number(b.projectedPoints)-Number(a.projectedPoints)).slice(0,3);
      warnings.push(`${p.name}: top-defense risk trimmed to 30%; named alternatives: ${alternatives.map(q=>q.name).join(", ") || "none verified in this pool"}.`);
    }
  }
  for (const [i,l] of Array.from(lineups.slice(0,5).entries())) {
    const flexPosition = ["RB","WR","TE"].find(pos=>l.lineup.filter(p=>classicPos(p)===pos).length > ({RB:2,WR:3,TE:1}[pos]!));
    const choices = l.lineup.filter(p=>classicPos(p)===flexPosition).sort((a,b)=>(c.players[String(b.id)].ceiling??0)-(c.players[String(a.id)].ceiling??0));
    warnings.push(`Flagship ${i+1}: review FLEX candidates ${choices.map(p=>`${p.name}${c.players[String(p.id)].ceiling == null ? " (ceiling missing)" : ` (ceiling ${c.players[String(p.id)].ceiling})`}`).join(", ")} before entry.`);
  }
  return {lineups,report:{classicLogic:true,requestedCount:count,generatedCount:count,candidateCount:qualified.length,seed:s.seed,metrics,warnings,partial:false,
    dataSources:{ownership:"provided",vegas:"unavailable",rushing:"manual"},selectionStatus:"full"}};
}
