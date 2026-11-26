import type { Request, Response, NextFunction } from "express";

/** Lowercase + trim an email. Returns "" when the value is not a string. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Deliberately loose: one @, something on each side, a dot in the domain. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type Bucket = { count: number; resetAt: number };

/**
 * Tiny in-memory rate limiter (no dependency). Counts requests per key within
 * a window and answers 429 once the limit is passed. Resets on server restart,
 * which is fine for blocking password guessing and signup bots.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();
  const sweep = setInterval(() => {
    const now = Date.now();
    buckets.forEach((b, k) => {
      if (b.resetAt <= now) buckets.delete(k);
    });
  }, 60_000);
  sweep.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.key ? opts.key(req) : req.ip || "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res
        .status(429)
        .json({ message: opts.message || "Too many attempts. Please wait a few minutes and try again." });
    }
    next();
  };
}
