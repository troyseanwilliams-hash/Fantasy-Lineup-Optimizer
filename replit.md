# EliteLineup AI

## Overview

EliteLineup AI is a web application designed to help users create optimal Daily Fantasy Sports (DFS) lineups for platforms like DraftKings and FanDuel. It leverages Linear Programming (LP) optimization based on player projections across six sports: NBA, NHL, GOLF, MLB, NFL, and SOCCER. The application allows users to manage slates, customize player pools, run optimizations, and save their generated lineups. It also includes features for prop betting, parlay building, and PrizePicks entry optimization, with tiered subscription plans offering advanced functionalities. The project aims to provide a comprehensive tool for DFS enthusiasts to improve their lineup building and betting strategies.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State/Data Management**: TanStack React Query for server state, local React state for UI
- **UI Components**: shadcn/ui (New York style) built on Radix UI, styled with Tailwind CSS (dark theme, platform-specific color schemes)
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js with Express and TypeScript
- **API Pattern**: RESTful JSON API with Zod schema validation
- **Optimization Engine**: `javascript-lp-solver` for Linear Programming
- **Authentication**: bcryptjs password hashing with session-based authentication stored in PostgreSQL
- **Payments**: Stripe Elements embedded payment form for subscription payments with webhook event handling
- **Cron Jobs**: Hourly tasks for data refresh (DraftKings slates/players, Odds API props, PrizePicks projections), hourly player status/injury refresh from DK API (:00), pre-contest accelerated status refresh (every 5 min within 1 hour of lock), daily vault maintenance, daily grace period expiration check (3 AM ET), and daily player history cleanup (4 AM ET, 90-day retention).
- **Live Scores**: ESPN public scoreboard API with server-side caching.
- **Boost Engine** (`server/boost-engine.ts`): Data-driven scoring for DFS optimization:
  - `computeBoostScores()` — value scoring, historical trend analysis, price movement detection, volatility assessment
  - `computeCorrelationBonus()` — NFL QB-WR stacking, MLB team stacking, NBA/NHL game stacks (post-LP re-ranking)
  - `applyCeilingMode()` — deterministic upside boost for GPP/tournament lineups
  - `applyLeverageMode()` — contrarian ownership adjustments to differentiate from the field
- **Player History**: `playerHistory` table tracks player projection snapshots per slate; populated on each data refresh; used by boost engine for trend/volatility analysis

### Platform Configuration
- Shared configuration in `shared/platform-config.ts` defines roster slots, salary caps, and position constraints per sport/platform.
- Specific configurations for NBA, NHL, GOLF, MLB, NFL, and SOCCER for both DraftKings and FanDuel.

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with `drizzle-zod` for schema validation.
- **Key Tables**: `users`, `sessions`, `slates`, `players`, `lineups`, `subscriptions`, `props`, `prizepicks_entries`, `playerHistory`.

### Ownership Heatmap (Admin-only)
- **Route**: `/ownership` — shows top-owned players by position for a selected sport/slate
- **API**: `GET /api/ownership/:slateId` — returns players grouped by position with ownership projections, chalk player, and contrarian value pick
- **Gating**: Admin-only (`user.isAdmin`); hidden from nav and pricing pages for non-admin users
- **Ownership Model**: Multi-factor scoring (projected points, salary, value score, position scarcity) with tiered distribution bands (top 3% → 25-35%, mid-tier → 5-18%, bottom → <2.5%). BallDontLie API integration (`server/balldontlie-stats.ts`) enhances projections with real season stats when available (requires paid BDL tier for stats endpoints). Results cached 4 hours.
- **Key Files**: `client/src/pages/OwnershipHeatmap.tsx`, `server/balldontlie-stats.ts`

### Subscription System
- **Tiers**: Basic (free), Star ($19.99/mo), and Pro ($49.99/mo) — both with 7-day free trial for first-time subscribers
- **Payment**: Stripe Elements embedded payment form (in-app modal) for upgrades; Stripe Customer Portal for managing/canceling subscriptions
- **Grace Period**: Existing premium users without a Stripe subscription get 30 days to subscribe before reverting to Basic. Admin users are exempt.
- **Stripe Routes**:
  - `POST /api/subscription/create-intent` — creates a Stripe subscription with PaymentIntent for embedded payment form
  - `POST /api/subscription/checkout` — creates a Stripe Checkout Session (fallback)
  - `POST /api/subscription/portal` — creates a Stripe Customer Portal session
  - `POST /api/stripe/webhook` — handles Stripe webhook events (checkout.session.completed, customer.subscription.updated, customer.subscription.deleted)
- **Key Files**: `server/stripe.ts` (Stripe client, checkout/portal/webhook logic), `client/src/components/PaymentForm.tsx` (embedded Stripe Elements modal), `client/src/pages/Pricing.tsx`
- **Environment Variables**:
  - `STRIPE_SECRET_KEY` (secret) — Stripe API secret key
  - `VITE_STRIPE_PUBLISHABLE_KEY` (env var) — Stripe publishable key for frontend
  - `STRIPE_WEBHOOK_SECRET` (secret, optional) — Stripe webhook signing secret for signature verification
- **Webhook Setup**: Configure in Stripe Dashboard → Developers → Webhooks → Add endpoint pointing to `https://<domain>/api/stripe/webhook`. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

### Shared Code
- The `shared/` directory centralizes common code for both client and server, including database schemas, platform configurations, API routes, and affiliate marketing details.

## External Dependencies

- **PostgreSQL Database**: Primary data store for all application data and user sessions.
- **Stripe**: Payment processing for subscription upgrades (Star & Pro tiers).
- **DraftKings Public API**: Used for fetching DFS player pools, salaries, and game information without requiring an API key.
- **ESPN Public API**: Provides live sport-specific news articles.
- **PrizePicks Public API**: Fetches live player prop projections for various sports, with server-side caching to manage rate limits.
- **NPM Packages**: Key packages include `drizzle-orm`, `javascript-lp-solver`, `express`, `bcryptjs`, `stripe`, `@tanstack/react-query`, `zod`, `wouter`, and shadcn/ui ecosystem components.
