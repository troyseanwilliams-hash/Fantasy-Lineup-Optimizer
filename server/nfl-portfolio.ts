import type { Player } from "@shared/schema";
import { DEFAULT_NFL_PORTFOLIO, OWNERSHIP_TARGETS, type NflPortfolioSettings, type NflPortfolioReport, type NflPortfolioLineupPolicy } from "@shared/nfl-portfolio";
import { parseGameInfo } from "@shared/game-info";
import { stackGameKey } from "./sim-game-stacks";
import { normalizeNFLTeam } from "./nfl-team";
import type { VegasGameOdds } from "./vegas-client";
import solver from "javascript-lp-solver";
import { validatedIntegralResult } from "./solver-guard";
import { spawn } from "node:child_process";

async function solvePortfolioModelIsolated(model: any, timeoutMs: number): Promise<{ result?: any; timedOut: boolean }> {
  const script = [
    "let input='';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => input += chunk);",
    "process.stdin.on('end', () => {",
    "try { const solver=require('javascript-lp-solver'); process.stdout.write(JSON.stringify(solver.Solve(JSON.parse(input)))); }",
    "catch (error) { process.stderr.write(String(error && error.stack || error)); process.exitCode=1; }",
    "});",
  ].join("");
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: { result?: any; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", () => finish({ timedOut: false }));
    child.on("close", code => {
      if (settled) return;
      if (code !== 0 || stderr || !stdout) return finish({ timedOut: false });
      try { finish({ result: JSON.parse(stdout), timedOut: false }); }
      catch { finish({ timedOut: false }); }
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ timedOut: true });
    }, Math.max(1, timeoutMs));
    child.stdin.end(JSON.stringify(model));
  });
}

const pos = (p: Player, positions: string[]) => p.position.toUpperCase().split("/").some(x => positions.includes(x.trim()));
const team = (p: Player) => p.team.trim().toUpperCase();
/** Automatic regeneration applies structure and the hard RB floor, not the full research preset. */
export function regenerationNflSettings(pool: Player[]): NflPortfolioSettings {
  return { ...DEFAULT_NFL_PORTFOLIO, enabled: true, rbMinSalary: 4500, allowLockedCheapRb: false,
    nakedQbIds: pool.filter(p => pos(p, ["QB"])).map(p => p.id),
    minGames: 2, maxGames: 9, preferHomeTe: false, preferHomeFavoriteDst: false,
    preferLowTotalGames: false, preferValueWr: false, preferFourXUpside: false, preferLowOwnedWr: false };
}
export const qbSalaryBin = (salary: number): "punt" | "value" | "mid" | "premium" =>
  salary < 5000 ? "punt" : salary < 6000 ? "value" : salary < 7000 ? "mid" : "premium";

/** Largest remainder, with stable ties; counts always sum to the requested size. */
export function planNflMix(mix: Record<string, number>, count: number): Record<string, number> {
  const entries = Object.entries(mix).map(([key, pct], i) => ({ key, n: Math.floor(count * pct / 100), rem: count * pct / 100 % 1, i }));
  let left = count - entries.reduce((n, x) => n + x.n, 0);
  for (const x of [...entries].sort((a, b) => b.rem - a.rem || a.i - b.i)) if (left-- > 0) x.n++;
  return Object.fromEntries(entries.map(x => [x.key, x.n]));
}

