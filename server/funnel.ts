// Signup funnel tracking — records every signup/login/checkout touchpoint so
// admins can see who tried, who failed, and where they dropped off.
// Fire-and-forget: never throws, never blocks a request.

import { db } from "./db";
import { signupEvents } from "@shared/schema";
import type { Request } from "express";

export type FunnelEventType =
  | "signup_attempt"
  | "signup_success"
  | "signup_error"
  | "signup_duplicate"
  | "login_error"
  | "checkout_started"
  | "checkout_completed";

export function recordFunnelEvent(
  eventType: FunnelEventType,
  params: { email?: string | null; errorReason?: string | null; req?: Request },
): void {
  const { email, errorReason, req } = params;
  db.insert(signupEvents)
    .values({
      email: email?.toLowerCase().trim() || null,
      eventType,
      errorReason: errorReason?.slice(0, 300) || null,
      ipAddress: req ? (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null : null,
      userAgent: req ? (req.headers["user-agent"] as string)?.slice(0, 300) || null : null,
    })
    .catch((err) => console.error("funnel event write failed (non-fatal):", err));
}
