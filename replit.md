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
- **Injury Handling**: All optimizers (regular, Pro, bulk generate) auto-exclude both OUT and Questionable players entirely — they will not appear in generated lineups until their status changes. Doubtful players get a 30% projection penalty, Probable players get a 90% penalty. DK news-only statuses ("Breaking", "Recent", "Normal", "Latest") are treated as Healthy — not Questionable. Both Optimizer.tsx and ProOptimizer.tsx show color-coded injury badges (red=OUT, orange=Doubtful, amber=Questionable, green=Probable).
- **DK as System of Record**: All player/slate data comes exclusively from the DraftKings public API. No static seed data fallbacks — if DK doesn't have a live slate for a sport, that sport is simply unavailable until DK publishes data. No synthetic/fake injury statuses, boosts, or props. Boosts use the data-driven engine only; if it fails, no boosts are applied rather than generating fake ones. Props come from the Odds API only; no synthetic fallback.
- **DK ID Auto-Repair**: On startup/refresh, if existing slates have players missing `draftKingsPlayerId` and live DK data is available, the system updates players in-place (matching by name+team) without deleting/recreating, preserving lineup references. Empty slates get populated with fresh live data. Slates also get `draftGroupId` backfilled if missing.
- **Live Scores**: ESPN public scoreboard API with server-side caching.
- **ESPN Activity Check** (`server/espn-activity.ts`): On startup and hourly refresh, fetches the last 5 days of completed game boxscores from ESPN for NBA, NHL, MLB, and NFL. Builds a cached set of player names who actually played (had minutes/at-bats/ice-time). Used by the inactive player filter to exclude minimum-salary players who haven't appeared in any recent boxscores — catching deep bench players that DK lists but never play. Cache TTL: 4 hours. Fetches games in batches of 5 for efficiency.
- **Boost Engine** (`server/boost-engine.ts`): Data-driven scoring for DFS optimization using stored player history:
  - `computeBoostScores()` — multi-factor analysis producing detailed, data-backed reasons: value scoring with position rankings (#X of Y), historical trend detection with streak analysis, salary movement tracking with dollar amounts, floor/ceiling projections from historical variance (CV%), momentum analysis (recent 3 vs prior 3 slates), lowest/highest salary detection across tracked slates, team environment scoring, and sport-specific stack potential (NFL QB-WR, MLB team, NBA/NHL game stacks). History sorted by date descending; all division-by-zero edge cases guarded.
  - `computeCorrelationBonus()` — NFL QB-WR stacking, MLB team stacking, NBA/NHL game stacks (post-LP re-ranking)
  - `applyCeilingMode()` — deterministic upside boost for GPP/tournament lineups
  - `applyLeverageMode()` — contrarian ownership adjustments to differentiate from the field
- **Player History**: `playerHistory` table tracks player projection snapshots per slate; populated on each data refresh; used by boost engine for trend/volatility analysis
- **Player Snapshots**: `lineups.playerSnapshot` (JSONB) stores full player data (id, name, team, position, salary, fppg, projectedPoints, opponent, gameInfo, draftKingsPlayerId, boostScore, boostReason) at lineup save/update time. Used as fallback when live players are deleted (slate refresh, stale cleanup). All snapshot creation paths (save, update, moveToReview, deleteExpired, deleteSlateAndPlayers, backfill) include fppg. Orphaned lineups (where playerIds don't resolve to live players) are flagged with `isOrphaned` in API responses and shown with "Outdated" badge in the vault UI.
- **Lineup Preservation on Slate Refresh**: `deleteSlateAndPlayers()` no longer deletes lineups when a slate is refreshed. Instead, it moves them to "review" status with player snapshots preserved, so users don't lose their saved lineups when slates are recreated hourly.
- **Pro Optimizer Pool Trimming**: The LP solver (javascript-lp-solver) uses branch-and-bound for integer programming, which is exponentially slow with 250+ variables. The pro optimizer caps the player pool to 150 players (sorted by projected points, plus any locked players), reducing solve time from hanging indefinitely to ~50-60ms per iteration. A 45-second safety timeout is also enforced.
- **DK Entries Import** (Champion only): Upload DraftKings entries CSV to import lineups into the vault. CSV parsed client-side to extract Entry ID, Contest Name, Contest ID, Entry Fee, and player DK IDs (from `Name (ID)` format). Players matched by `draftKingsPlayerId` against active slate. Imported lineups store DK metadata in `dkEntryId`, `dkContestName`, `dkContestId`, `dkEntryFee` columns. Export preserves DK format with Entry ID/Contest columns for re-upload. Existing swap/regenerate/save features work on imported entries.
  - **Route**: `POST /api/lineups/import-dk` — accepts `{entries, sport, slateId}`, matches players by DK ID, validates roster, creates lineups
  - **Key Files**: `client/src/pages/SavedLineups.tsx` (parseCSVRow, parseDKEntryCSV, handleDKImport, buildDraftKingsCSV with DK entry columns)
- **Bulk Regenerate**: Select 1+ lineups in the vault and click "Regenerate" to replace each selected lineup's roster with a freshly optimized one using the advanced algorithm (boost engine, ceiling mode, leverage mode, correlation scoring, exposure management). Updates lineups in place — no new entries created — so they can be exported directly. Paid tiers only (Sharpshooter/Champion).
  - **Route**: `POST /api/lineups/bulk-generate` — accepts `{ids: number[]}`, runs advanced optimizer per lineup, updates existing lineups in place
  - **Key Files**: `client/src/pages/SavedLineups.tsx` (bulkGenerateMutation), `server/routes.ts`

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