/** Deterministic fallback quality: outcome leads, lower ownership breaks toward leverage. */
export function scoreNflFallbackCandidates(
  candidates: Array<{ lineup: Player[] }>,
  outcomeScores: number[],
  ownership?: Map<number, number>,
): number[] {
  if (candidates.length !== outcomeScores.length) throw new Error("NFL fallback scoring requires one outcome score per candidate.");
  const normalize = (values: number[], invert = false) => {
    const min = Math.min(...values), range = Math.max(...values) - min;
    if (!range) return values.map(() => invert ? 1 : 0.5);
    return values.map(value => invert ? 1 - (value - min) / range : (value - min) / range);
  };
  const outcome = normalize(outcomeScores);
  if (!ownership) return outcome;
  const ownershipSums = candidates.map(candidate => candidate.lineup.reduce((sum, player) => sum + ownership.get(player.id)!, 0));
  const leverage = normalize(ownershipSums, true);
  return outcome.map((value, index) => value * 0.7 + leverage[index] * 0.3);
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
  if (policy.secondary === false) {
    const skills = available.filter(p => pos(p, ["RB", "WR", "TE"]));
    for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i], b = skills[j], game = stackGameKey(a.gameInfo);
      if (!game || game !== stackGameKey(b.gameInfo)) continue;
      if (team(a) === team(b) && !(pos(a, ["RB"]) && pos(b, ["WR", "TE"])) && !(pos(b, ["RB"]) && pos(a, ["WR", "TE"]))) continue;
      const key = `nfl_pair_${a.id}_${b.id}`;
      const qbs = available.filter(p => pos(p, ["QB"]) && stackGameKey(p.gameInfo) === game);
      model.constraints[key] = { max: 1 };
      model.variables[`p${a.id}`][key] = 1;
      model.variables[`p${b.id}`][key] = 1;
      for (const qb of qbs) model.variables[`p${qb.id}`][key] = -1;
    }
  }
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
  vegasGames?: VegasGameOdds[];
  deadline?: number; solve: (pool: Player[], constraints: any) => any;
  scoreCandidates?: (lineups: any[]) => Promise<number[]> | number[];
  strictStructure?: boolean;
  structureOnly?: boolean;
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
  if (locks.some(id => !eligible.some(p => p.id === id))) throw new Error(`Locked RB violates the $${s.rbMinSalary.toLocaleString("en-US")} RB salary floor. Unlock the player or choose an eligible RB. No lineups were saved.`);
  const maximum = (id: number) => Math.min(base.globalMaxExposure ?? 100, base.exposureLimits?.[id] ?? 100);
  const minimum = (id: number) => options.strictStructure ? base.minExposureLimits?.[id] ?? 0 : base.minExposureLimits?.[id] ?? base.globalMinExposure ?? 0;
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
  const totalGames = options.vegasGames?.filter(game => Number.isFinite(game.total) && game.total > 0) ?? [];
  const favoriteGames = options.vegasGames?.filter(game =>
    !!game.favoriteTeam && (game.source === "odds_api" || (Number.isFinite(game.spread) && game.spread! > 0)),
  ) ?? [];
  if (!totalGames.length && !favoriteGames.length) warnings.push("Verified Vegas data unavailable; home-favorite DST and game-total preferences cannot be verified.");
  else {
    if (!favoriteGames.length && s.preferHomeFavoriteDst) warnings.push("Verified game totals are available, but favorite/spread data is unavailable; home-favorite DST preference was not applied.");
    if (!totalGames.length && s.preferLowTotalGames) warnings.push("Verified favorite/spread data is available, but game totals are unavailable; low-total preference was not applied.");
  }
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
  let projectionFloorRejected = 0;
  const minTargets = eligible.filter(p => minimum(p.id) > 0 && !locks.includes(p.id));
  let minTargetTurn = 0;
  let budgetReached = false;
  let state = s.seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const original = new Map(pool.map(p => [p.id, p]));
  const maxAttempts = Math.min(1500, Math.max(48, count * 12));
  const coverageSize = Math.min(maxAttempts, Math.max(80, count * 3));
  const planned = (mix: Record<string, number>) => {
    const values: string[] = [];
    for (const [key, n] of Object.entries(planNflMix(mix, coverageSize))) {
      for (let i = 0; i < n; i++) values.push(key);
    }
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  const stackSchedule = planned(s.stackMix);
  const flexSchedule = planned(flexMix);
  const qbSalarySchedule = planned(s.qbSalaryMix);
  const booleanSchedule = (pct: number) => planned({ yes: pct, no: 100 - pct }).map(value => value === "yes");
  const bringBackSchedule = booleanSchedule(s.bringBackPct);
  const secondarySchedule = booleanSchedule(s.secondaryStackPct);
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.strictStructure && candidates.length >= Math.max(80, count * 3)) break;
    if (Date.now() >= candidateDeadline) { budgetReached = true; warnings.push("Candidate solve budget reached; reserved time for scoring and hard-exposure selection."); break; }
    // Let HTTP requests and timers run between bounded synchronous solves.
    await new Promise<void>(resolve => setImmediate(resolve));
    // Cover each requested structure bucket deliberately before broad search.
    const plannedAttempt = attempt < coverageSize;
    const stack = plannedAttempt ? stackSchedule[attempt] : ["single", "double", "triple", "naked"][attempt % 4];
    const catcherCount = ["naked", "single", "double", "triple"].indexOf(stack) as 0 | 1 | 2 | 3;
    if (!catcherCount && !s.nakedQbIds.length) continue;
    const policy: NflPortfolioLineupPolicy = {
      ...(options.strictStructure ? { secondary: plannedAttempt ? secondarySchedule[attempt] : random() * 100 < s.secondaryStackPct } : {}),
      catcherCount, bringBack: plannedAttempt ? bringBackSchedule[attempt] : random() * 100 < s.bringBackPct,
      nakedQbIds: s.nakedQbIds, rbMinSalary: s.rbMinSalary,
      exemptLockedRbIds: s.allowLockedCheapRb ? locks : [],
      minLowOwnedPlayers: ownership ? s.minLowOwnedPlayers : 0,
      lowOwnershipThreshold: s.lowOwnershipThreshold, stackGameKeys: base.stackGameKeys || [],
    };
    // Seed low-projection minimum-exposure players, rather than hoping jitter selects them.
    // One additional lock per solve limits incompatible temporary structures.
    const deficitTargets = minTargets.filter(p => (usage.get(p.id) || 0) < Math.max(1, Math.ceil((candidates.length + 1) * minimum(p.id) / 100)));
    const forced = deficitTargets.length ? deficitTargets[minTargetTurn++ % deficitTargets.length] : undefined;
    const secondaryPairs: Player[][] = [];
    if (policy.secondary) {
      const skills = eligible.filter(p => pos(p, ["RB", "WR", "TE"]) && maximum(p.id) > 0);
      for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) {
        const a = skills[i], b = skills[j], game = stackGameKey(a.gameInfo);
        if (game && game === stackGameKey(b.gameInfo) && (team(a) !== team(b) ||
          (pos(a, ["RB"]) && pos(b, ["WR", "TE"])) || (pos(b, ["RB"]) && pos(a, ["WR", "TE"])))) secondaryPairs.push([a, b]);
      }
    }
    const pair = secondaryPairs.length ? secondaryPairs[Math.floor(random() * secondaryPairs.length)] : [];
    const attemptLocks = Array.from(new Set([...locks, ...(forced ? [forced.id] : []), ...pair.map(p => p.id)]));
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
    let searchPool = jittered.filter(p => !attemptExcluded.includes(p.id));
    if (options.strictStructure) {
      // Pick a QB before the roster solve. This removes dozens of conditional
      // QB branches from a full-slate LP without changing final eligibility.
      const qbChoices = searchPool.filter(p => pos(p, ["QB"]) &&
        (catcherCount > 0 || s.nakedQbIds.includes(p.id)) &&
        (!(base.stackAlternatives?.length) || base.stackAlternatives.some((alt: any) => alt.kind === "players" || alt.gameKey === stackGameKey(p.gameInfo))) &&
        (!policy.stackGameKeys.length || policy.stackGameKeys.includes(stackGameKey(p.gameInfo))))
        .sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
      const salaryChoices = !options.structureOnly && plannedAttempt
        ? qbChoices.filter(p => qbSalaryBin(p.salary) === qbSalarySchedule[attempt])
        : qbChoices;
      const forcedQb = salaryChoices.find(p => attemptLocks.includes(p.id));
      const qb = forcedQb ?? salaryChoices[Math.floor(random() * Math.min(12, salaryChoices.length))];
      if (!qb) continue;
      if (!attemptLocks.includes(qb.id)) attemptLocks.push(qb.id);
      const keep = new Set(attemptLocks);
      for (const alt of base.stackAlternatives || []) for (const id of alt.playerIds || []) keep.add(id);
      // Rank anew on each jittered solve, retain cheap salary alternatives, all
      // required players and the chosen QB's correlation partners.
      for (const position of ["RB", "WR", "TE", "DST"]) {
        const group = searchPool.filter(p => pos(p, [position])).sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
        for (const p of group.slice(0, 22)) keep.add(p.id);
        for (const p of [...group].sort((a, b) => a.salary - b.salary || Number(b.projectedPoints) - Number(a.projectedPoints)).slice(0, 4)) keep.add(p.id);
      }
      for (const p of searchPool) if (stackGameKey(p.gameInfo) === stackGameKey(qb.gameInfo) && pos(p, ["RB", "WR", "TE"])) keep.add(p.id);
      searchPool = searchPool.filter(p => keep.has(p.id) && (!pos(p, ["QB"]) || p.id === qb.id));
    }
    // Deliberately generate every eligible FLEX shape, rather than hoping TE wins
    // a projection-only FLEX contest. Final selection still enforces the mix.
    const flexChoices = Object.keys(flexMix).filter(k => flexMix[k] > 0);
    const chosenFlex = plannedAttempt ? flexSchedule[attempt] : flexChoices[Math.floor(random() * flexChoices.length)];
    const constraints = { ...base, minProjection: undefined, lockedPlayerIds: attemptLocks, excludedPlayerIds: attemptExcluded, nflPortfolio: s, nflPortfolioLineupPolicy: policy, ownershipMap: ownership,
      ...(options.strictStructure ? { flexAllowedPositions: [chosenFlex] } : {}) };
    let result: any;
    try { result = await options.solve(searchPool, constraints); } catch (error) { lastError = String(error); continue; }
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
    if (projection < (base.projectedPointsFloor ?? 0)) {
      projectionFloorRejected++;
      continue;
    }
    if (qbs !== 1 || dsts !== 1 || rbs < 2 || rbs > 3 || wrs < 3 || wrs > 4 || tes < 1 || tes > 2 ||
      !allowedFlex.includes(info.flex) || !satisfiesFavorite ||
      salary > Math.min(base.maxSalary ?? 50000, base.totalMaxSalary ?? 50000) || salary < Math.max(base.minSalary ?? 0, base.totalMinSalary ?? 0) ||
      lineup.some(p => (base.playerMinSalary && !pos(p, ["DST", "DEF"]) && p.salary < base.playerMinSalary && !locks.includes(p.id)) || (base.playerMaxSalary && p.salary > base.playerMaxSalary && !locks.includes(p.id)))) continue;
    // Validate policy even if a custom solve callback did not apply the LP helper.
    if (lineup.length !== 9 || new Set(ids).size !== 9 || attemptLocks.some(id => !ids.includes(id)) || ids.some(id => attemptExcluded.includes(id)) ||
       !info.qb || info.catchers !== catcherCount || info.bringBack !== policy.bringBack ||
       (policy.secondary !== undefined && info.secondary !== policy.secondary) ||
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
  if (!candidates.length) {
    const floorMessage = (base.projectedPointsFloor ?? 0) > 0 && projectionFloorRejected > 0
      ? `Projection floor ${Number(base.projectedPointsFloor).toFixed(1)} left 0 qualifying candidates; ${projectionFloorRejected} candidate solves were rejected below the floor.`
      : lastError || "Check locks, RB salary floor, ownership, naked eligibility and stack alternatives.";
    throw new Error(`No NFL portfolio lineup found within the ${budgetReached ? "time" : "candidate search"} budget; this does not prove infeasibility. ${floorMessage} No lineups were saved.`);
  }
  const scores = options.scoreCandidates ? await options.scoreCandidates(candidates) : candidates.map(x => x.totalProjectedPoints);
  if (scores.length !== candidates.length || scores.some(x => !Number.isFinite(x))) throw new Error("NFL portfolio scoring callback returned invalid scores.");
  const infos = candidates.map(x => classifyNflLineup(x.lineup));
  const scoreMin = Math.min(...scores), scoreRange = Math.max(...scores) - scoreMin || 1;
  const fallbackScores = scoreNflFallbackCandidates(candidates, scores, ownership);
  // Select and validate the entire batch, never a greedy exposure approximation.
  // Every smaller size recomputes all percentage-derived bounds.
  let selected: number[] = [];
  let selectionTimedOut = false;
  let requestedCapacityIssues: string[] = [];
  const allIds = new Set([...pool.map(p => p.id), ...Object.keys(base.minExposureLimits || {}).map(Number)]);
  const capacityIssues = (size: number, targets: Record<string, number>) => {
    const issues: string[] = [];
    const countFor = (key: string) => infos.filter(f =>
      key === "bringBack" ? f.bringBack :
      key === "secondary" ? f.secondary :
      key.startsWith("stack_") ? f.stack === key.slice(6) :
      key.startsWith("flex_") ? f.flex === key.slice(5) :
      key.startsWith("qb_") ? f.qbSalary === key.slice(3) : false).length;
    if (options.strictStructure) {
      for (const [key, target] of Object.entries(targets)) {
        const tolerance = target === 0 ? 0 : Math.max(1, Math.floor(size * 0.02));
        const required = Math.max(0, target - tolerance);
        const available = countFor(key);
        if (available < required) issues.push(`${key.replaceAll("_", " ")} needs at least ${required} candidates, but only ${available} are available.`);
      }
    }
    for (const [rawId, pct] of Object.entries(base.minExposureLimits || {})) {
      const id = Number(rawId);
      const required = Math.ceil(size * Number(pct) / 100 - 1e-9);
      const available = candidates.filter(candidate => candidate.lineup.some((p: Player) => p.id === id)).length;
      if (available < required) issues.push(`${original.get(id)?.name || `Player ${id}`} needs ${required} appearances, but only ${available} candidates contain that player.`);
    }
    return issues;
  };
  const fallbackReserve = options.strictStructure ? Math.min(2500, Math.max(0, (deadline - Date.now()) * 0.45)) : 0;
  const strictSelectionDeadline = deadline - fallbackReserve;
  for (let size = Math.min(count, candidates.length); size >= 1; size--) {
    if (options.deadline && Date.now() >= strictSelectionDeadline && size !== Math.min(count, candidates.length)) break;
    const model: any = { optimize: "utility", opType: "max", constraints: { size: { equal: size } }, variables: {}, ints: {}, timeout: Math.min(2000, Math.max(1, strictSelectionDeadline - Date.now())) };
    const targets: Record<string, number> = {};
    for (const [k, n] of Object.entries(planNflMix(s.stackMix, size))) targets[`stack_${k}`] = n;
    for (const [k, n] of Object.entries(planNflMix(flexMix, size))) targets[`flex_${k}`] = n;
    if (!options.structureOnly) for (const [k, n] of Object.entries(planNflMix(s.qbSalaryMix, size))) targets[`qb_${k}`] = n;
    targets.bringBack = Math.round(size * s.bringBackPct / 100);
    targets.secondary = Math.round(size * s.secondaryStackPct / 100);
    for (const [key, target] of Object.entries(targets)) {
      if (options.strictStructure) {
        // At most one lineup for small batches, 2% for large batches.
        // A zero target remains zero (including forbidden FLEX positions).
        const tolerance = target === 0 ? 0 : Math.max(1, Math.floor(size * 0.02));
        model.constraints[key] = { min: Math.max(0, target - tolerance), max: Math.min(size, target + tolerance) };
        continue;
      }
      model.constraints[key] = { equal: target };
      model.variables[`under_${key}`] = { [key]: 1, utility: -20 };
      model.variables[`over_${key}`] = { [key]: -1, utility: -20 };
    }
    const issues = capacityIssues(size, targets);
    if (size === count) requestedCapacityIssues = issues;
    if (issues.length) continue;
    for (const id of Array.from(allIds)) {
      const maxPct = Math.min(base.globalMaxExposure ?? 100, base.exposureLimits?.[id] ?? 100);
      const minPct = minimum(id);
      const conditional = options.strictStructure ? Math.ceil(size * (base.globalMinExposure ?? 0) / 100 - 1e-9) : 0;
      model.constraints[`exp_${id}`] = {
        min: Math.ceil(size * minPct / 100 - 1e-9),
        max: Math.floor(size * maxPct / 100 + 1e-9),
        ...(conditional > 0 ? { usedMin: conditional } : {}),
      };
      if (conditional > 0) {
        model.constraints[`exp_lo_${id}`] = { min: 0 };
        model.constraints[`exp_hi_${id}`] = { max: 0 };
        model.constraints[`exp_used_${id}`] = { max: 1 };
        model.variables[`exp_y_${id}`] = {
          [`exp_lo_${id}`]: -conditional,
          [`exp_hi_${id}`]: -size,
          [`exp_used_${id}`]: 1,
          utility: 0,
        };
        model.ints[`exp_y_${id}`] = 1;
      }
    }
    candidates.forEach((candidate, i) => {
      const f = infos[i];
      const v: any = { size: 1, utility: 1 + (scores[i] - scoreMin) / scoreRange, [`bound_${i}`]: 1, [`stack_${f.stack}`]: 1, [`flex_${f.flex}`]: 1, [`qb_${f.qbSalary}`]: 1, bringBack: Number(f.bringBack), secondary: Number(f.secondary) };
      v.utility += Number(f.games >= minGames && f.games <= s.maxGames) * 0.2;
      if (s.preferValueWr) v.utility += candidate.lineup.filter((p: Player) => pos(p, ["WR"]) && p.salary < 4500).length * 0.03;
      if (s.preferHomeTe) v.utility += candidate.lineup.filter((p: Player) => pos(p, ["TE"]) && parseGameInfo(p.gameInfo).home?.toUpperCase() === team(p)).length * 0.03;
      v.utility += f.secondaryQuality * 0.03;
      if (s.preferHomeFavoriteDst) v.utility += Number(candidate.lineup.some((p: Player) => pos(p, ["DST"]) && favoriteGames.some(g => normalizeNFLTeam(g.homeTeam) === normalizeNFLTeam(team(p)) && g.favoriteTeam === g.homeTeam))) * 0.06;
      if (s.preferLowTotalGames) v.utility += Number(totalGames.some(g => g.gameKey === stackGameKey(f.qb?.gameInfo) && g.total < s.gameTotalThreshold)) * 0.06;
      if (s.preferFourXUpside) v.utility += candidate.lineup.filter((p: Player) => {
        const actual = (p as any).upside ?? (p as any).ceiling;
        return actual != null && Number.isFinite(Number(actual)) && Number(actual) >= p.salary / 1000 * 4;
      }).length * 0.03;
      if (ownership) {
        const sum = candidate.lineup.reduce((n: number, p: Player) => n + ownership!.get(p.id)!, 0);
        v.utility -= Math.max(0, Math.abs(sum - OWNERSHIP_TARGETS[s.fieldSize]) - s.ownershipTolerance) / 100;
        if (s.preferLowOwnedWr) v.utility += candidate.lineup.filter((p: Player) => pos(p, ["WR"]) && ownership!.get(p.id)! < s.lowOwnershipThreshold).length * 0.03;
      }
      for (const p of candidate.lineup) {
        v[`exp_${p.id}`] = 1;
        if (model.constraints[`exp_lo_${p.id}`]) {
          v[`exp_lo_${p.id}`] = 1;
          v[`exp_hi_${p.id}`] = 1;
        }
      }
      model.variables[`c${i}`] = v;
      model.constraints[`bound_${i}`] = { max: 1 };
      model.ints[`c${i}`] = 1;
    });
    let result: any;
    if (options.strictStructure) {
      // Run dense exact feasibility outside the server process. javascript-lp-solver
      // can remain inside a simplex operation past its own timeout; a child process
      // gives this request a real, killable deadline without blocking all traffic.
      const exactBudget = Math.min(size === count ? 1_200 : 180, Math.max(1, strictSelectionDeadline - Date.now()));
      const feasibilityModel = structuredClone(model);
      for (const variable of Object.values(feasibilityModel.variables) as any[]) variable.utility = 0;
      const exact = await solvePortfolioModelIsolated(feasibilityModel, exactBudget);
      result = validatedIntegralResult(exact.result, feasibilityModel);
      selectionTimedOut ||= exact.timedOut && !result;
    }
    if (options.strictStructure && !result && Date.now() < strictSelectionDeadline) {
      const keys = Object.keys(model.constraints).filter(k => k !== "size" && !k.startsWith("bound_") &&
        !k.startsWith("exp_lo_") && !k.startsWith("exp_hi_") && !k.startsWith("exp_used_"));
      const bounds = keys.map(k => model.constraints[k]);
      const rows = candidates.map((_, i) => keys.map(k => Number(model.variables[`c${i}`][k] || 0)));
      const penalty = (n: number, b: any) => Math.max(0, Math.max(b.min ?? b.equal ?? 0, n > 0 ? b.usedMin ?? 0 : 0) - n) ** 2 +
        Math.max(0, n - (b.max ?? b.equal ?? size)) ** 2;
      const stop = Math.min(strictSelectionDeadline, Date.now() + (size === count ? 1_200 : 120));
      let found: number[] | undefined;
      for (let restart = 0; restart < 12 && Date.now() < stop && !found; restart++) {
        const order = candidates.map((_, i) => i).sort((a, b) => model.variables[`c${b}`].utility - model.variables[`c${a}`].utility);
        if (restart) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        const inside = order.slice(0, size), outside = order.slice(size);
        const totals = keys.map((_, k) => inside.reduce((n, i) => n + rows[i][k], 0));
        let loss = totals.reduce((n, v, k) => n + penalty(v, bounds[k]), 0);
        for (let step = 0; step < 40000 && Date.now() < stop; step++) {
          if (loss < 1e-8) { found = inside; break; }
          if (!outside.length) break;
          const ai = Math.floor(random() * inside.length), bi = Math.floor(random() * outside.length);
          const a = inside[ai], b = outside[bi];
          let delta = 0;
          for (let k = 0; k < keys.length; k++) if (rows[a][k] !== rows[b][k]) delta += penalty(totals[k] - rows[a][k] + rows[b][k], bounds[k]) - penalty(totals[k], bounds[k]);
          const heat = Math.max(0.05, 1 - step / 10000);
          if (delta <= 0 || random() < Math.exp(-delta / heat)) {
            for (let k = 0; k < keys.length; k++) totals[k] += rows[b][k] - rows[a][k];
            inside[ai] = b; outside[bi] = a; loss += delta;
          }
        }
      }
      result = found ? { feasible: true, ...Object.fromEntries(found.map(i => [`c${i}`, 1])) } : { feasible: false };
    } else if (!options.strictStructure) result = solver.Solve(model);
    if (!result?.feasible) continue;
    const choice = candidates.map((_, i) => i).filter(i => Number(result[`c${i}`]) > 0.5);
    if (choice.length !== size) continue;
    const valid = Array.from(allIds).every(id => {
      const used = choice.filter(i => candidates[i].lineup.some((p: Player) => p.id === id)).length;
      const bound = model.constraints[`exp_${id}`];
       return used >= Math.max(bound.min, used > 0 ? bound.usedMin ?? 0 : 0) && used <= bound.max;
    });
    const structureValid = !options.strictStructure || Object.keys(targets).every(key => {
      const used = choice.reduce((n, i) => n + (model.variables[`c${i}`][key] || 0), 0);
      return used >= model.constraints[key].min && used <= model.constraints[key].max;
    });
    if (valid && structureValid) { selected = choice; break; }
  }
  const normalSelection = [...selected];
  let preservedNormalSelection = true;
  if (options.strictStructure && selected.length < count && candidates.length > selected.length && Date.now() < deadline) {
    const normalBonus = candidates.length + 1;
    const makeFallbackModel = (size: number, required: Set<number>) => {
      const model: any = {
        optimize: "utility", opType: "max", constraints: { size: { equal: size } }, variables: {}, ints: {},
        timeout: Math.max(1, deadline - Date.now() - 25),
      };
      for (const id of Array.from(allIds)) {
        const conditional = Math.ceil(size * (base.globalMinExposure ?? 0) / 100 - 1e-9);
        model.constraints[`exp_${id}`] = {
          min: Math.ceil(size * minimum(id) / 100 - 1e-9),
          max: Math.floor(size * maximum(id) / 100 + 1e-9),
          ...(conditional > 0 ? { usedMin: conditional } : {}),
        };
        if (conditional > 0) {
          model.constraints[`exp_lo_${id}`] = { min: 0 };
          model.constraints[`exp_hi_${id}`] = { max: 0 };
          model.constraints[`exp_used_${id}`] = { max: 1 };
          model.variables[`exp_y_${id}`] = {
            [`exp_lo_${id}`]: -conditional, [`exp_hi_${id}`]: -size, [`exp_used_${id}`]: 1, utility: 0,
          };
          model.ints[`exp_y_${id}`] = 1;
        }
      }
      candidates.forEach((candidate, i) => {
        // One retained normal-formula lineup is worth more than every fallback
        // quality difference combined, so preservation is lexicographically first.
        const v: any = { size: 1, utility: fallbackScores[i] + (normalSelection.includes(i) ? normalBonus : 0), [`bound_${i}`]: 1 };
        for (const p of candidate.lineup) {
          v[`exp_${p.id}`] = 1;
          if (model.constraints[`exp_lo_${p.id}`]) {
            v[`exp_lo_${p.id}`] = 1;
            v[`exp_hi_${p.id}`] = 1;
          }
        }
        if (required.has(i)) {
          model.constraints[`keep_${i}`] = { equal: 1 };
          v[`keep_${i}`] = 1;
        }
        model.variables[`c${i}`] = v;
        model.constraints[`bound_${i}`] = { max: 1 };
        model.ints[`c${i}`] = 1;
      });
      return model;
    };
    const hardValid = (choice: number[], size: number) => Array.from(allIds).every(id => {
      const used = choice.filter(i => candidates[i].lineup.some((p: Player) => p.id === id)).length;
      const explicit = Math.ceil(size * minimum(id) / 100 - 1e-9);
      const conditional = used > 0 ? Math.ceil(size * (base.globalMinExposure ?? 0) / 100 - 1e-9) : 0;
      return used >= Math.max(explicit, conditional) && used <= Math.floor(size * maximum(id) / 100 + 1e-9);
    });
    const improveFallback = (choice: number[], size: number, required: Set<number>) => {
      const chosen = new Set(choice);
      const utility = (i: number) => fallbackScores[i] + (normalSelection.includes(i) ? normalBonus : 0);
      for (const incoming of candidates.map((_, i) => i).filter(i => !chosen.has(i)).sort((a, b) => utility(b) - utility(a) || a - b)) {
        if (Date.now() >= deadline) break;
        const outgoing = Array.from(chosen).filter(i => !required.has(i) && utility(i) < utility(incoming))
          .sort((a, b) => utility(a) - utility(b) || b - a);
        for (const removed of outgoing) {
          if (Date.now() >= deadline) break;
          const trial = Array.from(chosen).filter(i => i !== removed);
          trial.push(incoming);
          if (!hardValid(trial, size)) continue;
          chosen.delete(removed);
          chosen.add(incoming);
          break;
        }
      }
      return Array.from(chosen);
    };
    const tryFallback = async (size: number, required: Set<number>) => {
      const model = makeFallbackModel(size, required);
      // Ask the isolated solver for the actual best outcome/leverage portfolio.
      // Its process-level deadline is authoritative even if the LP library stays
      // inside an optimization step past its own timeout.
      const optimizeBudget = Math.min(900, Math.max(1, (deadline - Date.now()) * 0.65));
      const optimized = await solvePortfolioModelIsolated(model, optimizeBudget);
      selectionTimedOut ||= optimized.timedOut;
      const optimizedResult = validatedIntegralResult(optimized.result, model);
      if (optimizedResult) {
        const choice = candidates.map((_, i) => i).filter(i => Number(optimizedResult[`c${i}`]) > 0.5);
        if (choice.length === size && hardValid(choice, size)) return choice;
      }
      if (Date.now() >= deadline) return undefined;
      // Optimization timing out must not discard a hard-valid completion. Find
      // feasibility with the remaining budget, then improve it only until deadline.
      const feasibility = structuredClone(model);
      for (const variable of Object.values(feasibility.variables) as any[]) variable.utility = 0;
      feasibility.timeout = Math.max(1, deadline - Date.now() - 25);
      const budget = Math.min(700, Math.max(1, deadline - Date.now()));
      const exact = await solvePortfolioModelIsolated(feasibility, budget);
      selectionTimedOut ||= exact.timedOut;
      const result = validatedIntegralResult(exact.result, feasibility);
      if (!result) return undefined;
      const choice = candidates.map((_, i) => i).filter(i => Number(result[`c${i}`]) > 0.5);
      return choice.length === size && hardValid(choice, size) ? improveFallback(choice, size, required) : undefined;
    };
    const minimumFallbackSize = Math.min(count, candidates.length);
    for (let size = minimumFallbackSize; size > normalSelection.length && Date.now() < deadline; size--) {
      const required = new Set(normalSelection.filter(i => i < candidates.length));
      let choice = await tryFallback(size, required);
      let preserved = !!choice;
      if (!choice && Date.now() < deadline && required.size) {
        choice = await tryFallback(size, new Set());
        preserved = false;
      }
      if (choice) {
        preservedNormalSelection = preserved;
        const normalSet = new Set(normalSelection);
        selected = [
          ...choice.filter(i => normalSet.has(i)).sort((a, b) => fallbackScores[b] - fallbackScores[a] || a - b),
          ...choice.filter(i => !normalSet.has(i)).sort((a, b) => fallbackScores[b] - fallbackScores[a] || a - b),
        ];
        break;
      }
    }
  }
  if (!selected.length) {
    const reason = requestedCapacityIssues[0] ||
      (selectionTimedOut || budgetReached || Date.now() >= deadline
        ? "Selection time budget was exhausted; this does not prove infeasibility."
        : "Candidate coverage could not supply a validated batch.");
    throw new Error(`No valid NFL portfolio found satisfying ${options.strictStructure ? "bounded structure targets and " : ""}hard global/per-player minimum and maximum exposures (${candidates.length} candidates for ${count} requested). No regenerated lineups were saved. ${reason}`);
  }
  const lineups = selected.map(i => candidates[i]);
  const achieved = selected.map(i => infos[i]);
  const actualCount = lineups.length;
  const normalSet = new Set(normalSelection);
  // If the hard-valid completion required an unconstrained re-selection, treat
  // every returned lineup as fallback rather than claiming accidental overlap.
  const normalFormulaCount = preservedNormalSelection ? selected.filter(i => normalSet.has(i)).length : 0;
  const fallbackCount = Math.max(0, actualCount - normalFormulaCount);
  const adjustedTargets: string[] = [];
  if (fallbackCount > 0) {
    const finalTargets: Record<string, number> = {};
    for (const [k, n] of Object.entries(planNflMix(s.stackMix, actualCount))) finalTargets[`stack_${k}`] = n;
    for (const [k, n] of Object.entries(planNflMix(flexMix, actualCount))) finalTargets[`flex_${k}`] = n;
    if (!options.structureOnly) for (const [k, n] of Object.entries(planNflMix(s.qbSalaryMix, actualCount))) finalTargets[`qb_${k}`] = n;
    finalTargets.bringBack = Math.round(actualCount * s.bringBackPct / 100);
    finalTargets.secondary = Math.round(actualCount * s.secondaryStackPct / 100);
    const actualFor = (key: string) => achieved.filter(f =>
      key === "bringBack" ? f.bringBack :
      key === "secondary" ? f.secondary :
      key.startsWith("stack_") ? f.stack === key.slice(6) :
      key.startsWith("flex_") ? f.flex === key.slice(5) :
      key.startsWith("qb_") ? f.qbSalary === key.slice(3) : false).length;
    for (const [key, target] of Object.entries(finalTargets)) {
      const tolerance = target === 0 ? 0 : Math.max(1, Math.floor(actualCount * 0.02));
      if (Math.abs(actualFor(key) - target) > tolerance) adjustedTargets.push(key.replaceAll("_", " "));
    }
    if (!adjustedTargets.length) adjustedTargets.push("Formula mix bounds were softened during completion; the final mix still landed within configured tolerance.");
    warnings.push(`Adjusted-formula fallback supplied ${fallbackCount} lineup${fallbackCount === 1 ? "" : "s"} after the normal formula supplied ${normalFormulaCount}. ${ownership ? "Fallback ranking combined projected outcome (70%) with lower ownership (30%)." : "Ownership was unavailable, so fallback ranking used projected outcome only."}`);
  }
  const limitingCriteria = actualCount < count
    ? requestedCapacityIssues.slice(0, 3)
    : [];
  if (actualCount < count && !limitingCriteria.length) {
    if ((base.projectedPointsFloor ?? 0) > 0 && projectionFloorRejected > 0) {
      limitingCriteria.push(`${candidates.length} candidates met the ${Number(base.projectedPointsFloor).toFixed(1)}-point projection floor; ${projectionFloorRejected} candidate solves were rejected below it.`);
    } else {
      limitingCriteria.push(selectionTimedOut || budgetReached || Date.now() >= deadline
        ? "The selection time budget expired before a full validated portfolio was found."
        : "The candidate set could not supply the requested structure and exposure combination.");
    }
  }
  const suggestions: string[] = [];
  if (limitingCriteria.some(x => x.includes("stack "))) suggestions.push("Reduce or rebalance the affected QB stack target.");
  if (limitingCriteria.some(x => x.includes("flex "))) suggestions.push("Expand the allowed FLEX positions or rebalance the FLEX target.");
  if (limitingCriteria.some(x => x.includes("secondary") || x.includes("bringBack"))) suggestions.push("Lower the affected correlation percentage.");
  if (limitingCriteria.some(x => x.includes("appearances"))) suggestions.push("Lower that player's minimum exposure or expand the eligible player pool.");
  if (limitingCriteria.some(x => x.includes("projection floor"))) suggestions.push("Lower the projection floor or expand the eligible player pool.");
  if (actualCount < count && !suggestions.length) suggestions.push("Expand the eligible player pool or reduce the requested lineup count, then retry.");
  const report: NflPortfolioReport = {
    requestedCount: count, generatedCount: actualCount, candidateCount: candidates.length, seed: s.seed,
    metrics: [], warnings, partial: actualCount < count,
    selectionStatus: actualCount === count ? "full" : selectionTimedOut || budgetReached || Date.now() >= deadline ? "timed_out" : "partial",
    limitingCriteria, suggestions,
    normalFormulaCount, fallbackCount,
    fallbackMode: fallbackCount > 0 ? ownership ? "projection_low_ownership" : "projection_only" : undefined,
    adjustedTargets: fallbackCount > 0 ? adjustedTargets : [],
    dataSources: {
      ownership: s.ownershipMode,
      vegas: options.vegasGames?.[0]?.source === "espn" ? "espn" : options.vegasGames?.[0]?.source === "odds_api" ? "odds_api" : "unavailable",
      ...(options.vegasGames?.[0]?.provider ? { vegasProvider: options.vegasGames[0].provider } : {}),
      ...(options.vegasGames?.[0]?.fetchedAt ? { vegasFetchedAt: options.vegasGames[0].fetchedAt } : {}),
      ...(options.vegasGames?.some(game => game.eventTime)
        ? { vegasEventTimes: Array.from(new Set(options.vegasGames.map(game => game.eventTime))).sort() }
        : {}),
      rushing: "manual",
    },
  };
  const metric = (key: string, label: string, target: number | null, value: number | null, unit: "lineups" | "percent" | "points" | "games" = "lineups", detail?: string) => {
    const structural = options.strictStructure && (key.startsWith("stack_") || key.startsWith("flex_") || key.startsWith("qb_") || ["bringBack", "secondary"].includes(key));
    const tolerance = structural && target ? Math.max(1, Math.floor(actualCount * 0.02)) : 0;
    report.metrics.push({ key, label, target, achieved: value, unit, status: value === null ? "unavailable" : target === null ? "info" : Math.abs(value - target) <= tolerance + 1e-9 ? "met" : "shortfall",
      detail: structural ? [detail, `Largest-remainder mix rounding; allowed deviation ±${tolerance} lineup(s). All exposure bounds remain exact.`].filter(Boolean).join(" ") : detail });
  };
  metric("count", "Unique lineups", count, lineups.length);
  for (const [k, n] of Object.entries(planNflMix(s.stackMix, actualCount))) metric(`stack_${k}`, `${k} QB stack`, n, achieved.filter(x => x.stack === k).length);
  for (const [k, n] of Object.entries(planNflMix(flexMix, actualCount))) metric(`flex_${k}`, `${k} FLEX`, n, achieved.filter(x => x.flex === k).length, "lineups", allowedFlex.includes(k) ? undefined : "Unavailable under hard FLEX mask; target adjusted to zero.");
  if (!options.structureOnly) for (const [k, n] of Object.entries(planNflMix(s.qbSalaryMix, actualCount))) metric(`qb_${k}`, `${k} QB salary`, n, achieved.filter(x => x.qbSalary === k).length);
  metric("bringBack", "QB game bring-back", Math.round(actualCount * s.bringBackPct / 100), achieved.filter(x => x.bringBack).length);
  metric("secondary", "Secondary skill pair outside QB game (same-team RB+WR/TE or opposing skills)", Math.round(actualCount * s.secondaryStackPct / 100), achieved.filter(x => x.secondary).length);
  metric("games", `Lineups with ${minGames}–${s.maxGames} games`, options.structureOnly ? null : actualCount, achieved.filter(x => x.games >= minGames && x.games <= s.maxGames).length);
  metric("lowOwned", "Lineups meeting low-owned minimum", ownership ? actualCount : null, ownership ? lineups.filter(x => x.lineup.filter((p: Player) => ownership!.get(p.id)! < s.lowOwnershipThreshold).length >= s.minLowOwnedPlayers).length : null);
  metric("ownershipSum", "Average ownership sum", ownership ? OWNERSHIP_TARGETS[s.fieldSize] : null, ownership ? lineups.reduce((n, x) => n + x.lineup.reduce((sum: number, p: Player) => sum + ownership!.get(p.id)!, 0), 0) / lineups.length : null, "percent");
  const preference = (key: string, label: string, enabled: boolean, predicate: (p: Player) => boolean, available = true) => {
    if (enabled) metric(key, label, null, available ? lineups.filter(x => x.lineup.some(predicate)).length : null);
  };
  preference("valueWr", "Lineups with WR below $4,500", s.preferValueWr, p => pos(p, ["WR"]) && p.salary < 4500);
  preference("homeTe", "Lineups with home TE", s.preferHomeTe, p => pos(p, ["TE"]) && parseGameInfo(p.gameInfo).home?.toUpperCase() === team(p), eligible.some(p => !!parseGameInfo(p.gameInfo).home));
  preference("lowOwnedWr", "Lineups with low-owned WR", s.preferLowOwnedWr, p => pos(p, ["WR"]) && ownership!.get(p.id)! < s.lowOwnershipThreshold, !!ownership);
  preference("homeFavoriteDst", "Lineups with verified home-favorite DST", s.preferHomeFavoriteDst, p => pos(p, ["DST", "DEF"]) && favoriteGames.some(g => normalizeNFLTeam(g.homeTeam) === normalizeNFLTeam(team(p)) && g.favoriteTeam === g.homeTeam), favoriteGames.length > 0);
  preference("lowTotalGames", `QB stacked games below ${s.gameTotalThreshold}`, s.preferLowTotalGames, p => pos(p, ["QB"]) && totalGames.some(g => g.gameKey === stackGameKey(p.gameInfo) && g.total < s.gameTotalThreshold), totalGames.length > 0);
  const upside = (p: Player) => {
    const value = (p as any).upside ?? (p as any).ceiling;
    return value == null || value === "" ? NaN : Number(value);
  };
  preference("fourXUpside", "Lineups with supplied 4x salary upside", s.preferFourXUpside, p => Number.isFinite(upside(p)) && upside(p) >= p.salary / 1000 * 4, eligible.some(p => Number.isFinite(upside(p))));
  if (s.preferFourXUpside && !eligible.some(p => Number.isFinite(upside(p)))) warnings.push("No actual upside/ceiling field available; 4x upside preference is unavailable (not fabricated).");
  if (report.partial) warnings.push(`Partial portfolio: generated ${actualCount} of ${count} requested lineups. Active constraints limited the result; every hard rule was preserved and all percentages use the ${actualCount}-lineup batch.`);
  if (report.metrics.some(m => m.status === "shortfall")) warnings.push("Some soft portfolio targets were relaxed; see requested versus achieved metrics. Hard lineup and exposure requirements were not relaxed.");
  return { lineups, report };
}