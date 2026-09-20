import { z } from "zod";

const percentage = z.number().finite().min(0).max(100);
const mixSchema = z.object({
  naked: percentage.default(10),
  single: percentage.default(49),
  double: percentage.default(38),
  triple: percentage.default(3),
}).refine(value => Math.abs(Object.values(value).reduce((a, b) => a + b, 0) - 100) < 0.01, {
  message: "QB stack percentages must total 100.",
});

export const nflPortfolioSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  stackMix: mixSchema.default({ naked: 10, single: 49, double: 38, triple: 3 }),
  bringBackPct: percentage.default(50),
  secondaryStackPct: percentage.default(67),
  flexMix: z.object({
    RB: percentage.default(37.4),
    WR: percentage.default(43.3),
    TE: percentage.default(19.3),
  }).refine(value => Math.abs(value.RB + value.WR + value.TE - 100) < 0.01, {
    message: "FLEX percentages must total 100.",
  }).default({ RB: 37.4, WR: 43.3, TE: 19.3 }),
  rbMinSalary: z.number().int().min(0).max(50000).default(4500),
  allowLockedCheapRb: z.boolean().default(false),
  minLowOwnedPlayers: z.number().int().min(0).max(8).default(2),
  lowOwnershipThreshold: z.number().finite().min(0.1).max(100).default(10),
  preferLowOwnedWr: z.boolean().default(true),
  ownershipMode: z.enum(["off", "estimated", "provided"]).default("off"),
  ownershipOverrides: z.record(z.string(), z.number().finite().min(0).max(100)).default({}),
  fieldSize: z.enum(["100000+", "10000-99999", "1000-9999", "under1000"]).default("100000+"),
  ownershipTolerance: z.number().finite().min(0).max(100).default(15),
  minGames: z.number().int().min(2).max(9).default(5),
  maxGames: z.number().int().min(2).max(9).default(6),
  nakedQbIds: z.array(z.number().int().positive()).max(100).default([]),
  preferHomeTe: z.boolean().default(true),
  preferHomeFavoriteDst: z.boolean().default(true),
  preferLowTotalGames: z.boolean().default(true),
  gameTotalThreshold: z.number().finite().min(20).max(90).default(48),
  preferValueWr: z.boolean().default(true),
  preferFourXUpside: z.boolean().default(true),
  qbSalaryMix: z.object({
    punt: percentage.default(9),
    value: percentage.default(40),
    mid: percentage.default(36),
    premium: percentage.default(15),
  }).refine(value => Math.abs(Object.values(value).reduce((a, b) => a + b, 0) - 100) < 0.01, {
    message: "QB salary percentages must total 100.",
  }).default({ punt: 9, value: 40, mid: 36, premium: 15 }),
  seed: z.number().int().min(1).max(2147483647).default(2026),
}).refine(value => value.minGames <= value.maxGames, {
  message: "Minimum games cannot exceed maximum games.",
});

export type NflPortfolioSettings = z.infer<typeof nflPortfolioSettingsSchema>;
export const DEFAULT_NFL_PORTFOLIO = nflPortfolioSettingsSchema.parse({});
export const OWNERSHIP_TARGETS: Record<NflPortfolioSettings["fieldSize"], number> = {
  "100000+": 121.9,
  "10000-99999": 128.2,
  "1000-9999": 149.6,
  under1000: 182.0,
};

export interface NflPortfolioMetric {
  key: string;
  label: string;
  target: number | null;
  achieved: number | null;
  unit: "lineups" | "percent" | "points" | "games";
  status: "met" | "shortfall" | "unavailable" | "info";
  detail?: string;
}

export interface NflPortfolioReport {
  requestedCount: number;
  generatedCount: number;
  candidateCount: number;
  seed: number;
  metrics: NflPortfolioMetric[];
  warnings: string[];
  dataSources: {
    ownership: "off" | "estimated" | "provided" | "unavailable";
    vegas: "verified" | "unavailable";
    rushing: "manual";
  };
  partial: boolean;
}

// Internal, per-candidate solver policy. Never trust a client-supplied value.
export interface NflPortfolioLineupPolicy {
  catcherCount: 0 | 1 | 2 | 3;
  bringBack: boolean;
  nakedQbIds: number[];
  rbMinSalary: number;
  exemptLockedRbIds: number[];
  minLowOwnedPlayers: number;
  lowOwnershipThreshold: number;
  stackGameKeys: string[];
}