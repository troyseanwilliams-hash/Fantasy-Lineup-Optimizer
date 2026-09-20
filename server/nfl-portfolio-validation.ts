import { z } from "zod";
import type { OptimizationConstraints, Player } from "@shared/schema";
import {
  DEFAULT_NFL_PORTFOLIO,
  nflPortfolioSettingsSchema,
  type NflPortfolioReport,
  type NflPortfolioSettings,
} from "@shared/nfl-portfolio";
import type { VegasGameOdds } from "./vegas-client";
import { generateNflPortfolio } from "./nfl-portfolio";

const isoTimestamp = z.string().datetime({ offset: true });
const finiteRecord = z.record(z.string(), z.number().finite());
const playerSchema = z.object({
  id: z.number().int().positive(),
  slateId: z.number().int(),
  name: z.string().min(1),
  team: z.string().min(1),
  position: z.string().min(1),
  salary: z.number().int().nonnegative(),
  fppg: z.union([z.string(), z.number()]),
  projectedPoints: z.union([z.string(), z.number()]),
  opponent: z.string().nullable().optional(),
  gameInfo: z.string().nullable().optional(),
  injuryStatus: z.string().nullable().optional(),
  injuryDetail: z.string().nullable().optional(),
  boostScore: z.union([z.string(), z.number()]).nullable().optional(),
  boostReason: z.string().nullable().optional(),
  draftKingsPlayerId: z.number().int().nullable().optional(),
  fanDuelPlayerId: z.number().int().nullable().optional(),
  yahooPlayerId: z.string().nullable().optional(),
  fanDuelSalary: z.number().int().nullable().optional(),
  yahooSalary: z.number().int().nullable().optional(),
  isConfirmedStarter: z.boolean().nullable().optional(),
}).strip().superRefine((player, ctx) => {
  for (const field of ["projectedPoints", "fppg"] as const) {
    const value = Number(player[field]);
    if (!Number.isFinite(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} must be finite` });
    }
  }
});

const constraintsSchema = z.object({
  slateId: z.number().int().positive(),
  lockedPlayerIds: z.array(z.number().int().positive()).default([]),
  excludedPlayerIds: z.array(z.number().int().positive()).default([]),
  totalMinSalary: z.number().int().nonnegative().optional(),
  totalMaxSalary: z.number().int().nonnegative().optional(),
  playerMinSalary: z.number().int().nonnegative().optional(),
  playerMaxSalary: z.number().int().nonnegative().optional(),
  playerProjections: finiteRecord.optional(),
  minProjection: z.number().finite().nonnegative().optional(),
  projectedPointsFloor: z.number().finite().nonnegative().optional(),
  contestType: z.enum(["cash", "gpp"]).optional(),
  outperformerMode: z.boolean().optional(),
  flexAllowedPositions: z.array(z.enum(["RB", "WR", "TE"])).min(1).optional(),
}).strict();

const provenanceSchema = z.object({
  projections: isoTimestamp,
  settings: isoTimestamp,
  ownership: isoTimestamp.nullable(),
  vegas: isoTimestamp.nullable(),
}).strict();

const ownershipSchema = z.object({
  source: z.string().trim().min(1),
  provenance: z.enum(["provided", "estimated"]),
  values: finiteRecord.refine(values => Object.values(values).every(value => value >= 0 && value <= 100), {
    message: "Ownership values must be between 0 and 100.",
  }),
}).strict();

const vegasGameSchema = z.object({
  gameKey: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  total: z.number().finite(),
  homeImplied: z.number().finite(),
  awayImplied: z.number().finite(),
  source: z.enum(["odds_api", "espn", "fallback"]),
  provider: z.string().min(1),
  eventTime: isoTimestamp,
  fetchedAt: isoTimestamp,
  updatedAt: isoTimestamp.nullable(),
  favoriteTeam: z.string().nullable(),
  spread: z.number().finite().positive().nullable(),
}).strict();

export const nflPortfolioValidationSnapshotSchema = z.object({
  version: z.literal(1),
  sport: z.literal("NFL"),
  platform: z.literal("draftkings"),
  gameType: z.literal("Classic"),
  slateStartTime: isoTimestamp,
  capturedAt: isoTimestamp,
  inputAsOf: provenanceSchema,
  pool: z.array(playerSchema).min(1),
  constraints: constraintsSchema,
  settings: nflPortfolioSettingsSchema,
  ownership: ownershipSchema.nullable(),
  vegasGames: z.array(vegasGameSchema).nullable(),
  actualPoints: finiteRecord.nullable(),
  actualPointsObservedAt: isoTimestamp.nullable(),
}).strict().superRefine((snapshot, ctx) => {
  const captured = Date.parse(snapshot.capturedAt);
  const lock = Date.parse(snapshot.slateStartTime);
  if (captured >= lock) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capturedAt"], message: "capturedAt must be before slateStartTime" });
  }
  for (const key of ["projections", "settings", "ownership", "vegas"] as const) {
    const asOf = snapshot.inputAsOf[key];
    if (asOf !== null && Date.parse(asOf) > captured) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputAsOf", key], message: `${key} provenance is later than capturedAt` });
    }
  }
  if ((snapshot.ownership === null) !== (snapshot.inputAsOf.ownership === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ownership"], message: "Ownership data and provenance must either both be present or both be null" });
  }
  if (snapshot.settings.ownershipMode !== "off") {
    if (!snapshot.ownership) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ownership"], message: "Enabled ownership mode requires archived ownership provenance" });
    } else if (snapshot.ownership.provenance !== snapshot.settings.ownershipMode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ownership", "provenance"], message: "Ownership provenance must match the configured ownership mode" });
    }
  }
  if (Object.keys(snapshot.settings.ownershipOverrides).length > 0 && snapshot.settings.ownershipMode !== "off" && !snapshot.ownership) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["settings", "ownershipOverrides"], message: "Pre-lock ownership provenance is required for overrides" });
  }
  if ((snapshot.vegasGames === null) !== (snapshot.inputAsOf.vegas === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vegasGames"], message: "Vegas data and provenance must either both be present or both be null" });
  }
  if ((snapshot.actualPoints === null) !== (snapshot.actualPointsObservedAt === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actualPoints"], message: "Actual points require an observedAt timestamp" });
  }
  if (snapshot.actualPointsObservedAt && Date.parse(snapshot.actualPointsObservedAt) <= lock) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actualPointsObservedAt"], message: "Actual points must be observed after slate lock" });
  }
});

export type NflPortfolioValidationSnapshot = z.infer<typeof nflPortfolioValidationSnapshotSchema>;

export interface CreateNflPortfolioValidationSnapshotOptions {
  slateStartTime: string | Date;
  capturedAt: string | Date;
  projectionsAsOf: string | Date;
  settingsAsOf: string | Date;
  pool: Player[];
  constraints: Record<string, unknown>;
  settings?: NflPortfolioSettings;
  ownership?: {
    source: string;
    provenance: "provided" | "estimated";
    asOf: string | Date;
    values: Record<number, number>;
  } | null;
  vegas?: { asOf: string | Date; games: VegasGameOdds[] } | null;
  actuals?: { observedAt: string | Date; points: Record<number, number> } | null;
}

function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp");
  return date.toISOString();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

/**
 * Pure route helper. Unknown/current API provenance must be represented by
 * null ownership/vegas, never by a guessed timestamp.
 */
export function createNflPortfolioValidationSnapshot(
  options: CreateNflPortfolioValidationSnapshotOptions,
): Readonly<NflPortfolioValidationSnapshot> {
  const suppliedNumbers = [
    ...Object.values(options.ownership?.values ?? {}),
    ...Object.values(options.actuals?.points ?? {}),
  ];
  if (suppliedNumbers.some(value => !Number.isFinite(value))) {
    throw new Error("Ownership and actual-points values must be finite.");
  }
  const plain = JSON.parse(JSON.stringify({
    version: 1,
    sport: "NFL",
    platform: "draftkings",
    gameType: "Classic",
    slateStartTime: iso(options.slateStartTime),
    capturedAt: iso(options.capturedAt),
    inputAsOf: {
      projections: iso(options.projectionsAsOf),
      settings: iso(options.settingsAsOf),
      ownership: options.ownership ? iso(options.ownership.asOf) : null,
      vegas: options.vegas ? iso(options.vegas.asOf) : null,
    },
    pool: options.pool,
    constraints: options.constraints,
    settings: options.settings ?? DEFAULT_NFL_PORTFOLIO,
    ownership: options.ownership ? {
      source: options.ownership.source,
      provenance: options.ownership.provenance,
      values: options.ownership.values,
    } : null,
    vegasGames: options.vegas?.games ?? null,
    actualPoints: options.actuals?.points ?? null,
    actualPointsObservedAt: options.actuals ? iso(options.actuals.observedAt) : null,
  }));
  return deepFreeze(nflPortfolioValidationSnapshotSchema.parse(plain));
}

export interface ValidationArmMetrics {
  generatedCount: number;
  uniqueLineups: number;
  solverAttempts: number | null;
  acceptedCandidates: number;
  attemptLimit: number;
  budgetMs: number;
  partial: boolean;
  meanPairwiseDifference: number | null;
  meanActualPoints: number | null;
  bestActualPoints: number | null;
  topPercentileActualPoints: number | null;
  achievedTargets: { met: number; evaluated: number } | null;
}

export interface NflPortfolioValidationReport {
  version: 1;
  protocolVersion: "nfl-portfolio-walk-forward-v1.1";
  algorithmVersion: "seeded-jitter-unique-baseline-v1";
  sourceFingerprints: Record<string, string>;
  status: "complete" | "insufficient-data";
  historical: true;
  slateStartTime: string;
  capturedAt: string;
  count: number;
  seed: number;
  inputProvenance: {
    projectionsAsOf: string;
    settingsAsOf: string;
    ownership: "provided" | "estimated" | "unavailable";
    ownershipAsOf: string | null;
    vegasAsOf: string | null;
  };
  baseline: ValidationArmMetrics;
  strategy: ValidationArmMetrics;
  warnings: string[];
  methodology: string[];
}

type SolverResult = { lineup: Player[]; error?: string };
export type ValidationSolve = (
  pool: Player[],
  constraints: OptimizationConstraints,
  sport: string,
  platform: "draftkings",
) => SolverResult | Promise<SolverResult>;

export interface ValidateNflPortfolioOptions {
  snapshot: unknown;
  count: number;
  solve: ValidationSolve;
  maxCount?: number;
  maxRuntimeMs?: number;
  sourceFingerprints?: Record<string, string>;
}

function lineupIds(lineup: Player[]): number[] {
  return lineup.map(player => player.id).sort((a, b) => a - b);
}

function diversity(lineups: Player[][]): number | null {
  if (lineups.length < 2) return null;
  let total = 0, pairs = 0;
  for (let i = 0; i < lineups.length; i++) {
    const a = new Set(lineupIds(lineups[i]));
    for (let j = i + 1; j < lineups.length; j++) {
      total += lineupIds(lineups[j]).filter(id => !a.has(id)).length;
      pairs++;
    }
  }
  return total / pairs;
}

interface ArmExecution {
  solverAttempts: number | null;
  acceptedCandidates: number;
  attemptLimit: number;
  budgetMs: number;
}

export function scoreValidationArm(
  lineups: Player[][],
  actuals: Record<string, number> | null,
  execution: ArmExecution,
  requestedCount: number,
  portfolioReport?: NflPortfolioReport,
): ValidationArmMetrics {
  const keys = lineups.map(lineup => lineupIds(lineup).join("-"));
  const totals = actuals ? lineups.map(lineup => lineup.reduce((sum, player) => sum + (actuals[String(player.id)] ?? 0), 0)) : [];
  const sorted = [...totals].sort((a, b) => a - b);
  const scoredMetrics = portfolioReport?.metrics.filter(metric => metric.status === "met" || metric.status === "shortfall") ?? [];
  return {
    generatedCount: lineups.length,
    uniqueLineups: new Set(keys).size,
    ...execution,
    partial: lineups.length < requestedCount,
    meanPairwiseDifference: diversity(lineups),
    meanActualPoints: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
    bestActualPoints: totals.length ? Math.max(...totals) : null,
    topPercentileActualPoints: totals.length ? sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] : null,
    achievedTargets: portfolioReport ? {
      met: scoredMetrics.filter(metric => metric.status === "met").length,
      evaluated: scoredMetrics.length,
    } : null,
  };
}

export async function generateDeterministicBaseline(options: {
  pool: Player[];
  constraints: OptimizationConstraints;
  count: number;
  seed: number;
  deadline: number;
  budgetMs: number;
  solve: ValidationSolve;
}): Promise<{ lineups: Player[][]; execution: ArmExecution }> {
  const candidates: Player[][] = [];
  const seen = new Set<string>();
  const originals = new Map(options.pool.map(player => [player.id, player]));
  const attemptLimit = Math.min(1500, Math.max(48, options.count * 12));
  let state = options.seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let attempts = 0;
  for (; attempts < attemptLimit; attempts++) {
    if (Date.now() >= options.deadline) break;
    const jittered = options.pool.map(player => ({
      ...player,
      projectedPoints: String(Number(player.projectedPoints || player.fppg || 0) * (0.8 + random() * 0.4)),
    }));
    const result = await options.solve(jittered, options.constraints, "NFL", "draftkings");
    if (result.error || result.lineup.length === 0) continue;
    const restored = result.lineup.map(player => originals.get(player.id)).filter((player): player is Player => !!player);
    const key = lineupIds(restored).join("-");
    if (restored.length !== result.lineup.length || seen.has(key)) continue;
    seen.add(key);
    candidates.push(restored);
  }
  const lineups = candidates
    .map((lineup, index) => ({
      lineup,
      index,
      projection: lineup.reduce((sum, player) => sum + Number(player.projectedPoints || player.fppg || 0), 0),
    }))
    .sort((a, b) => b.projection - a.projection || a.index - b.index)
    .slice(0, options.count)
    .map(candidate => candidate.lineup);
  return {
    lineups,
    execution: {
      solverAttempts: attempts,
      acceptedCandidates: candidates.length,
      attemptLimit,
      budgetMs: options.budgetMs,
    },
  };
}

export function snapshotOwnershipReplay(snapshot: NflPortfolioValidationSnapshot): {
  ownershipMap: Map<number, number> | undefined;
  ownershipProvenance: "provided" | "estimated" | undefined;
} {
  return {
    ownershipMap: snapshot.ownership
      ? new Map(Object.entries(snapshot.ownership.values).map(([id, value]) => [Number(id), value]))
      : undefined,
    ownershipProvenance: snapshot.ownership?.provenance,
  };
}

export function validationArmProtocol(count: number, maxRuntimeMs: number): {
  baselineBudgetMs: number;
  strategyBudgetMs: number;
  attemptLimit: number;
} {
  const budget = Math.floor(maxRuntimeMs / 2);
  return {
    baselineBudgetMs: budget,
    strategyBudgetMs: budget,
    attemptLimit: Math.min(1500, Math.max(48, count * 12)),
  };
}

export async function validateNflPortfolio(options: ValidateNflPortfolioOptions): Promise<NflPortfolioValidationReport> {
  const snapshot = nflPortfolioValidationSnapshotSchema.parse(options.snapshot);
  const maxCount = options.maxCount ?? 500;
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > maxCount) {
    throw new Error(`count must be an integer between 1 and ${maxCount}`);
  }
  const maxRuntimeMs = options.maxRuntimeMs ?? 30_000;
  if (!Number.isFinite(maxRuntimeMs) || maxRuntimeMs < 100 || maxRuntimeMs > 120_000) {
    throw new Error("maxRuntimeMs must be between 100 and 120000");
  }
  const protocol = validationArmProtocol(options.count, maxRuntimeMs);
  const armBudgetMs = protocol.baselineBudgetMs;
  const baselineDeadline = Date.now() + armBudgetMs;

  const baseConstraints = snapshot.constraints as OptimizationConstraints;
  const baselineResult = await generateDeterministicBaseline({
    pool: snapshot.pool as Player[],
    constraints: baseConstraints,
    count: options.count,
    seed: snapshot.settings.seed,
    deadline: baselineDeadline,
    budgetMs: armBudgetMs,
    solve: options.solve,
  });
  const strategyStart = Date.now();
  const strategyDeadline = strategyStart + armBudgetMs;
  const { ownershipMap, ownershipProvenance } = snapshotOwnershipReplay(snapshot);
  const strategyResult = await generateNflPortfolio({
    pool: snapshot.pool as Player[],
    settings: { ...snapshot.settings, enabled: true, seed: snapshot.settings.seed },
    count: options.count,
    baseConstraints,
    ownershipMap,
    ownershipProvenance,
    vegasGames: snapshot.vegasGames ?? undefined,
    deadline: strategyDeadline,
    solve: (pool, constraints) => options.solve(pool, constraints, "NFL", "draftkings"),
  });
  const strategyLineups: Player[][] = strategyResult.lineups.map((result: any) =>
    Array.isArray(result) ? result : result.lineup,
  );
  const actualIds = snapshot.actualPoints ? new Set(Object.keys(snapshot.actualPoints)) : new Set<string>();
  const completeActuals = snapshot.actualPoints !== null
    && snapshot.pool.every(player => actualIds.has(String(player.id)));
  const warnings = completeActuals ? [] : [
    "Insufficient actual-points coverage; performance fields are unavailable.",
    "This report makes no ROI or profitability claim because contest entries and payouts are not supplied.",
  ];
  return {
    version: 1,
    protocolVersion: "nfl-portfolio-walk-forward-v1.1",
    algorithmVersion: "seeded-jitter-unique-baseline-v1",
    sourceFingerprints: options.sourceFingerprints ?? {},
    status: completeActuals ? "complete" : "insufficient-data",
    historical: true,
    slateStartTime: snapshot.slateStartTime,
    capturedAt: snapshot.capturedAt,
    count: options.count,
    seed: snapshot.settings.seed,
    inputProvenance: {
      projectionsAsOf: snapshot.inputAsOf.projections,
      settingsAsOf: snapshot.inputAsOf.settings,
      ownership: snapshot.ownership?.provenance ?? "unavailable",
      ownershipAsOf: snapshot.inputAsOf.ownership,
      vegasAsOf: snapshot.inputAsOf.vegas,
    },
    baseline: scoreValidationArm(baselineResult.lineups, completeActuals ? snapshot.actualPoints : null, baselineResult.execution, options.count),
    strategy: scoreValidationArm(
      strategyLineups,
      completeActuals ? snapshot.actualPoints : null,
      {
        solverAttempts: null,
        acceptedCandidates: strategyResult.report.candidateCount,
        attemptLimit: protocol.attemptLimit,
        budgetMs: protocol.strategyBudgetMs,
      },
      options.count,
      strategyResult.report,
    ),
    warnings,
    methodology: [
      "Both arms replay the same validated pre-lock player pool, constraints, requested count, starting seed, attempt limit, and dedicated time budget.",
      "Baseline uses seeded 0.8–1.2 projection perturbations and retains unique current-solver lineups with the portfolio preset off; strategy uses generateNflPortfolio.",
      "Top percentile is the nearest-rank 90th percentile of generated lineup actual-point totals.",
      "No network, current API, database, contest payout, or synthetic data is used by this harness.",
    ],
  };
}