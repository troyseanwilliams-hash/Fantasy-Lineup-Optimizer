import Stripe from "stripe";
import { storage } from "./storage";
import { recordFunnelEvent } from "./funnel";
import { db } from "./db";
import { and, eq, gte, sql } from "drizzle-orm";
import { referralRedemptions } from "@shared/schema";
import {
  PASSES,
  SPORT_PLAN_MONTHLY_CENTS,
  REFERRAL_MAX_REWARDS_PER_YEAR,
  REFERRAL_FREE_PASS_DAYS,
  TIER_MONTHLY_CENTS,
  isPassId,
  isSportPlanSport,
  type PassId,
} from "@shared/plans";

const stripeSecretKey = process.env.ELITELINEUP_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.warn("[stripe] ELITELINEUP_STRIPE_SECRET_KEY not set — Stripe features will be unavailable");
}

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey)
  : null;

const PRICE_CONFIGS: Record<string, { amount: number; name: string }> = {
  star_monthly: { amount: 1999, name: "EliteLineup AI Star" },
  pro_monthly: { amount: 3999, name: "EliteLineup AI Pro" },
  star_annual: { amount: 19990, name: "EliteLineup AI Star (Annual)" },
  pro_annual: { amount: 39990, name: "EliteLineup AI Pro (Annual)" },
};

const AMOUNT_TO_TIER: Record<number, string> = {
  [SPORT_PLAN_MONTHLY_CENTS]: "star",
  1999: "star",
  3999: "pro",
  4999: "pro",
  19990: "star",
  39990: "pro",
  49990: "pro",
};

let priceCache: Record<string, string> = {};

async function getOrCreatePrice(tier: string, billing: "monthly" | "annual", sportScope?: string | null): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const scope = sportScope && isSportPlanSport(sportScope) ? sportScope : null;
  if (sportScope && !scope) throw new Error(`Invalid sport plan: ${sportScope}`);
  if (scope && (tier !== "star" || billing !== "monthly")) {
    throw new Error("Single-sport plans are Sharpshooter monthly only");
  }

  const cacheKey = scope ? `star_monthly_${scope.toLowerCase()}` : `${tier}_${billing}`;
  if (priceCache[cacheKey]) return priceCache[cacheKey];

  const priceConfig = scope
    ? { amount: SPORT_PLAN_MONTHLY_CENTS, name: `EliteLineup AI ${scope} Plan` }
    : PRICE_CONFIGS[cacheKey];
  if (!priceConfig) throw new Error(`Invalid tier/billing: ${cacheKey}`);

  const existingProducts = await stripe.products.list({ limit: 100 });
  let product = existingProducts.data.find(p => p.name === priceConfig.name && p.active);

  if (!product) {
    product = await stripe.products.create({
      name: priceConfig.name,
      metadata: scope ? { tier, billing, sportScope: scope } : { tier, billing },
    });
  }

  const existingPrices = await stripe.prices.list({ product: product.id, active: true });
  const interval = billing === "annual" ? "year" : "month";
  let price = existingPrices.data.find(
    p => p.unit_amount === priceConfig.amount && p.recurring?.interval === interval
  );

  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: priceConfig.amount,
      currency: "usd",
      recurring: { interval },
    });
  }

  priceCache[cacheKey] = price.id;
  return price.id;
}

function tierFromPrice(priceAmount: number | null): string | null {
  if (priceAmount === null) return null;
  return AMOUNT_TO_TIER[priceAmount] || null;
}

/** Returns a valid Stripe customer ID for the user, creating one if needed.
 *  If the stored ID is stale (belongs to a different Stripe account) it is
 *  cleared and a fresh customer is created in the current account. */
async function getOrCreateValidCustomer(
  userId: string,
  email: string,
  existingSub: Awaited<ReturnType<typeof storage.getSubscription>>
): Promise<string> {
  const storedId = existingSub?.stripeCustomerId;
  if (storedId) {
    try {
      await stripe!.customers.retrieve(storedId);
      return storedId; // exists in current account ✓
    } catch (err: any) {
      if (err?.code === "resource_missing") {
        console.warn(`[stripe] Stale customer ID ${storedId} not found in current account — creating new customer`);
        // Fall through to create a new customer
      } else {
        throw err;
      }
    }
  }

  const customer = await stripe!.customers.create({ email, metadata: { userId } });
  await storage.upsertSubscription({
    userId,
    stripeCustomerId: customer.id,
    stripeSubscriptionId: undefined,
    tier: existingSub?.tier || "free",
    status: existingSub?.status || "active",
  });
  return customer.id;
}

/** True when this Stripe customer already has (or had) a real subscription, so they
 *  must not get another free trial. Abandoned checkouts leave "incomplete" subscriptions
 *  behind (they carry a trial_start too), so those are ignored. */
