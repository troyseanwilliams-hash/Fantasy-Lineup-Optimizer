import Stripe from "stripe";
import { storage } from "./storage";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[stripe] STRIPE_SECRET_KEY not set — Stripe features will be unavailable");
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PRICE_CONFIGS: Record<string, { amount: number; name: string }> = {
  star_monthly: { amount: 1999, name: "EliteLineup AI Star" },
  pro_monthly: { amount: 4999, name: "EliteLineup AI Pro" },
  star_annual: { amount: 19990, name: "EliteLineup AI Star (Annual)" },
  pro_annual: { amount: 49990, name: "EliteLineup AI Pro (Annual)" },
};

const AMOUNT_TO_TIER: Record<number, string> = {
  1999: "star",
  4999: "pro",
  19990: "star",
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
  let customerId = sub?.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { userId },
    });
    customerId = customer.id;
    await storage.upsertSubscription({
      userId,
      stripeCustomerId: customerId,
      tier: sub?.tier || "free",
      status: sub?.status || "active",
    });
  }

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

export async function createPortalSession(userId: string, returnUrl: string): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");

  const sub = await storage.getSubscription(userId);
  if (!sub?.stripeCustomerId) {
    throw new Error("No Stripe customer found for this user");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
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
          status: "active",
          currentPeriodEnd: periodEnd,
          graceEndsAt: null,
        });
        console.log(`[stripe] Subscription active: user ${userId}, tier=${tier}`);
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
