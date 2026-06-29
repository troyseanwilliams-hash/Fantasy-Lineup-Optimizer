---
name: Stripe MCP vs app key target different accounts
description: The Stripe MCP connector and the app's STRIPE_SECRET_KEY point to DIFFERENT Stripe accounts
---

# Stripe: MCP connector ≠ app's secret key

The Stripe **MCP** tool (mcpStripe_*) is connected to a different Stripe account
than the **app** uses. Observed: MCP → "AIBeatSync sandbox" (test); the app's
`STRIPE_SECRET_KEY` → a LIVE account whose display name is "GlidePathway" (NOT
literally "EliteLineup", despite the product being EliteLineup).

**Rule:** To create/verify products, prices, or any account data that the app
must actually use (checkout, subscriptions, webhooks), DO NOT use the Stripe MCP
tools — they hit the wrong account. Instead run a small Node script with
`new Stripe(process.env.STRIPE_SECRET_KEY)` via bash (the code_execution JS
sandbox does NOT expose process.env; bash does). Always call
`stripe.accounts.retrieve()` first and print id + display name + live/test mode
to confirm you're on the intended account before writing.
**Why:** A product was mistakenly created in the MCP's sandbox account before this
was understood. The app's own key is the source of truth for what payments hit.
**How to apply:** Any "set up / fix Stripe pricing" request → verify account via
the app key, then mirror `PRICE_CONFIGS` in server/stripe.ts (Star $19.99/$199.90,
Pro $39.99/$399.90; matched by product name + amount + interval).
