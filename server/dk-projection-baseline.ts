/** Missing scoring data is not a historical average or evidence of workload. */
export function dkProjectionBaseline(
  sport: string,
  position: string,
  salary: number,
  reportedFppg: number | null,
  showdown = false,
): { fppg: string; projectedPoints: string } {
  if (reportedFppg !== null && Number.isFinite(reportedFppg)) {
    return { fppg: reportedFppg.toFixed(1), projectedPoints: reportedFppg.toFixed(1) };
  }
  if (showdown) return { fppg: "0.0", projectedPoints: "0.0" };
  if (sport === "NFL") {
    // Conservative priors, not empirical rankings. Salary alone cannot establish
    // a rookie's workload. Preserve DST eligibility with its own prior.
    const caps: Record<string, number> = { QB: 14, RB: 10, WR: 8, TE: 6, DST: 8 };
    const estimate = Math.min(Math.max(0, salary) / 500, caps[position] ?? 6);
    return { fppg: "0.0", projectedPoints: estimate.toFixed(1) };
  }
  const estimate = (salary / 250).toFixed(1);
  return { fppg: estimate, projectedPoints: estimate };
}