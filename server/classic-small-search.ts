/** Bounded exact subset search for small Classic portfolios. The caller still
 * validates the result against the complete selection model before using it. */
export function searchSmallClassic(model: any, count: number, deadline: number): any | undefined {
  if (count > 10) return undefined;
  const names = Object.keys(model.variables).filter(k => /^l\d+$/.test(k))
    .sort((a, b) => model.variables[b].score - model.variables[a].score);
  const rows = names.map(name => model.variables[name]);
  // Soft preference equalities have their own slack variables; everything else
  // in a small portfolio is a nonnegative sum of selected lineup coefficients.
  const limits = Object.entries(model.constraints).filter(([key]) =>
    !key.startsWith("one_") && !key.startsWith("different_") &&
    !key.startsWith("naked_") && key !== "punts" && key !== "chalk");
  const conflict = names.map((name, i) => new Set<number>());
  const pairKeys = new Map<string, number>();
  names.forEach((name, i) => {
    for (const key of Object.keys(model.variables[name])) if (key.startsWith("different_")) {
      const previous = pairKeys.get(key);
      if (previous !== undefined) { conflict[i].add(previous); conflict[previous].add(i); }
      else pairKeys.set(key, i);
    }
  });
  const sums: Record<string, number> = {};
  let visits = 0;
  function search(available: number[], picked: number[]): number[] | undefined {
    if (++visits % 128 === 0 && Date.now() >= deadline) return undefined;
    const left = count - picked.length;
    if (available.length < left) return undefined;
    for (const [key, raw] of limits) {
      const bound = raw as any, current = sums[key] || 0;
      if (current > (bound.max ?? bound.equal ?? Infinity) + 1e-7) return undefined;
      const min = bound.min ?? bound.equal ?? 0;
      if (current < min) {
        const potential = available.map(i => rows[i][key] || 0).sort((a,b) => b-a).slice(0,left).reduce((a,b)=>a+b,0);
        if (current + potential < min - 1e-7) return undefined;
      }
    }
    if (!left) return picked;
    for (let offset = 0; offset <= available.length - left; offset++) {
      if (Date.now() >= deadline) break;
      const i = available[offset], row = rows[i];
      for (const [key] of limits) sums[key] = (sums[key] || 0) + (row[key] || 0);
      const next = available.slice(offset + 1).filter(j => !conflict[i].has(j) &&
        limits.every(([key, raw]) => (sums[key] || 0) + (rows[j][key] || 0) <= ((raw as any).max ?? (raw as any).equal ?? Infinity) + 1e-7));
      const found = search(next, [...picked, i]);
      for (const [key] of limits) sums[key] -= row[key] || 0;
      if (found) return found;
    }
    return undefined;
  }
  const selected = search(names.map((_, i) => i), []);
  if (!selected) return undefined;
  const result: any = { feasible: true, isIntegral: true };
  for (const i of selected) result[names[i]] = 1;
  for (const key of ["punts", "chalk"]) {
    const total = selected.reduce((sum, i) => sum + (rows[i][key] || 0), 0);
    const delta = model.constraints[key].equal - total;
    result[`${key}_under`] = Math.max(0, delta);
    result[`${key}_over`] = Math.max(0, -delta);
  }
  return result;
}
