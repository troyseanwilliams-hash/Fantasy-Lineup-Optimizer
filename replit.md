# EliteLineup AI

## Overview

EliteLineup AI is a web application for Daily Fantasy Sports (DFS) players on DraftKings, FanDuel, and Yahoo. It provides advanced tools for lineup optimization, prop betting, parlay building, and PrizePicks entry optimization across major sports like NBA, NHL, GOLF, MLB, NFL, and SOCCER. The platform utilizes Linear Programming based on player projections to generate optimal lineups, aiming to enhance users' DFS strategies and improve success rates through data-driven insights.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Wouter for routing.
- **State Management**: TanStack React Query for server state; local React for UI state.
- **UI**: shadcn/ui (New York style) built on Radix UI, styled with Tailwind CSS (dark theme, platform-specific colors).

### Backend
- **Runtime**: Node.js with Express and TypeScript.
- **API**: RESTful JSON API with Zod validation.
- **Optimization**: Linear Programming via `javascript-lp-solver`.
- **Authentication**: Session-based with bcryptjs.
- **Data Refresh**: Hourly cron jobs for projections, props, and player status, with accelerated refresh before contests.
- **Injury Handling**: Live injury statuses from DraftKings API, adjusting player projections or exclusions. Yahoo-specific statuses are normalized.
- **Confirmed Starter Boost**: 5% projection boost for DraftKings confirmed starters.
- **Data Source**: DraftKings public API is the primary system of record for player and slate data.
- **Timezone Handling**: DraftKings times are processed as Eastern Time, stored as UTC.
- **Golf News Hub**: Combines ESPN news with PGA Tour scoreboard data.
- **Boost Engine**: Data-driven scoring using player history, trends, salary movement, floor/ceiling projections, momentum, team environment, and sport-specific stacking.
- **Historical Adjustments**: Auto-learning module applies winning lineup patterns and salary/position accuracy multipliers.
- **Lineup Preservation**: Saved lineups move to "review" status during slate refreshes. Player overrides (exclusions, locks, boosts) survive slate refreshes via DraftKings player ID migration.
- **Non-Main Slate Repopulation**: After main seed, non-main DK slates with 0 players (kept because of associated lineups) are automatically repopulated via `fetchDKSlateByDraftGroup`, with a 3-hour expiry guard and metadata refresh.
- **Sim Pool Parity**: Both Pro Optimizer Sim and Vault ReSim use the full player pool (no artificial trimming) with identical projection pipelines (boosts, ceiling, leverage, historical, DvP, Vegas).
- **Player Swap**: One-click player swaps within generated lineups and PrizePicks entries.
- **DK Entries Import**: CSV import for DraftKings entries (Champion tier).
- **Slate Override**: Vault Regenerate and ReSim support overriding the player pool slate, with a frontend slate selector dropdown and backend sport/platform compatibility validation.
- **Bulk Regenerate**: Regenerates multiple selected lineups using advanced optimization.
- **Saved Lineup Sim Scoring**: Run Monte Carlo simulations on saved lineups to calculate P75/P90/median/composite scores. Sim data is cleared automatically when lineups are modified.
- **Sim Regenerate**: Regenerate saved lineups using full Monte Carlo sim optimization, selecting the best candidates sorted by a user-chosen metric (P90, P75, Composite, Median, or Average). Optimized scoring with candidate limiting and typed arrays to stay within production HTTP timeouts. Adaptive sim count: calibrates LP solve time from first 10 solves, then caps remaining sims to fit within a 20-second LP budget. Player pool trimmed to top 20 per position (50 for Golf) plus 5 cheapest per position for LP solving, with full-pool fallback if trimming causes infeasibility.
- **Monte Carlo Simulation Engine**: Game-script simulation for GPP lineup optimization, featuring a three-level variance model and sport-specific correlations (NFL QB cascade, MLB/NHL correlations). Includes Vegas context for variance scaling and DvP adjustments.
- **Vegas Client**: Fetches game totals and implied team totals from The Odds API with ESPN scoreboard fallback.
- **DvP Client**: Defense vs Position engine using ESPN public team stats API for projection multipliers.
- **Manual Stack Game Selector**: Allows users to select a specific game in Sim Mode for a 15% projection boost to players in that game.
- **Actual Points Backfill**: Standalone ESPN-based actual fantasy points backfill for player history (7-day rolling window). Runs on startup and daily at 3:15 AM ET, independent of winning lineup analysis. Supports NBA, NHL, MLB, NFL.
- **Winning Lineup Agent**: Automated nightly analysis to construct "perfect hindsight" optimal lineups using actual ESPN box score data for supported sports.
- **Inactive Player Filter**: Automatically excludes inactive or low-productivity players.
- **Player Configuration**: Per-user, per-slate overrides for custom projections, boosts, locks, or exclusions. Includes platform selector (DraftKings/FanDuel/Yahoo) defaulting to DraftKings. Uses `includeStarted=true` to show all active slates regardless of grace period.
- **Lineup Grading**: Client-side engine assigns grades based on projected score, efficiency, construction, ceiling, and player health.
- **Live Score Tracker**: Real-time tracking of lineup performance with per-player scoring breakdowns using ESPN box scores.
- **Notification Preferences**: Configurable email/SMS alerts.
- **Performance Dashboard**: Displays aggregate performance stats, "Today's Activity," and historical data.
- **GatedContent Component**: Manages feature access based on subscription tier.
- **Showdown Builder**: Single-game DFS lineup optimization (CPT/FLEX or MVP/FLEX formats) with a dedicated Showdown Sim Mode.
- **FanDuel Ingest**: Fetches FD slates/players from multiple sources, including a DraftKings cross-platform fallback for scaling salaries and mapping positions when no FD API keys are set.
- **Yahoo Ingest**: Fetches Yahoo DFS slates/players from RotoWire API and Yahoo DFS Lobby API, with CSV upload support. Handles Yahoo-specific API patterns and salary cap.
- **Ingest Routes**: Admin-only API for triggering FD/Yahoo data ingestion, with daily cron scheduling.
- **Starting Lineups**: Integrates NBA starting lineup data from an external API, updating player projections and injury statuses.
- **AI Scout**: Rule-based signal engine using ESPN public APIs to detect player status (OUT, questionable), news (hot streak), and value spikes. Signals are automatically applied during optimization.
- **Slate Lifecycle**: Slates are marked inactive 3 hours after start time and filtered from user-facing endpoints.

