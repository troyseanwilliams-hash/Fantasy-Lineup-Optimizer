/**
 * Single source of truth for everything that costs money besides the two main tiers.
 * Amounts are in cents. Used by the server (Stripe) and the pricing page.
 */

/** Sports a single-sport plan can be bought for. Must be a subset of ACTIVE_SPORTS. */
export const SPORT_PLAN_SPORTS = ["NBA", "NFL", "GOLF"] as const;
export type SportPlanSport = (typeof SPORT_PLAN_SPORTS)[number];

export const SPORT_PLAN_MONTHLY_CENTS = 999;

export function isSportPlanSport(value: unknown): value is SportPlanSport {
  return typeof value === "string" && (SPORT_PLAN_SPORTS as readonly string[]).includes(value);
}

export type PassId = "slate" | "week";

export interface PassConfig {
  id: PassId;
  label: string;
  amountCents: number;
  /** How long access lasts after purchase. */
  days: number;
  blurb: string;
}

export const PASSES: Record<PassId, PassConfig> = {
  slate: {
    id: "slate",
    label: "Slate Pass",
    amountCents: 499,
    days: 2,
    blurb: "48 hours of Sharpshooter. Built for one big Sunday or one big night.",
  },
  week: {
    id: "week",
    label: "Week Pass",
    amountCents: 999,
    days: 7,
    blurb: "7 days of Sharpshooter across every sport. No subscription.",
  },
};

export function isPassId(value: unknown): value is PassId {
  return value === "slate" || value === "week";
}

/** Referral program */
export const REFERRAL_MAX_REWARDS_PER_YEAR = 12;
/** Days of Sharpshooter granted as a pass when the referrer has no active subscription. */
export const REFERRAL_FREE_PASS_DAYS = 30;

/** Monthly price in cents per tier, used to size a "free month" credit. */
export const TIER_MONTHLY_CENTS: Record<string, number> = {
  star: 1999,
  pro: 3999,
};

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
