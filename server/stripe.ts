import Stripe from "stripe";
import { storage } from "./storage";

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
  1999: "star",
  3999: "pro",
  4999: "pro",
  19990: "star",
  39990: "pro",
  49990: "pro",
};

let priceCache: Record<string, string> = {};

async function getOrCreatePrice(tier: string, billing: "monthly" | "annual"): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const cacheKey = `${tier}_${billing}`;
  if (priceCache[cacheKey]) return priceCache[cacheKey];

  const priceConfig = PRICE_CONFIGS[cacheKey];
  if (!priceConfig) throw new Error(`Invalid tier/billing: ${cacheKey}`);

  const existingProducts = await stripe.products.list({ limit: 100 });
  let product = existingProducts.data.find(p => p.name === priceConfig.name && p.active);

  if (!product) {
    product = await stripe.products.create({
      name: priceConfig.name,
      metadata: { tier, billing },
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

export async function createSubscriptionWithIntent(
  userId: string,
  email: string,
  tier: string,
  billing: "monthly" | "annual"
): Promise<{ subscriptionId: string; clientSecret: string; isTrial: boolean }> {
  if (!stripe) throw new Error("Stripe not configured");

  const priceId = await getOrCreatePrice(tier, billing);

  const sub = await storage.getSubscription(userId);
  const customerId = await getOrCreateValidCustomer(userId, email, sub);

  const hasHadTrial = !!(sub?.stripeSubscriptionId && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due"));

  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    metadata: { userId, tier },
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
  cancelUrl: string
): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const priceId = await getOrCreatePrice(tier, billing);

  const sub = await storage.getSubscription(userId);
  const customerId = await getOrCreateValidCustomer(userId, email, sub);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, tier },
    subscription_data: {
      metadata: { userId, tier },
    },
  });

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

  // Get or create the $59 one-time product + price
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
  let price = existingPrices.data.find(p => p.unit_amount === 5900 && p.type === "one_time");
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 5900,
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

  return session.url!;
}

export async function createPortalSession(userId: string, returnUrl: string): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const sub = await storage.getSubscription(userId);
  if (!sub?.stripeCustomerId) {
    throw new Error("No Stripe customer found for this user");
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
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
        });
        console.log(`[stripe] Subscription ${subscription.status}: user ${userId}, tier=${tier}`);
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
      });
      console.log(`[stripe] Subscription deleted: user ${userId} reverted to free`);
      break;
    }
  }
}
