import type { Player } from "@shared/schema";
import { OWNERSHIP_TARGETS, type NflPortfolioSettings, type NflPortfolioReport, type NflPortfolioLineupPolicy } from "@shared/nfl-portfolio";
import { parseGameInfo } from "@shared/game-info";
import { stackGameKey } from "./sim-game-stacks";
import solver from "javascript-lp-solver";

const pos = (p: Player, positions: string[]) => p.position.toUpperCase().split("/").some(x => positions.includes(x.trim()));
const team = (p: Player) => p.team.trim().toUpperCase();
export const qbSalaryBin = (salary: number): "punt" | "value" | "mid" | "premium" =>
  salary < 5000 ? "punt" : salary < 6000 ? "value" : salary < 7000 ? "mid" : "premium";

/** Largest remainder, with stable ties; counts always sum to the requested size. */
export function planNflMix(mix: Record<string, number>, count: number): Record<string, number> {
  const entries = Object.entries(mix).map(([key, pct], i) => ({ key, n: Math.floor(count * pct / 100), rem: count * pct / 100 % 1, i }));
  let left = count - entries.reduce((n, x) => n + x.n, 0);
  for (const x of [...entries].sort((a, b) => b.rem - a.rem || a.i - b.i)) if (left-- > 0) x.n++;
  return Object.fromEntries(entries.map(x => [x.key, x.n]));
}

/** Additive constraints: never deletes a caller's locks, favorite players, or bounds. */
export function addNflPortfolioConstraints(model: any, pool: Player[], policy: NflPortfolioLineupPolicy, ownershipMap?: Map<number, number>): void {
  const available = pool.filter(p => model.variables[`p${p.id}`]);
  const forbid = (p: Player) => {
    const key = `nfl_portfolio_forbid_${p.id}`;
    model.constraints[key] = { equal: 0 };
    model.variables[`p${p.id}`][key] = 1;
  };
  const M = available.length + 1;
  for (const qb of available.filter(p => pos(p, ["QB"]))) {
    if ((policy.catcherCount === 0 && !policy.nakedQbIds.includes(qb.id)) ||
      (policy.stackGameKeys.length && !policy.stackGameKeys.includes(stackGameKey(qb.gameInfo)))) forbid(qb);
    const catchers = available.filter(p => team(p) === team(qb) && pos(p, ["WR", "TE"]));
    const key = stackGameKey(qb.gameInfo);
    const backs = available.filter(p => key && stackGameKey(p.gameInfo) === key && team(p) !== team(qb) && pos(p, ["RB", "WR", "TE"]));
    const conditional = (name: string, players: Player[], n: number, exact: boolean) => {
      model.constraints[`${name}_min`] = { min: n - M };
      model.variables[`p${qb.id}`][`${name}_min`] = -M;
      for (const p of players) model.variables[`p${p.id}`][`${name}_min`] = 1;
      if (exact) {
        model.constraints[`${name}_max`] = { max: n + M };
        model.variables[`p${qb.id}`][`${name}_max`] = M;
        for (const p of players) model.variables[`p${p.id}`][`${name}_max`] = 1;
      }
    };
    conditional(`nfl_portfolio_catch_${qb.id}`, catchers, policy.catcherCount, true);
    if (policy.catcherCount === 0) conditional(`nfl_portfolio_naked_${qb.id}`, available.filter(p => p.id !== qb.id && team(p) === team(qb)), 0, true);
    conditional(`nfl_portfolio_back_${qb.id}`, backs, Number(policy.bringBack), !policy.bringBack);
  }
  for (const p of available) if (pos(p, ["RB"]) && p.salary < policy.rbMinSalary && !policy.exemptLockedRbIds.includes(p.id)) forbid(p);
  if (policy.minLowOwnedPlayers > 0) {
    if (!ownershipMap || available.some(p => !Number.isFinite(ownershipMap.get(p.id)))) throw new Error("NFL portfolio requires complete ownership data for eligible players.");
    model.constraints.nfl_portfolio_low_owned = { min: policy.minLowOwnedPlayers };
    for (const p of available) if (ownershipMap.get(p.id)! < policy.lowOwnershipThreshold) model.variables[`p${p.id}`].nfl_portfolio_low_owned = 1;
  }
}