### Platform Configuration
- Shared configuration for sport-specific roster slots, salary caps, and position constraints.
- Multi-platform support for DraftKings, FanDuel, and Yahoo, including specific salary caps and CSV export formats.
- Platform-specific colors and salary formatting.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Key Tables**: Users, slates, players, lineups, subscriptions, player history, player overrides, lineup scores.

### Ownership Projection Engine
- Modular, multi-sport engine using softmax-based probability distribution with configurable weights for projection, salary, value, recency, and position chalk multipliers.
- Supports `gpp_large`, `gpp_small`, and `cash` contest types.

### Ownership Heatmap
- Displays top-owned players by position for selected sport/slate and contest type.

### Subscription System
- **Tiers**: Basic (free), Star, and Pro, with 7-day free trials.
- **Payment**: Stripe Elements for upgrades and customer portal.

### SEO
- **Meta Tags**: Title, description, Open Graph, Twitter Card tags in `client/index.html` with per-page overrides via `usePageMeta` hook (`client/src/hooks/use-page-meta.ts`).
- **Structured Data**: JSON-LD `WebApplication` schema with pricing tiers and feature list.
- **Sitemap**: Dynamic XML sitemap at `/sitemap.xml` served from `server/routes.ts`.
- **Robots.txt**: Served from `server/routes.ts`, blocks `/admin`, `/optimizer/`, `/optimizer-pro/`, `/api/`.
- **Canonical URLs**: Set per-page via the `usePageMeta` hook.
- **Pages with SEO**: Home, Pricing, About, Terms, Privacy, Login, Lineup Builder, Prop Insights, Track Record, Sim Guide.

## External Dependencies

- **PostgreSQL Database**: Main data storage.
- **Stripe**: Payment gateway.
- **DraftKings Public API**: DFS data source.
- **ESPN Public API**: Live sports news and scores.
- **PrizePicks Public API**: Player prop projections.
- **The Odds API**: Game totals and implied team totals.
- **RotoWire API**: Yahoo DFS data source.
- **lineups.com Public API**: NBA starting lineup data.
- **NPM Packages**: `drizzle-orm`, `javascript-lp-solver`, `express`, `bcryptjs`, `stripe`, `@tanstack/react-query`, `zod`, `wouter`, `shadcn/ui`.