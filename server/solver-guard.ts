import solver from "javascript-lp-solver";

/**
 * javascript-lp-solver checks model.timeout while it is walking the
 * branch-and-cut tree.  Keep a small default here as a second line of
 * defence for callers that do not have a request deadline.
 */
export const DEFAULT_SOLVER_TIMEOUT_MS = 2_000;

export interface SolverBudget {
  /** Absolute wall-clock deadline for the request, in milliseconds. */
  deadline?: number;
  /** Maximum time for this individual solve, in milliseconds. */
  timeoutMs?: number;
}

export interface GuardedSolveResult {
  result: any | null;
  elapsedMs: number;
  timeoutMs: number;
  timedOut: boolean;
}

export function remainingSolverTime(
  budget: SolverBudget = {},
  defaultTimeoutMs = DEFAULT_SOLVER_TIMEOUT_MS,
): number {
  const requested = Number.isFinite(budget.timeoutMs)
    ? Math.max(0, Math.floor(budget.timeoutMs!))
    : defaultTimeoutMs;
  const remaining = budget.deadline === undefined
    ? requested
    : Math.min(requested, Math.max(0, budget.deadline - Date.now()));
  return Math.max(0, Math.floor(remaining));
}

/**
 * Apply the package's supported timeout options and solve synchronously.
 *
 * The package cannot interrupt JavaScript while it is in a single simplex
 * operation, but the model timeout bounds branch-and-cut work and prevents
 * the unbounded repeated solves which caused optimizer requests to occupy
 * the event loop.  Both documented forms are set deliberately: v1.0.3 gives
 * options.timeout precedence over the top-level value.
 */
export function solveWithBudget(
  model: any,
  budget: SolverBudget = {},
): GuardedSolveResult {
  const timeoutMs = remainingSolverTime(budget);
  if (timeoutMs <= 0) {
    return { result: null, elapsedMs: 0, timeoutMs: 0, timedOut: true };
  }

  model.timeout = timeoutMs;
  model.options = { ...(model.options || {}), timeout: timeoutMs };

  const startedAt = Date.now();
  const result = solver.Solve(model);
  const elapsedMs = Date.now() - startedAt;
  return {
    result,
    elapsedMs,
    timeoutMs,
    timedOut: elapsedMs >= timeoutMs,
  };
}

/**
 * A timed-out MIP may leave a feasible LP relaxation in the result object.
 * That is not a roster and must never be exposed to callers.  Require an
 * integral incumbent and validate every model constraint before consuming any
 * variable values.
 */
export function validatedIntegralResult(result: any, model: any): any | null {
  if (!result || result.feasible !== true || result.isIntegral !== true) return null;

  const values = new Map<string, number>();
  for (const variableName of Object.keys(model.variables || {})) {
    const value = result[variableName] === undefined ? 0 : Number(result[variableName]);
    if (!Number.isFinite(value)) return null;
    values.set(variableName, value);
  }

  for (const variableName of Object.keys(model.ints || {})) {
    const value = values.get(variableName) ?? 0;
    if (Math.abs(value - Math.round(value)) > 1e-6) return null;
  }
  for (const variableName of Object.keys(model.binaries || {})) {
    const value = values.get(variableName) ?? 0;
    if (value < -1e-6 || value > 1 + 1e-6 || Math.abs(value - Math.round(value)) > 1e-6) return null;
  }

  const tolerance = 1e-6;
  const totals = new Map<string, number>();
  for (const [variableName, coefficients] of Object.entries(model.variables || {}) as [string, any][]) {
    for (const [constraintName, rawCoefficient] of Object.entries(coefficients)) {
      if (!Object.prototype.hasOwnProperty.call(model.constraints, constraintName)) continue;
      const coefficient = Number(rawCoefficient);
      if (!Number.isFinite(coefficient)) return null;
      totals.set(constraintName, (totals.get(constraintName) ?? 0) + coefficient * (values.get(variableName) ?? 0));
    }
  }
  for (const [constraintName, bound] of Object.entries(model.constraints || {}) as [string, any][]) {
    const leftHandSide = totals.get(constraintName) ?? 0;
    if (bound.equal !== undefined && Math.abs(leftHandSide - Number(bound.equal)) > tolerance) return null;
    if (bound.min !== undefined && leftHandSide < Number(bound.min) - tolerance) return null;
    if (bound.max !== undefined && leftHandSide > Number(bound.max) + tolerance) return null;
  }

  return result;
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}