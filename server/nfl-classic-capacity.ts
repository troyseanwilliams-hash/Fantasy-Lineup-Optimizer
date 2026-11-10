import type { Player } from "@shared/schema";

const pos = (p: Player) => p.position.toUpperCase().split("/")[0];
export const classicMaxUses = (pct: number, count: number) => Math.floor(pct * count / 100 + 1e-8);

// Necessary conditions only: passing these checks does not prove feasibility.
export function classicCapacityIssue(pool: Player[], maximum: Map<number, number>, count: number, floor?: number): string | undefined {
  const uses = (p: Player) => classicMaxUses(maximum.get(p.id) ?? 0, count);
  for (const [position, slots] of [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["DST", 1]] as const) {
    const capacity = pool.filter(p => pos(p) === position).reduce((n, p) => n + uses(p), 0);
    if (capacity < count * slots) return `${position} exposure capacity is ${capacity} appearances, but ${count} lineups require at least ${count * slots}. Add eligible ${position} players or remove conflicting exclusions/maxima; strict caps are unchanged.`;
  }
  const skill = pool.filter(p => ["RB", "WR", "TE"].includes(pos(p)));
  if (skill.reduce((n, p) => n + uses(p), 0) < 7 * count) return `Skill-player exposure capacity cannot fill ${7 * count} slots across ${count} lineups under strict caps. Broaden the eligible player pool.`;
  if (floor !== undefined) {
    // Optimistic aggregate bound: ignore salary, stacking and skill-position
    // requirements. If even this cannot meet quality, the actual set cannot.
    const upper = (rows: Player[], slots: number) => rows.flatMap(p => Array(uses(p)).fill(Number(p.projectedPoints)) as number[])
      .sort((a, b) => b - a).slice(0, slots).reduce((a, b) => a + b, 0);
    const total = upper(pool.filter(p => pos(p) === "QB"), count)
      + upper(pool.filter(p => pos(p) === "DST"), count) + upper(skill, 7 * count);
    if (total + 1e-6 < floor * count) return `Strict exposure caps allow at most ${(total / count).toFixed(2)} projected points per lineup on average, below the required ${floor.toFixed(2)}-point floor. Broaden the pool or try a larger batch; neither caps nor the quality floor were lowered.`;
  }
}
