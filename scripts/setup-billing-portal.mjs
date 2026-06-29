import Stripe from "stripe";

const sk = process.env.ELITELINEUP_STRIPE_SECRET_KEY;
if (!sk) { console.error("NO ELITELINEUP_STRIPE_SECRET_KEY"); process.exit(1); }
const stripe = new Stripe(sk);

async function main() {
  // Check existing portal configurations
  const configs = await stripe.billingPortal.configurations.list({ limit: 10 });
  console.log(`Found ${configs.data.length} portal configuration(s)`);

  if (configs.data.length > 0) {
    for (const c of configs.data) {
      console.log(`  ${c.id} | active=${c.active} | default=${c.is_default}`);
    }
    console.log("\nPortal is already configured — the 500 is something else.");
    return;
  }

  // No config exists — create one
  console.log("\nNo portal config found. Creating default configuration...");
  const config = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Manage your EliteLineup AI subscription",
    },
    features: {
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_pause: { enabled: false },
      subscription_update: {
        enabled: true,
        proration_behavior: "always_invoice",
        default_allowed_updates: ["price", "quantity", "promotion_code"],
        products: [
          // These are looked up dynamically — portal auto-includes subscription's own product
        ],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
    },
  });
  console.log(`Created portal config: ${config.id}`);

  // Set as default
  await stripe.billingPortal.configurations.update(config.id, { is_default: true });
  console.log("Set as default configuration.");
}

main().catch((e) => { console.error("Stripe error:", e.message); process.exit(1); });
