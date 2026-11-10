import { z } from "zod";

export const CLASSIC_POSITION_CAPS: Record<string, number> = { QB: 27, RB: 35, WR: 30, TE: 25, DST: 27 };
export const CLASSIC_OWNERSHIP_CAP = 115;
export const CLASSIC_SKILL_FLOOR = 4;
export const classicPlayerEvidenceSchema = z.object({
  // Negative fantasy projections are valid input; eligibility applies the floor.
  projection: z.number().finite(),
  ownership: z.number().finite().min(0).max(100),
  status: z.enum(["UNKNOWN", "ACTIVE", "QUESTIONABLE", "OUT", "INACTIVE", "IR", "PUP", "EXEMPT", "SUSPENDED", "DOUBTFUL"]),
  statusCheckedAt: z.string().datetime().optional(),
  depthChartNotes: z.string().trim().min(1).optional(),
  weatherNotes: z.string().trim().min(1).optional(),
  weatherCheckedAt: z.string().datetime().optional(),
  recent: z.array(z.object({
    targets: z.number().nonnegative().optional(),
    carries: z.number().nonnegative().optional(),
    routes: z.number().nonnegative().optional(),
    snaps: z.number().nonnegative().optional(),
    rushYards: z.number().optional(),
    actualPoints: z.number().optional(),
  })).max(3).default([]),
  opportunity: z.enum(["producing", "opening", "fading", "none"]).default("none"),
  punt: z.boolean().default(false),
  valueTier: z.boolean().default(false),
  chalk: z.boolean().default(false),
  rushingQb: z.boolean().default(false),
  roadUnderdogSpread: z.number().nonnegative().default(0),
  opponentImpliedTotal: z.number().finite().nonnegative().optional(),
  opponentSackRate: z.number().finite().nonnegative().optional(),
  opponentFumbleRate: z.number().finite().nonnegative().optional(),
  opponentIntRate: z.number().finite().nonnegative().optional(),
  eliteTurnoverMatchup: z.boolean().default(false),
  topDefense: z.boolean().default(false),
  ceiling: z.number().finite().nonnegative().optional(),
});
export const classicLogicSchema = z.object({
  projectionSource: z.enum(["DFS Army", "App data"]),
  slateId: z.number().int().positive(),
  players: z.record(z.string(), classicPlayerEvidenceSchema),
  anchors: z.record(z.string(), z.number().min(35).max(45)).default({}),
  // Latest addendum: double stacks lead; full architecture is an overlapping target.
  fullArchitecturePct: z.number().min(0).max(45).default(34),
  doubleStackPct: z.number().min(51).max(100).default(65),
  bringBackPct: z.number().min(35).max(55).default(45),
  nakedPct: z.number().min(0).max(10).default(3),
}).refine(s => s.fullArchitecturePct <= s.bringBackPct && s.fullArchitecturePct <= s.doubleStackPct, {
  message: "Full architecture target cannot exceed double-stack or bring-back targets.",
}).refine(s => s.projectionSource === "App data" || Object.values(s.players).every(p =>
  p.status !== "UNKNOWN" && p.statusCheckedAt && p.weatherCheckedAt && p.depthChartNotes && p.weatherNotes), {
  message: "Strict imported evidence requires status, review timestamps, depth-chart notes and weather notes for every player.",
});
export type ClassicEvidence = z.infer<typeof classicPlayerEvidenceSchema>;
export type ClassicLogic = z.infer<typeof classicLogicSchema>;
export function hasRole(e: ClassicEvidence): boolean {
  if (e.recent.length < 2 || !["producing", "opening"].includes(e.opportunity)) return false;
  const workload = e.recent.map(g => (g.targets ?? 0) + (g.carries ?? 0) + (g.routes ?? 0) / 5);
  return workload.at(-1)! > 0 && (e.opportunity === "opening" || workload.at(-1)! >= workload[0] * 0.75);
}
export function rushingQualified(e: ClassicEvidence): boolean {
  return e.rushingQb && e.recent.length >= 2 && e.recent.every(g => (g.carries ?? 0) >= 4 && (g.rushYards ?? 0) >= 25);
}
export function classicMinimum(e: ClassicEvidence, position: string): number {
  return hasRole(e) && ((e.punt && e.ownership < 10) || (e.valueTier && ["RB", "TE"].includes(position))) ? 5 : 0;
}