async function customerHasHadTrial(customerId: string): Promise<boolean> {
  const subs = await stripe!.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  return subs.data.some((s) => s.status !== "incomplete" && s.status !== "incomplete_expired");
}

export async function createSubscriptionWithIntent(
  userId: string,
  email: string,
  tier: string,
  billing: "monthly" | "annual",
  sportScope?: string | null
): Promise<{ subscriptionId: string; clientSecret: string; isTrial: boolean }> {
  if (!stripe) throw new Error("Stripe not configured");

  const priceId = await getOrCreatePrice(tier, billing, sportScope);

  const sub = await storage.getSubscription(userId);
  const customerId = await getOrCreateValidCustomer(userId, email, sub);

  const localHadTrial = !!(sub?.stripeSubscriptionId && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due"));
  // Also ask Stripe, so someone who cancelled cannot restart a free trial every month.
  const hasHadTrial = localHadTrial || (await customerHasHadTrial(customerId));

  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    metadata: sportScope ? { userId, tier, sportScope } : { userId, tier },
  };

  if (!hasHadTrial) {
    subscriptionParams.trial_period_days = 7;
    subscriptionParams.expand = ["pending_setup_intent"];
  } else {
    subscriptionParams.expand = ["latest_invoice.payment_intent"];
  }

  const subscription = await stripe.subscriptions.create(subscriptionParams);

  await storage.upsertSubscription({
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    tier: sub?.tier || "free",
    status: subscription.status,
  });

  if (!hasHadTrial && subscription.pending_setup_intent) {
    const setupIntent = subscription.pending_setup_intent as Stripe.SetupIntent;
    if (!setupIntent.client_secret) {
      throw new Error("Unable to create setup intent for trial. Please try again.");
    }
    return {
      subscriptionId: subscription.id,
      clientSecret: setupIntent.client_secret,
      isTrial: true,
    };
  }

  const invoice = subscription.latest_invoice as Stripe.Invoice;
  const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent | null;

  if (!paymentIntent || !paymentIntent.client_secret) {
    throw new Error("Unable to create payment intent for this subscription. Please try again.");
  }

  return {
    subscriptionId: subscription.id,
    clientSecret: paymentIntent.client_secret,
    isTrial: false,
  };
}

export async function createCheckoutSession(
  userId: string,
  email: string,
  tier: string,
  billing: "monthly" | "annual",
  successUrl: string,
  cancelUrl: string,
  sportScope?: string | null
): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const priceId = await getOrCreatePrice(tier, billing, sportScope);

  const sub = await storage.getSubscription(userId);
  const customerId = await getOrCreateValidCustomer(userId, email, sub);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: sportScope ? { userId, tier, sportScope } : { userId, tier },
    subscription_data: {
      metadata: sportScope ? { userId, tier, sportScope } : { userId, tier },
    },
  });

  recordFunnelEvent("checkout_started", { email, errorReason: `tier=${tier} billing=${billing}` });
  return session.url!;
}

export async function createDraftHubCheckoutSession(
  userId: string,
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const sub = await storage.getSubscription(userId);
  const customerId = await getOrCreateValidCustomer(userId, email, sub);

  // Get or create the $49 one-time product + price
  const productName = "NFL Draft Hub 2026";
  const existingProducts = await stripe.products.list({ limit: 100 });
  let product = existingProducts.data.find(p => p.name === productName && p.active);
  if (!product) {
    product = await stripe.products.create({
      name: productName,
      description: "One-time access to the full 2026 NFL Draft Hub — rankings, Live Draft Assistant, AI picks, sleeper alerts, bye weeks & handcuffs.",
      metadata: { type: "draft_hub_2026" },
    });
  }

  const existingPrices = await stripe.prices.list({ product: product.id, active: true });
  let price = existingPrices.data.find(p => p.unit_amount === 4900 && p.type === "one_time");
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 4900,
      currency: "usd",
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, type: "draft_hub_2026" },
  });

  recordFunnelEvent("checkout_started", { email, errorReason: "draft_hub_2026 one-time" });
  return session.url!;
}

/** One-time Slate/Week pass. Refused for anyone who already has a live subscription. */
export async function createPassCheckoutSession(
  userId: string,
  email: string,
  passId: PassId,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");
  if (!isPassId(passId)) throw new Error("Unknown pass");
  const pass = PASSES[passId];

  const sub = await storage.getSubscription(userId);
  const liveStripeSub = !!sub?.stripeSubscriptionId && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due");
  if (liveStripeSub) throw new Error("You already have an active plan, so a pass is not needed.");
  if (sub?.tier === "pro") throw new Error("You already have Champion access.");

  const customerId = await getOrCreateValidCustomer(userId, email, sub);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: pass.amountCents,
        product_data: {
          name: `EliteLineup AI ${pass.label}`,
          description: pass.blurb,
          metadata: { type: "pass", passId },
        },
      },
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, type: "pass", passId },
  });

  recordFunnelEvent("checkout_started", { email, errorReason: `pass=${passId}` });
  return session.url!;
}

