import type { GppPlayer, ShowdownStrategyConfig, StrategyLineup, StrategyResult } from "./nfl-gpp-types";

export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function correlationMultiplier(c: GppPlayer, p: GppPlayer): number {
  const same = c.team === p.team;
  if (c.pos === "QB") {
    if (same && ["WR", "TE"].includes(p.pos)) return 1.25;
    if (same && p.pos === "RB") return 1.12;
    if (!same && p.pos === "DST") return 0.75;
  }
  if (c.pos === "RB") {
    if (same && ["DST", "K"].includes(p.pos)) return 1.25;
    if ((same && p.pos === "RB") || (!same && p.pos === "QB")) return 1.12;
  }
  if (c.pos === "WR") {
    if (same && p.pos === "QB") return 1.25;
    if (same && ["K", "RB"].includes(p.pos)) return 1.12;
    if (same && p.pos === "WR") return 0.75;
  }
  if (c.pos === "TE") {
    if (same && p.pos === "QB") return 1.25;
    if (!same && ["QB", "WR"].includes(p.pos)) return 1.12;
    if (["K", "DST"].includes(p.pos) || (same && p.pos === "TE")) return 0.75;
  }
  return 1;
}
export function captainLaws(c: GppPlayer, flex: GppPlayer[]): boolean {
  if (c.pos === "QB") return flex.some(p => p.team === c.team && ["WR", "TE"].includes(p.pos));
  if (["WR", "TE"].includes(c.pos)) return flex.some(p => p.team === c.team && p.pos === "QB");
  if (c.pos === "RB") return flex.some(p => p.team === c.team && p.pos === "DST") &&
    flex.some(p => p.team !== c.team && ["QB", "RB", "WR", "TE"].includes(p.pos));
  return true;
}
function split(l: StrategyLineup, byId: Map<string, GppPlayer>, favorite: string): keyof ShowdownStrategyConfig["splitTargets"] | null {
  const n = [l.captain, ...l.flex].filter(id => byId.get(id)!.team === favorite).length;
  return n === 4 ? "favorite42" : n === 2 ? "underdog42" : n === 3 ? "balanced33" : n === 1 || n === 5 ? "fiveOne" : null;
}
export function rosterDifference(a: StrategyLineup, b: StrategyLineup): number {
  const roster = new Set([a.captain, ...a.flex]);
  return [b.captain, ...b.flex].filter(id => !roster.has(id)).length;
}
function makeLineup(c: GppPlayer, flex: GppPlayer[]): StrategyLineup {
  return {
    captain: c.id, flex: flex.map(p => p.id),
    salary: c.cptSalary + flex.reduce((s, p) => s + p.flexSalary, 0),
    projection: c.projection * 1.5 + flex.reduce((s, p) => s + p.projection, 0),
    ownership: c.cptOwn + flex.reduce((s, p) => s + p.flexOwn, 0),
  };
}
export function legalShowdownLineup(l: StrategyLineup, byId: Map<string, GppPlayer>): boolean {
  const c = byId.get(l.captain);
  const flex = l.flex.map(id => byId.get(id));
  if (!c || flex.length !== 5 || flex.some(p => !p) || new Set([l.captain, ...l.flex]).size !== 6) return false;
  const all = [c, ...flex as GppPlayer[]];
  const actual = makeLineup(c, flex as GppPlayer[]);
  return actual.salary <= 50000 && actual.ownership <= 190 + 1e-8 &&
    all.filter(p => p.pos === "K").length <= 1 && all.filter(p => p.pos === "DST").length <= 1 &&
    new Set(all.map(p => p.team)).size === 2 && captainLaws(c, flex as GppPlayer[]);
}
export function defaultShowdownConfig(players: GppPlayer[], count = 20): ShowdownStrategyConfig {
  const eligible = players.filter(p => p.projection > 0);
  const rank = (p: GppPlayer) => p.projection / Math.sqrt(Math.max(1, p.cptOwn));
  const sorted = [...eligible].sort((a, b) => rank(b) - rank(a));
  const captains = Array.from(new Set([
    ...eligible.filter(p => p.pos === "QB").map(p => p.id),
    ...sorted.slice(0, 8).map(p => p.id),
  ])).slice(0, count);
  const captainPlan: Record<string, number> = Object.fromEntries(players.map(p => [p.id, 0]));
  for (const id of captains) captainPlan[id] = 1;
  for (let i = captains.length; i < count && captains.length; i++) {
    const id = captains.reduce((a, b) =>
      rank(eligible.find(p => p.id === a)!) / (captainPlan[a] + 1) >
      rank(eligible.find(p => p.id === b)!) / (captainPlan[b] + 1) ? a : b);
    captainPlan[id]++;
  }
  const ratios = [6, 4, 6, 3];
  const values = ratios.map(v => Math.floor(v / 19 * count));
  const remainder = ratios.map((v, i) => ({ i, r: v / 19 * count - values[i] })).sort((a, b) => b.r - a.r);
  for (let n = count - values.reduce((s, v) => s + v, 0), i = 0; i < n; i++) values[remainder[i].i]++;
  return {
    seed: "nfl-showdown-1", count, captainPlan,
    flexMinimums: Object.fromEntries(players.map(p => [p.id, p.projection <= 0 ? 0 : ["K", "DST"].includes(p.pos) || p.flexSalary < 4500 ? 1 : count >= 19 ? 2 : 1])),
    flexTargets: {}, excludedIds: [], favoriteTeam: players[0]?.team || "",
    splitTargets: { favorite42: values[0], underdog42: values[1], balanced33: values[2], fiveOne: values[3] },
    kickerTarget: Math.round(count * 9 / 19),
  };
}
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function buildShowdownPortfolio(input: GppPlayer[], config: ShowdownStrategyConfig): Promise<StrategyResult> {
  if (!Number.isInteger(config.count) || config.count < 1 || config.count > 150) throw new Error("Request 1–150 lineups.");
  if (!config.seed.trim()) throw new Error("Enter a seed for reproducible builds.");
  if (input.length < 6 || input.length > 60 || new Set(input.map(p => p.id)).size !== input.length) throw new Error("Supply 6–60 unique players.");
  for (const p of input) {
    if (![p.projection, p.flexSalary, p.cptSalary, p.cptOwn, p.flexOwn].every(Number.isFinite) ||
        p.projection < 0 || p.flexSalary <= 0 || p.cptSalary !== p.flexSalary * 1.5 ||
        p.cptOwn < 0 || p.cptOwn > 100 || p.flexOwn < 0 || p.flexOwn > 100) throw new Error(`Invalid salary, projection or ownership for ${p.name}.`);
  }
  const excluded = new Set(config.excludedIds);
  const pool = input.filter(p => !excluded.has(p.id) && p.projection > 0);
  const byId = new Map(pool.map(p => [p.id, p]));
  if (new Set(pool.map(p => p.team)).size !== 2 || !pool.some(p => p.team === config.favoriteTeam)) throw new Error("Select the favorite from the two eligible teams.");
  const maps = [config.captainPlan, config.flexMinimums, config.flexTargets];
  for (const map of maps) for (const [id, n] of Object.entries(map)) {
    if (!Number.isInteger(n) || n < 0 || n > config.count) throw new Error("Captain and exposure counts must be whole numbers within the set size.");
    if (n && !byId.has(id)) throw new Error("A captain/exposure target references an excluded or zero-projection player. Clear its targets first.");
  }
  if (Object.values(config.captainPlan).reduce((s, n) => s + n, 0) !== config.count) throw new Error("Captain counts must sum to the lineup count.");
  if (Object.values(config.splitTargets).some(n => !Number.isInteger(n) || n < 0) ||
      Object.values(config.splitTargets).reduce((s, n) => s + n, 0) !== config.count) throw new Error("Team-split counts must sum to the lineup count.");
  if (!Number.isInteger(config.kickerTarget) || config.kickerTarget < 0 || config.kickerTarget > config.count) throw new Error("Kicker target must be a whole number within the lineup count.");
  const minimum = Object.fromEntries(pool.map(p => [p.id, Math.max(
    config.flexMinimums[p.id] || 0, config.flexTargets[p.id] || 0,
    p.flexSalary < 4500 && ["QB", "RB", "WR", "TE"].includes(p.pos) ? 1 : 0,
  )]));
  for (const p of pool) if (minimum[p.id] + (config.captainPlan[p.id] || 0) > config.count) throw new Error(`${p.name}: captain shares plus required FLEX appearances exceed the set size.`);
  if (Object.values(minimum).reduce((s, n) => s + n, 0) > config.count * 5) throw new Error("FLEX minimums/targets exceed the available FLEX slots.");
  for (const pos of ["K", "DST"]) {
    if (pool.filter(p => p.pos === pos).reduce((s, p) => s + minimum[p.id] + (config.captainPlan[p.id] || 0), 0) > config.count) throw new Error(`${pos} targets exceed the one-per-lineup limit.`);
  }
  const rng = seededRandom(config.seed);
  const pick = (players: GppPlayer[], captain: GppPlayer, counts: Record<string, number>) => {
    const weights = players.map(p => p.projection * correlationMultiplier(captain, p) * (1 + 0.5 * Math.max(0, 2 - (counts[p.id] || 0))));
    let r = rng() * weights.reduce((s, w) => s + w, 0);
    return players[weights.findIndex(w => (r -= w) <= 0)] || players[players.length - 1];
  };
  const captains = pool.filter(p => config.captainPlan[p.id] > 0);
  const candidates = new Map<string, StrategyLineup[]>();
  // Sample law-first lineups once. Reuse this deterministic catalog for repair.
  for (const c of captains) {
    const found = new Map<string, StrategyLineup>();
    const seenFlex: Record<string, number> = {};
    for (let attempt = 0; attempt < 18000 && found.size < 650; attempt++) {
      if (attempt % 1000 === 0) await delay();
      const selected: GppPlayer[] = [];
      const add = (predicate: (p: GppPlayer) => boolean) => {
        const options = pool.filter(p => p.id !== c.id && !selected.includes(p) && predicate(p));
        if (!options.length) return false;
        selected.push(pick(options, c, seenFlex)); return true;
      };
      if (c.pos === "QB" && !add(p => p.team === c.team && ["WR", "TE"].includes(p.pos))) continue;
      if (["WR", "TE"].includes(c.pos) && !add(p => p.team === c.team && p.pos === "QB")) continue;
      if (c.pos === "RB" && (!add(p => p.team === c.team && p.pos === "DST") ||
          !add(p => p.team !== c.team && ["QB", "RB", "WR", "TE"].includes(p.pos)))) continue;
      while (selected.length < 5) {
        if (!add(p => c.cptSalary + selected.reduce((s, q) => s + q.flexSalary, 0) + p.flexSalary <= 50000 &&
          (!["K", "DST"].includes(p.pos) || ![c, ...selected].some(q => q.pos === p.pos)))) break;
      }
      const l = makeLineup(c, selected);
      if (!legalShowdownLineup(l, byId)) continue;
      const k = [...l.flex].sort().join(";");
      if (!found.has(k)) {
        found.set(k, l);
        for (const p of selected) seenFlex[p.id] = (seenFlex[p.id] || 0) + 1;
      }
    }
    if (!found.size) throw new Error(`No legal candidates for captain ${c.name}. Check its law-required teammates, ownership and salaries.`);
    candidates.set(c.id, Array.from(found.values()));
    await delay();
  }
  const hasK = (l: StrategyLineup) => [l.captain, ...l.flex].some(id => byId.get(id)!.pos === "K");
  const stats = (ls: StrategyLineup[]) => {
    const flex: Record<string, number> = {};
    const splits = { favorite42: 0, underdog42: 0, balanced33: 0, fiveOne: 0 };
    let kickers = 0;
    for (const l of ls) {
      for (const id of l.flex) flex[id] = (flex[id] || 0) + 1;
      splits[split(l, byId, config.favoriteTeam)!]++;
      if (hasK(l)) kickers++;
    }
    return { flex, splits, kickers };
  };
  const penalty = (ls: StrategyLineup[]) => {
    const s = stats(ls);
    return Object.entries(minimum).reduce((n, [id, m]) => n + Math.max(0, m - (s.flex[id] || 0)), 0) +
      Object.entries(config.splitTargets).reduce((n, [k, t]) => n + Math.abs(t - s.splits[k as keyof typeof s.splits]), 0) +
      Math.abs(config.kickerTarget - s.kickers);
  };
  const compatible = (l: StrategyLineup, ls: StrategyLineup[], skip = -1) => ls.every((q, i) => i === skip || rosterDifference(l, q) >= 2);
  let result: StrategyLineup[] | null = null, bestPenalty = Infinity;
  let evaluations = 0;
  const budget = Math.min(2_000_000, 150_000 + config.count * 10_000);
  const order = captains.flatMap(p => Array.from({ length: config.captainPlan[p.id] }, () => p.id));
  search: for (let restart = 0; restart < 120 && !result; restart++) {
    const plan = [...order];
    for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
    const built: StrategyLineup[] = [];
    for (const id of plan) {
      const s = stats(built);
      let winner: StrategyLineup | undefined, best = -Infinity;
      for (const l of candidates.get(id)!) {
        if (++evaluations > budget) break search;
        if (!compatible(l, built)) continue;
        const category = split(l, byId, config.favoriteTeam)!;
        if (s.splits[category] >= config.splitTargets[category] || (hasK(l) && s.kickers >= config.kickerTarget)) continue;
        const coverage = l.flex.reduce((n, p) => n + Math.max(0, minimum[p] - (s.flex[p] || 0)), 0);
        const score = coverage * 20 + l.projection / 100 + rng() * (restart % 3 === 0 ? 40 : 15) +
          (hasK(l) && s.kickers < config.kickerTarget ? 8 : 0);
        if (score > best) { best = score; winner = l; }
      }
      if (!winner) break;
      built.push(winner);
    }
    if (built.length === config.count) {
      // Minimum-exposure and target repair through same-captain replacements.
      for (let pass = 0; pass < 12; pass++) {
        let current = penalty(built);
        if (!current) break;
        let changed = false;
        for (let i = 0; i < built.length; i++) {
          const old = built[i];
          let winner = old, best = current;
          for (const l of candidates.get(old.captain)!) {
            if (++evaluations > budget) break search;
            if (!compatible(l, built, i)) continue;
            built[i] = l;
            const p = penalty(built);
            if (p < best) { best = p; winner = l; }
          }
          built[i] = winner;
          if (best < current) { current = best; changed = true; }
        }
        if (!changed) break;
        await delay();
      }
      bestPenalty = Math.min(bestPenalty, penalty(built));
      if (!penalty(built)) result = built;
    }
    await delay();
  }
  if (!result) throw new Error(`Search exhausted without a complete valid portfolio${Number.isFinite(bestPenalty) ? ` (${bestPenalty} target appearances unresolved in the closest set)` : ""}. No lineups were exported. Try another seed, more captain diversity, or revise exposure/team-split targets. Hard constraints were not relaxed.`);
  const preserves = (ls: StrategyLineup[]) => !penalty(ls) && ls.every((l, i) => legalShowdownLineup(l, byId) && compatible(l, ls, i));
  // Only flex players not essential to the captain law may be moved.
  const movable = (l: StrategyLineup, id: string) => captainLaws(byId.get(l.captain)!, l.flex.filter(p => p !== id).map(p => byId.get(p)!));
  // Hill climb below $47k, preserving team splits, exposure targets and captain.
  for (let index = 0; index < result.length; index++) {
    for (let pass = 0; pass < 10 && result[index].salary < 47000; pass++) {
      const old = result[index], c = byId.get(old.captain)!;
      let winner = old;
      for (let slot = 0; slot < 5; slot++) {
        if (!movable(old, old.flex[slot])) continue;
        for (const p of pool) {
          if (p.team !== byId.get(old.flex[slot])!.team || [old.captain, ...old.flex].includes(p.id)) continue;
          const ids = [...old.flex]; ids[slot] = p.id;
          const next = makeLineup(c, ids.map(id => byId.get(id)!));
          if (next.projection <= winner.projection + 1e-8) continue;
          result[index] = next;
          if (preserves(result)) winner = next;
        }
      }
      result[index] = winner;
      if (winner === old) break;
    }
    await delay();
  }
  // Atomic two-lineup moves transfer a protected punt while upgrading its source.
  for (let attempt = 0; attempt < 2500; attempt++) {
    const a = Math.floor(rng() * result.length), b = Math.floor(rng() * result.length);
    if (a === b || result[a].salary >= 47000) continue;
    const oldA = result[a], oldB = result[b];
    const sa = Math.floor(rng() * 5), sb = Math.floor(rng() * 5);
    const punt = byId.get(oldA.flex[sa])!;
    if (punt.flexSalary >= 4500 || !movable(oldA, punt.id) || !movable(oldB, oldB.flex[sb]) ||
        [oldB.captain, ...oldB.flex].includes(punt.id) || byId.get(oldB.flex[sb])!.team !== punt.team) continue;
    const upgrades = pool.filter(p => p.team === punt.team && p.projection > punt.projection && ![oldA.captain, ...oldA.flex].includes(p.id));
    if (!upgrades.length) continue;
    const upgrade = upgrades[Math.floor(rng() * upgrades.length)];
    const fa = [...oldA.flex], fb = [...oldB.flex]; fa[sa] = upgrade.id; fb[sb] = punt.id;
    const nextA = makeLineup(byId.get(oldA.captain)!, fa.map(id => byId.get(id)!));
    const nextB = makeLineup(byId.get(oldB.captain)!, fb.map(id => byId.get(id)!));
    if (nextA.projection + nextB.projection <= oldA.projection + oldB.projection + 1e-8) continue;
    result[a] = nextA; result[b] = nextB;
    if (!preserves(result)) { result[a] = oldA; result[b] = oldB; }
    if (attempt % 100 === 0) await delay();
  }
  if (!preserves(result) || result.length !== config.count || captains.some(p => result!.filter(l => l.captain === p.id).length !== config.captainPlan[p.id])) throw new Error("Final portfolio audit failed. No export produced.");
  const s = stats(result);
  const summary = [
    "# NFL Showdown GPP portfolio", `Seed: ${config.seed}`, `Lineups: ${result.length}`,
    "Captain laws enforced. Selection uses correlation weights; reported projections are raw (CPT × 1.5).",
    "Audited: $50,000 cap; ≤190% slot-specific ownership; ≤1 K and ≤1 DST; both teams; ≥2 roster differences between every pair. No uniqueness relaxation.",
    `Favorite: ${config.favoriteTeam}. Team splits: ${JSON.stringify(s.splits)}. Kicker lineups: ${s.kickers}/${config.kickerTarget}.`,
    "\n| Player | CPT | FLEX | FLEX minimum/target |\n|---|---:|---:|---:|",
    ...pool.map(p => `| ${p.name} | ${config.captainPlan[p.id] || 0} | ${s.flex[p.id] || 0} | ${minimum[p.id]} |`),
    "\n| Lineup | Captain | FLEX | Salary | Raw projection | Ownership |\n|---|---|---|---:|---:|---:|",
    ...result.map((l, i) => `| ${i + 1} | ${byId.get(l.captain)!.name} | ${l.flex.map(id => byId.get(id)!.name).join(", ")} | ${l.salary} | ${l.projection.toFixed(2)} | ${l.ownership.toFixed(2)}% |`),
  ].join("\n");
  return { lineups: result, seed: config.seed, summary };
}