export function classifyNflLineup(lineup: Player[]) {
  const qb = lineup.find(p => pos(p, ["QB"]));
  const key = qb ? stackGameKey(qb.gameInfo) : "";
  const catchers = qb ? lineup.filter(p => team(p) === team(qb) && pos(p, ["WR", "TE"])).length : -1;
  const games = Array.from(new Set(lineup.map(p => stackGameKey(p.gameInfo)).filter(Boolean)));
  const flex = lineup.filter(p => pos(p, ["RB"])).length > 2 ? "RB" : lineup.filter(p => pos(p, ["WR"])).length > 3 ? "WR" : "TE";
  let secondaryQuality = 0;
  for (const g of games.filter(g => g !== key)) {
    const skills = lineup.filter(p => stackGameKey(p.gameInfo) === g && pos(p, ["RB", "WR", "TE"]));
    for (const rb of skills.filter(p => pos(p, ["RB"]))) {
      if (skills.some(p => p.id !== rb.id && pos(p, ["WR"]))) secondaryQuality = 2;
      else if (skills.some(p => p.id !== rb.id && pos(p, ["TE"]) && team(p) === team(rb))) secondaryQuality = Math.max(secondaryQuality, 1);
    }
    if (new Set(skills.map(team)).size >= 2) secondaryQuality = Math.max(secondaryQuality, 1);
  }
  const naked = !!qb && !lineup.some(p => p.id !== qb.id && team(p) === team(qb));
  return { qb, catchers, naked, stack: catchers === 0 ? (naked ? "naked" : "qbPlusTeammate") : ["naked", "single", "double", "triple"][catchers], bringBack: !!qb && lineup.some(p => key && stackGameKey(p.gameInfo) === key && team(p) !== team(qb) && pos(p, ["RB", "WR", "TE"])), games: games.length, flex, secondary: secondaryQuality > 0, secondaryQuality, qbSalary: qbSalaryBin(qb?.salary || 0) };
}