/** Grants (or extends) Sharpshooter access for a fixed number of days with no Stripe subscription. */
export async function grantPassDays(userId: string, days: number, opts: { sessionId?: string; customerId?: string | null } = {}): Promise<boolean> {
  const existing = await storage.getSubscription(userId);
  if (opts.sessionId && existing?.lastPassSessionId === opts.sessionId) return false; // retried webhook
  const liveStripeSub = !!existing?.stripeSubscriptionId && (existing.status === "active" || existing.status === "trialing" || existing.status === "past_due");
  if (liveStripeSub || existing?.tier === "pro") return false;

  const base = existing?.passExpiresAt && existing.passExpiresAt.getTime() > Date.now()
    ? existing.passExpiresAt.getTime()
    : Date.now();
  const passExpiresAt = new Date(base + days * 24 * 60 * 60 * 1000);

  await storage.upsertSubscription({
    userId,
    stripeCustomerId: opts.customerId ?? existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
    tier: "star",
    status: "active",
    currentPeriodEnd: passExpiresAt,
    graceEndsAt: null,
    passExpiresAt,
    sportScope: null,
    ...(opts.sessionId ? { lastPassSessionId: opts.sessionId } : {}),
  });
  return true;
}

/**
 * Called when a referred user's first real subscription payment lands. Rewards the referrer
 * once: a Stripe balance credit worth one month if they subscribe, otherwise a 30-day pass.
 * Capped per referrer per year so a ring of fake accounts cannot farm it.
 */
export async function rewardReferralIfDue(referredUserId: string): Promise<void> {
  try {
    const [redemption] = await db.select().from(referralRedemptions)
      .where(and(eq(referralRedemptions.referredId, referredUserId), eq(referralRedemptions.status, "pending")));
    if (!redemption) return;

    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(referralRedemptions)
      .where(and(
        eq(referralRedemptions.referrerId, redemption.referrerId),
        eq(referralRedemptions.status, "rewarded"),
        gte(referralRedemptions.rewardedAt, yearAgo),
      ));
    // Claim first so two concurrent webhooks cannot both pay out.
    const claimed = await db.update(referralRedemptions)
      .set({ status: count >= REFERRAL_MAX_REWARDS_PER_YEAR ? "capped" : "rewarded", rewardedAt: new Date() })
      .where(and(eq(referralRedemptions.id, redemption.id), eq(referralRedemptions.status, "pending")))
      .returning();
    if (claimed.length === 0 || claimed[0].status === "capped") return;

    const referrerSub = await storage.getSubscription(redemption.referrerId);
    const liveStripeSub = !!referrerSub?.stripeSubscriptionId && !!referrerSub.stripeCustomerId &&
      (referrerSub.status === "active" || referrerSub.status === "trialing" || referrerSub.status === "past_due");

    if (liveStripeSub && stripe) {
      const credit = TIER_MONTHLY_CENTS[referrerSub!.tier] ?? SPORT_PLAN_MONTHLY_CENTS;
      await stripe.customers.createBalanceTransaction(referrerSub!.stripeCustomerId!, {
        amount: -credit,
        currency: "usd",
        description: "EliteLineup referral reward: one month free",
      });
      console.log(`[referral] Credited ${credit} cents to referrer ${redemption.referrerId}`);
    } else {
      await grantPassDays(redemption.referrerId, REFERRAL_FREE_PASS_DAYS);
      console.log(`[referral] Granted ${REFERRAL_FREE_PASS_DAYS}-day pass to referrer ${redemption.referrerId}`);
    }
  } catch (err) {
    // Never let a reward problem break subscription webhooks.
    console.error("[referral] reward failed:", err);
  }
}

export async function createPortalSession(userId: string, email: string, returnUrl: string): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const sub = await storage.getSubscription(userId);
  const customerId = await getOrCreateValidCustomer(userId, email, sub);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  } catch (err: any) {
    if (err?.code === "resource_missing") {
      console.warn(`[stripe] Stale customer ID ${sub.stripeCustomerId} not in current account — clearing from DB`);
      await storage.upsertSubscription({
        userId,
        stripeCustomerId: null as any,
        stripeSubscriptionId: null as any,
        tier: "free",
        status: "active",
      });
      throw new Error("Your billing record was linked to an old account. Please subscribe again to set up billing.");
    }
    throw err;
  }
}