export async function generateNflPortfolio(options: {
  pool: Player[]; settings: NflPortfolioSettings; count: number; baseConstraints: any;
  ownershipMap?: Map<number, number>;
  /** Required to trust external map values in provided mode. Overrides are always provided. */
  ownershipProvenance?: "estimated" | "provided";
  vegasGames?: Array<{ gameKey: string; homeTeam: string; awayTeam: string; total: number; homeImplied: number; awayImplied: number }>;
  deadline?: number; solve: (pool: Player[], constraints: any) => any;
  scoreCandidates?: (lineups: any[]) => Promise<number[]> | number[];
}): Promise<{ lineups: any[]; report: NflPortfolioReport }> {
  const { settings: s, count, baseConstraints: base } = options;
  if (!Number.isInteger(count) || count < 1) throw new Error("NFL portfolio count must be a positive integer.");
  const locks: number[] = base.lockedPlayerIds || [];
  const excluded: number[] = base.excludedPlayerIds || [];
  if (locks.some(id => excluded.includes(id))) throw new Error("NFL portfolio has a player both locked and excluded.");
  const floor = Math.max(0, Number(base.minProjection || 0));
  if (options.pool.some(p => locks.includes(p.id) && Number(p.projectedPoints || p.fppg || 0) < floor)) throw new Error("Locked player violates the deterministic projection floor.");
  const pool = options.pool.filter(p => !excluded.includes(p.id) && Number(p.projectedPoints || p.fppg || 0) >= floor);
  if (locks.some(id => !pool.some(p => p.id === id))) throw new Error("NFL portfolio locked player is unavailable.");
  const eligible = pool.filter(p => !(pos(p, ["RB"]) && p.salary < s.rbMinSalary && !(s.allowLockedCheapRb && locks.includes(p.id))));
  if (locks.some(id => !eligible.some(p => p.id === id))) throw new Error("Locked RB violates the RB salary floor; explicitly enable the locked-cheap-RB exemption.");
  const maximum = (id: number) => Math.min(base.globalMaxExposure ?? 100, base.exposureLimits?.[id] ?? 100);
  const minimum = (id: number) => base.minExposureLimits?.[id] ?? base.globalMinExposure ?? 0;
  for (const id of locks) if (maximum(id) < 100) throw new Error(`Infeasible hard exposure requirements: locked player ${id} must appear in 100%, above its ${maximum(id)}% maximum.`);
  for (const id of Array.from(new Set([...eligible.map(p => p.id), ...Object.keys(base.minExposureLimits || {}).map(Number)]))) {
    if (minimum(id) > maximum(id) || (minimum(id) > 0 && !eligible.some(p => p.id === id))) throw new Error(`Infeasible minimum and maximum exposures for player ${id}: minimum exceeds maximum or player is unavailable.`);
  }
  let ownership: Map<number, number> | undefined;
  const warnings: string[] = [];
  if (s.ownershipMode !== "off") {
    ownership = new Map(s.ownershipMode === "provided" && options.ownershipProvenance !== "provided" ? [] : options.ownershipMap || []);
    for (const [id, value] of Object.entries(s.ownershipOverrides)) ownership.set(Number(id), value);
    if (eligible.some(p => !Number.isFinite(ownership!.get(p.id)) || ownership!.get(p.id)! < 0 || ownership!.get(p.id)! > 100)) {
      throw new Error(`NFL portfolio ${s.ownershipMode} ownership is incomplete for the eligible pool; provide all values or turn ownership off.`);
    }
    if (s.ownershipMode === "estimated") warnings.push("Ownership values are model estimates, not verified ownership.");
  } else warnings.push("Ownership is off; low-owned minimum and ownership-sum targets are inactive.");
  const gamesAvailable = new Set(eligible.map(p => stackGameKey(p.gameInfo)).filter(Boolean)).size;
  const minGames = Math.min(s.minGames, gamesAvailable);
  if (minGames < s.minGames) warnings.push(`Game-diversity soft minimum adapted from ${s.minGames} to ${minGames} for this slate.`);
  if (!s.nakedQbIds.length && s.stackMix.naked > 0) warnings.push("Naked-QB target unavailable: no manually eligible quarterback IDs were supplied.");
  if (!options.vegasGames?.length) warnings.push("Verified Vegas data unavailable; home-favorite DST and game-total preferences cannot be verified.");
  const stackPlan = planNflMix(s.stackMix, count);
  const schedule: string[] = [];
  const remaining = { ...stackPlan };
  while (schedule.length < count) for (const k of Object.keys(remaining)) if (remaining[k] > 0) { schedule.push(k); remaining[k]--; }
  const allowedFlex: string[] = base.flexAllowedPositions || ["RB", "WR", "TE"];
  const flexWeight = Object.entries(s.flexMix).reduce((n, [k, v]) => n + (allowedFlex.includes(k) ? v : 0), 0);
  const flexMix = Object.fromEntries(Object.entries(s.flexMix).map(([k, v]) => [k, allowedFlex.includes(k) ? (flexWeight ? v / flexWeight * 100 : 100 / allowedFlex.length) : 0]));
  if (allowedFlex.length < 3) warnings.push("FLEX targets renormalized over hard allowed FLEX positions; forbidden positions have zero target.");
  const start = Date.now();
  const deadline = options.deadline ?? start + 30000;
  const candidateDeadline = deadline - Math.min(5000, Math.max(500, (deadline - start) * 0.25));
  const candidates: any[] = [];
  const seen = new Set<string>();
  const usage = new Map<number, number>();
  const minTargets = eligible.filter(p => minimum(p.id) > 0 && !locks.includes(p.id));
  let minTargetTurn = 0;
  let budgetReached = false;
  let state = s.seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const original = new Map(pool.map(p => [p.id, p]));
  const maxAttempts = Math.min(1500, Math.max(48, count * 12));
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() >= candidateDeadline) { budgetReached = true; warnings.push("Candidate solve budget reached; reserved time for scoring and hard-exposure selection."); break; }
    // Let HTTP requests and timers run between bounded synchronous solves.
    await new Promise<void>(resolve => setImmediate(resolve));
    // Try planned structures first, then all feasible structures for attainable partial portfolios.
    const stack = attempt % 2 === 0 ? schedule[Math.floor(attempt / 2) % count] : ["single", "double", "triple", "naked"][Math.floor(attempt / 2) % 4];
    const catcherCount = ["naked", "single", "double", "triple"].indexOf(stack) as 0 | 1 | 2 | 3;
    if (!catcherCount && !s.nakedQbIds.length) continue;
    const policy: NflPortfolioLineupPolicy = {
      catcherCount, bringBack: random() * 100 < s.bringBackPct,
      nakedQbIds: s.nakedQbIds, rbMinSalary: s.rbMinSalary,
      exemptLockedRbIds: s.allowLockedCheapRb ? locks : [],
      minLowOwnedPlayers: ownership ? s.minLowOwnedPlayers : 0,
      lowOwnershipThreshold: s.lowOwnershipThreshold, stackGameKeys: base.stackGameKeys || [],
    };
    // Seed low-projection minimum-exposure players, rather than hoping jitter selects them.
    // One additional lock per solve limits incompatible temporary structures.
    const deficitTargets = minTargets.filter(p => (usage.get(p.id) || 0) < Math.max(1, Math.ceil((candidates.length + 1) * minimum(p.id) / 100)));
    const forced = deficitTargets.length ? deficitTargets[minTargetTurn++ % deficitTargets.length] : undefined;
    const attemptLocks = Array.from(new Set([...locks, ...(forced ? [forced.id] : [])]));
    const alwaysExcluded = eligible.filter(p => maximum(p.id) <= 0).map(p => p.id);
    // Retain baseline attempts, but actively omit heavily reused players on most solves.
    // Exclusions are temporary candidate-search decisions, not relaxed caller rules.
    const pressured = candidates.length && attempt % 4 !== 0
      ? eligible.filter(p => !attemptLocks.includes(p.id) && maximum(p.id) < 100 &&
          (usage.get(p.id) || 0) / candidates.length >= maximum(p.id) / 100)
        .sort((a, b) => ((usage.get(b.id) || 0) / candidates.length - maximum(b.id) / 100) -
          ((usage.get(a.id) || 0) / candidates.length - maximum(a.id) / 100) || a.id - b.id)
      : [];
    const attemptExcluded = Array.from(new Set([...excluded, ...alwaysExcluded, ...pressured.slice(0, 3).map(p => p.id)]));
    const jittered = eligible.map(p => ({ ...p, projectedPoints: String(Number(p.projectedPoints || p.fppg || 0) * (0.8 + random() * 0.4)) }));
    const constraints = { ...base, minProjection: undefined, lockedPlayerIds: attemptLocks, excludedPlayerIds: attemptExcluded, nflPortfolio: s, nflPortfolioLineupPolicy: policy, ownershipMap: ownership };
    let result: any;
    try { result = await options.solve(jittered.filter(p => !attemptExcluded.includes(p.id)), constraints); } catch (error) { lastError = String(error); continue; }
    if (!result?.lineup?.length || result.error) { lastError = result?.error || "No feasible candidate"; continue; }
    const lineup: Player[] = result.lineup.map((p: Player) => original.get(p.id)).filter(Boolean);
    const ids = lineup.map(p => p.id);
    const info = classifyNflLineup(lineup);
    const salary = lineup.reduce((n, p) => n + p.salary, 0);
    const projection = lineup.reduce((n, p) => n + Number(p.projectedPoints || p.fppg || 0), 0);
    const positionCounts = ["QB", "RB", "WR", "TE", "DST"].map(position => lineup.filter(p => pos(p, [position])).length);
    const [qbs, rbs, wrs, tes, dsts] = positionCounts;
    const alternatives = base.stackAlternatives || [];
    const satisfiesFavorite = !alternatives.length || alternatives.some((alt: any) => alt.kind === "players"
      ? (alt.playerIds || []).every((id: number) => ids.includes(id))
      : info.qb && stackGameKey(info.qb.gameInfo) === alt.gameKey);
    if (qbs !== 1 || dsts !== 1 || rbs < 2 || rbs > 3 || wrs < 3 || wrs > 4 || tes < 1 || tes > 2 ||
      !allowedFlex.includes(info.flex) || !satisfiesFavorite ||
      salary > Math.min(base.maxSalary ?? 50000, base.totalMaxSalary ?? 50000) || salary < Math.max(base.minSalary ?? 0, base.totalMinSalary ?? 0) ||
      projection < (base.projectedPointsFloor ?? 0) ||
      lineup.some(p => (base.playerMinSalary && !pos(p, ["DST", "DEF"]) && p.salary < base.playerMinSalary && !locks.includes(p.id)) || (base.playerMaxSalary && p.salary > base.playerMaxSalary && !locks.includes(p.id)))) continue;
    // Validate policy even if a custom solve callback did not apply the LP helper.
    if (lineup.length !== 9 || new Set(ids).size !== 9 || attemptLocks.some(id => !ids.includes(id)) || ids.some(id => attemptExcluded.includes(id)) ||
      !info.qb || info.catchers !== catcherCount || info.bringBack !== policy.bringBack ||
      (!catcherCount && (!s.nakedQbIds.includes(info.qb.id) || !info.naked)) ||
      (policy.stackGameKeys.length && !policy.stackGameKeys.includes(stackGameKey(info.qb.gameInfo))) ||
      lineup.some(p => pos(p, ["RB"]) && p.salary < s.rbMinSalary && !policy.exemptLockedRbIds.includes(p.id)) ||
      (ownership && lineup.filter(p => ownership!.get(p.id)! < s.lowOwnershipThreshold).length < s.minLowOwnedPlayers)) continue;
    const signature = [...ids].sort((a, b) => a - b).join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push({ ...result, lineup, totalSalary: lineup.reduce((n, p) => n + p.salary, 0), totalProjectedPoints: lineup.reduce((n, p) => n + Number(p.projectedPoints || p.fppg || 0), 0) });
    for (const id of ids) usage.set(id, (usage.get(id) || 0) + 1);
  }
  if (!candidates.length) throw new Error(`No NFL portfolio lineup found within the ${budgetReached ? "time" : "candidate search"} budget; this does not prove infeasibility. ${lastError || "Check locks, RB salary floor, ownership, naked eligibility and stack alternatives."}`);
  const scores = options.scoreCandidates ? await options.scoreCandidates(candidates) : candidates.map(x => x.totalProjectedPoints);
  if (scores.length !== candidates.length || scores.some(x => !Number.isFinite(x))) throw new Error("NFL portfolio scoring callback returned invalid scores.");
  const infos = candidates.map(x => classifyNflLineup(x.lineup));
  const scoreMin = Math.min(...scores), scoreRange = Math.max(...scores) - scoreMin || 1;
  // Select the entire batch as an integer program, not a greedy exposure approximation.
  let selected: number[] = [];
  for (let size = Math.min(count, candidates.length); size >= 1; size--) {
    if (options.deadline && Date.now() >= options.deadline && size !== Math.min(count, candidates.length)) break;
    const model: any = { optimize: "utility", opType: "max", constraints: { size: { equal: size } }, variables: {}, ints: {}, timeout: Math.min(2000, Math.max(1, (options.deadline || Date.now() + 2000) - Date.now())) };
    const targets: Record<string, number> = {};
    for (const [k, n] of Object.entries(planNflMix(s.stackMix, size))) targets[`stack_${k}`] = n;
    for (const [k, n] of Object.entries(planNflMix(flexMix, size))) targets[`flex_${k}`] = n;
    for (const [k, n] of Object.entries(planNflMix(s.qbSalaryMix, size))) targets[`qb_${k}`] = n;
    targets.bringBack = Math.round(size * s.bringBackPct / 100);
    targets.secondary = Math.round(size * s.secondaryStackPct / 100);
    for (const [key, target] of Object.entries(targets)) {
      model.constraints[key] = { equal: target };
      model.variables[`under_${key}`] = { [key]: 1, utility: -20 };
      model.variables[`over_${key}`] = { [key]: -1, utility: -20 };
    }
    const allIds = new Set([...pool.map(p => p.id), ...Object.keys(base.minExposureLimits || {}).map(Number)]);
    for (const id of Array.from(allIds)) {
      const maxPct = Math.min(base.globalMaxExposure ?? 100, base.exposureLimits?.[id] ?? 100);
      const minPct = base.minExposureLimits?.[id] ?? base.globalMinExposure ?? 0;
      model.constraints[`exp_${id}`] = { min: Math.ceil(size * minPct / 100 - 1e-9), max: Math.floor(size * maxPct / 100 + 1e-9) };
    }
    candidates.forEach((candidate, i) => {
      const f = infos[i];
      const v: any = { size: 1, utility: 1 + (scores[i] - scoreMin) / scoreRange, [`bound_${i}`]: 1, [`stack_${f.stack}`]: 1, [`flex_${f.flex}`]: 1, [`qb_${f.qbSalary}`]: 1, bringBack: Number(f.bringBack), secondary: Number(f.secondary) };
      v.utility += Number(f.games >= minGames && f.games <= s.maxGames) * 0.2;
      if (s.preferValueWr) v.utility += candidate.lineup.filter((p: Player) => pos(p, ["WR"]) && p.salary < 4500).length * 0.03;
      if (s.preferHomeTe) v.utility += candidate.lineup.filter((p: Player) => pos(p, ["TE"]) && parseGameInfo(p.gameInfo).home?.toUpperCase() === team(p)).length * 0.03;
      v.utility += f.secondaryQuality * 0.03;
      if (s.preferHomeFavoriteDst) v.utility += Number(candidate.lineup.some((p: Player) => pos(p, ["DST"]) && options.vegasGames?.some(g => g.homeTeam.toUpperCase() === team(p) && g.homeImplied > g.awayImplied))) * 0.06;
      if (s.preferLowTotalGames) v.utility += Number(options.vegasGames?.some(g => g.gameKey === stackGameKey(f.qb?.gameInfo) && g.total < s.gameTotalThreshold)) * 0.06;
      if (s.preferFourXUpside) v.utility += candidate.lineup.filter((p: Player) => {
        const actual = (p as any).upside ?? (p as any).ceiling;
        return actual != null && Number.isFinite(Number(actual)) && Number(actual) >= p.salary / 1000 * 4;
      }).length * 0.03;
      if (ownership) {
        const sum = candidate.lineup.reduce((n: number, p: Player) => n + ownership!.get(p.id)!, 0);
        v.utility -= Math.max(0, Math.abs(sum - OWNERSHIP_TARGETS[s.fieldSize]) - s.ownershipTolerance) / 100;
        if (s.preferLowOwnedWr) v.utility += candidate.lineup.filter((p: Player) => pos(p, ["WR"]) && ownership!.get(p.id)! < s.lowOwnershipThreshold).length * 0.03;
      }
      for (const p of candidate.lineup) v[`exp_${p.id}`] = 1;
      model.variables[`c${i}`] = v;
      model.constraints[`bound_${i}`] = { max: 1 };
      model.ints[`c${i}`] = 1;
    });
    const result: any = solver.Solve(model);
    if (!result.feasible) continue;
    const choice = candidates.map((_, i) => i).filter(i => Number(result[`c${i}`]) > 0.5);
    if (choice.length !== size) continue;
    const valid = Array.from(allIds).every(id => {
      const used = choice.filter(i => candidates[i].lineup.some((p: Player) => p.id === id)).length;
      const bound = model.constraints[`exp_${id}`];
      return used >= bound.min && used <= bound.max;
    });
    if (valid) { selected = choice; break; }
  }
  if (!selected.length) throw new Error(`No NFL portfolio found satisfying hard global/per-player minimum and maximum exposures within the ${budgetReached || Date.now() >= deadline ? "time" : "candidate search"} budget. Search exhaustion does not prove infeasibility; increase the budget or expand the eligible pool, or review exposure bounds.`);
  const lineups = selected.map(i => candidates[i]);
  const achieved = selected.map(i => infos[i]);
  const report: NflPortfolioReport = { requestedCount: count, generatedCount: lineups.length, candidateCount: candidates.length, seed: s.seed, metrics: [], warnings, partial: lineups.length < count, dataSources: { ownership: s.ownershipMode, vegas: options.vegasGames?.length ? "verified" : "unavailable", rushing: "manual" } };
  const metric = (key: string, label: string, target: number | null, value: number | null, unit: "lineups" | "percent" | "points" | "games" = "lineups", detail?: string) => {
    report.metrics.push({ key, label, target, achieved: value, unit, status: value === null ? "unavailable" : target === null ? "info" : Math.abs(value - target) < 0.01 ? "met" : "shortfall", detail });
  };
  metric("count", "Unique lineups", count, lineups.length);
  for (const [k, n] of Object.entries(stackPlan)) metric(`stack_${k}`, `${k} QB stack`, n, achieved.filter(x => x.stack === k).length);
  for (const [k, n] of Object.entries(planNflMix(flexMix, count))) metric(`flex_${k}`, `${k} FLEX`, n, achieved.filter(x => x.flex === k).length, "lineups", allowedFlex.includes(k) ? undefined : "Unavailable under hard FLEX mask; target adjusted to zero.");
  for (const [k, n] of Object.entries(planNflMix(s.qbSalaryMix, count))) metric(`qb_${k}`, `${k} QB salary`, n, achieved.filter(x => x.qbSalary === k).length);
  metric("bringBack", "QB game bring-back", Math.round(count * s.bringBackPct / 100), achieved.filter(x => x.bringBack).length);
  metric("secondary", "Secondary skill pair outside QB game (same-team RB+WR/TE or opposing skills)", Math.round(count * s.secondaryStackPct / 100), achieved.filter(x => x.secondary).length);
  metric("games", `Lineups with ${minGames}–${s.maxGames} games`, count, achieved.filter(x => x.games >= minGames && x.games <= s.maxGames).length);
  metric("lowOwned", "Lineups meeting low-owned minimum", ownership ? count : null, ownership ? lineups.filter(x => x.lineup.filter((p: Player) => ownership!.get(p.id)! < s.lowOwnershipThreshold).length >= s.minLowOwnedPlayers).length : null);
  metric("ownershipSum", "Average ownership sum", ownership ? OWNERSHIP_TARGETS[s.fieldSize] : null, ownership ? lineups.reduce((n, x) => n + x.lineup.reduce((sum: number, p: Player) => sum + ownership!.get(p.id)!, 0), 0) / lineups.length : null, "percent");
  const preference = (key: string, label: string, enabled: boolean, predicate: (p: Player) => boolean, available = true) => {
    if (enabled) metric(key, label, null, available ? lineups.filter(x => x.lineup.some(predicate)).length : null);
  };
  preference("valueWr", "Lineups with WR below $4,500", s.preferValueWr, p => pos(p, ["WR"]) && p.salary < 4500);
  preference("homeTe", "Lineups with home TE", s.preferHomeTe, p => pos(p, ["TE"]) && parseGameInfo(p.gameInfo).home?.toUpperCase() === team(p), eligible.some(p => !!parseGameInfo(p.gameInfo).home));
  preference("lowOwnedWr", "Lineups with low-owned WR", s.preferLowOwnedWr, p => pos(p, ["WR"]) && ownership!.get(p.id)! < s.lowOwnershipThreshold, !!ownership);
  preference("homeFavoriteDst", "Lineups with verified home-favorite DST", s.preferHomeFavoriteDst, p => pos(p, ["DST", "DEF"]) && !!options.vegasGames?.some(g => g.homeTeam.toUpperCase() === team(p) && g.homeImplied > g.awayImplied), !!options.vegasGames?.length);
  preference("lowTotalGames", `QB stacked games below ${s.gameTotalThreshold}`, s.preferLowTotalGames, p => pos(p, ["QB"]) && !!options.vegasGames?.some(g => g.gameKey === stackGameKey(p.gameInfo) && g.total < s.gameTotalThreshold), !!options.vegasGames?.length);
  const upside = (p: Player) => {
    const value = (p as any).upside ?? (p as any).ceiling;
    return value == null || value === "" ? NaN : Number(value);
  };
  preference("fourXUpside", "Lineups with supplied 4x salary upside", s.preferFourXUpside, p => Number.isFinite(upside(p)) && upside(p) >= p.salary / 1000 * 4, eligible.some(p => Number.isFinite(upside(p))));
  if (s.preferFourXUpside && !eligible.some(p => Number.isFinite(upside(p)))) warnings.push("No actual upside/ceiling field available; 4x upside preference is unavailable (not fabricated).");
  if (report.partial) warnings.push("Partial portfolio: candidate diversity, solve budget or hard exposure bounds prevented the requested count. All returned exposure limits use the actual returned count.");
  if (report.metrics.some(m => m.status === "shortfall")) warnings.push("Some soft portfolio targets were relaxed; see requested versus achieved metrics. Hard lineup and exposure requirements were not relaxed.");
  return { lineups, report };
}