async function resolveUserId(subscription: Stripe.Subscription): Promise<string | null> {
  if (subscription.metadata?.userId) return subscription.metadata.userId;
  const sub = await storage.getSubscriptionByStripeCustomerId(subscription.customer as string);
  return sub?.userId || null;
}

async function resolveTierFromSubscription(subscription: Stripe.Subscription): Promise<string> {
  if (subscription.metadata?.tier) return subscription.metadata.tier;
  if (subscription.items?.data?.[0]?.price?.unit_amount) {
    const resolved = tierFromPrice(subscription.items.data[0].price.unit_amount);
    if (resolved) return resolved;
  }
  return "free";
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      recordFunnelEvent("checkout_completed", {
        email: session.customer_details?.email ?? session.customer_email,
        errorReason: session.metadata?.type ?? session.metadata?.tier ?? null,
      });

      // One-time Slate/Week pass
      if (session.metadata?.type === "pass" && userId && isPassId(session.metadata?.passId)) {
        const granted = await grantPassDays(userId, PASSES[session.metadata!.passId as PassId].days, {
          sessionId: session.id,
          customerId: typeof session.customer === "string" ? session.customer : null,
        });
        console.log(`[stripe] Pass ${session.metadata!.passId} for user ${userId}: ${granted ? "granted" : "skipped"}`);
        break;
      }

      // One-time Draft Hub purchase
      if (session.metadata?.type === "draft_hub_2026" && userId) {
        const accessEnd = new Date("2027-01-31T00:00:00Z"); // access through end of 2026 season
        const existing = await storage.getSubscription(userId);
        await storage.upsertSubscription({
          userId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: existing?.stripeSubscriptionId ?? null as any,
          tier: existing?.tier ?? "free",
          status: existing?.status ?? "active",
          currentPeriodEnd: existing?.currentPeriodEnd ?? accessEnd,
          graceEndsAt: existing?.graceEndsAt ?? null,
          draftAccess: true,
        });
        console.log(`[stripe] Draft Hub 2026 purchased: user ${userId}, draftAccess granted until ${accessEnd.toISOString()}`);
        break;
      }

      const tier = session.metadata?.tier;
      if (!userId || !tier) break;

      const subscriptionId = session.subscription as string;
      const stripeSubscription = await stripe!.subscriptions.retrieve(subscriptionId);

      await storage.upsertSubscription({
        userId,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscriptionId,
        tier,
        status: "active",
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        graceEndsAt: null,
        passExpiresAt: null,
        sportScope: isSportPlanSport(session.metadata?.sportScope) ? session.metadata!.sportScope : null,
      });
      console.log(`[stripe] Checkout completed: user ${userId} upgraded to ${tier}`);
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(subscription);
      if (!userId) break;

      const tier = await resolveTierFromSubscription(subscription);
      const periodEnd = new Date(subscription.current_period_end * 1000);

      if (subscription.status === "active" || subscription.status === "trialing") {
        await storage.upsertSubscription({
          userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: subscription.customer as string,
          tier,
          status: subscription.status,
          currentPeriodEnd: periodEnd,
          graceEndsAt: null,
          passExpiresAt: null,
          sportScope: isSportPlanSport(subscription.metadata?.sportScope) ? subscription.metadata.sportScope : null,
        });
        console.log(`[stripe] Subscription ${subscription.status}: user ${userId}, tier=${tier}`);
        // The first real payment (trial converting, or no trial) is what earns the referrer a reward.
        if (subscription.status === "active") await rewardReferralIfDue(userId);
      } else if (subscription.status === "past_due" || subscription.status === "unpaid") {
        await storage.upsertSubscription({
          userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: subscription.customer as string,
          tier,
          status: subscription.status,
          currentPeriodEnd: periodEnd,
        });
        console.log(`[stripe] Subscription ${subscription.status}: user ${userId}, keeping tier=${tier} until period end`);
      } else if (subscription.status === "canceled") {
        if (periodEnd > new Date()) {
          await storage.upsertSubscription({
            userId,
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer as string,
            tier,
            status: "canceled",
            currentPeriodEnd: periodEnd,
          });
          console.log(`[stripe] Subscription canceled: user ${userId}, access until ${periodEnd.toISOString()}`);
        } else {
          await storage.upsertSubscription({
            userId,
            tier: "free",
            status: "canceled",
            stripeSubscriptionId: null,
            currentPeriodEnd: null,
            graceEndsAt: null,
            sportScope: null,
          });
          console.log(`[stripe] Subscription canceled & expired: user ${userId} reverted to free`);
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(subscription);
      if (!userId) break;

      await storage.upsertSubscription({
        userId,
        tier: "free",
        status: "canceled",
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        graceEndsAt: null,
        sportScope: null,
      });
      console.log(`[stripe] Subscription deleted: user ${userId} reverted to free`);
      break;
    }
  }
}
