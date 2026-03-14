# EliteLineup AI

## Overview

EliteLineup AI is a web application designed for Daily Fantasy Sports (DFS) players on DraftKings, FanDuel, and Yahoo, offering advanced tools for lineup optimization, prop betting, parlay building, and PrizePicks entry optimization across NBA, NHL, GOLF, MLB, NFL, and SOCCER. It leverages Linear Programming based on player projections to create optimal lineups. The project aims to provide a comprehensive, data-driven platform that empowers users to enhance their DFS strategies and improve their success rates.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript, Wouter for routing.
- **State Management**: TanStack React Query for server state, local React for UI state.
- **UI**: shadcn/ui (New York style) built on Radix UI, styled with Tailwind CSS (dark theme, platform-specific colors).
- **Build**: Vite.

### Backend
- **Runtime**: Node.js with Express and TypeScript.
- **API**: RESTful JSON API with Zod validation.
- **Optimization**: `javascript-lp-solver` for Linear Programming.
- **Authentication**: Session-based using bcryptjs.
- **Payments**: Stripe Elements for subscriptions and webhook handling.
- **Data Refresh**: Hourly cron jobs for DraftKings slates/players, Odds API props, PrizePicks projections, and player status updates, with accelerated refresh before contests.
- **Injury Handling**: Live injury statuses from DraftKings API, adjusting player projections or exclusions based on status.
- **Confirmed Starter Boost**: Players confirmed as starters by DraftKings receive a 5% projection boost.
- **Data Source**: DraftKings public API is the sole system of record for player and slate data.
- **Timezone Handling**: All DraftKings times are processed as Eastern Time, with UTC storage in the database.
- **Golf News Hub**: Enhanced endpoint combining ESPN news with PGA Tour scoreboard data.
- **Boost Engine**: Data-driven scoring system using player history, trends, salary movement, floor/ceiling projections, momentum, team environment, and sport-specific stacking. Includes projection accuracy tracking and hot/cold form detection.
- **Historical Adjustments**: Auto-learning module applies winning lineup patterns and salary/position accuracy multipliers to projections.
- **Winning Frequency Boost**: Players frequently appearing in optimal lineups receive projection boosts.
- **Winning Lineup Projection Adjustment**: Adjusts player projections based on their cleaned average actual points from past winning lineups.
- **Player History**: Tracks player projection snapshots per slate.
- **Lineup Preservation**: Saved lineups are moved to "review" status during slate refreshes to prevent data loss.
- **Pro Optimizer Pool Trimming**: Limits player pool to 150 players for performance.
- **Player Swap**: Supports one-click player swaps within generated lineups and PrizePicks entries.
- **DK Entries Import**: Allows import of DraftKings entries via CSV for Champion tier.
- **Bulk Regenerate**: Enables regeneration of multiple selected lineups using advanced optimization.
- **Winning Lineup Agent**: Automated nightly analysis constructs "perfect hindsight" optimal lineups using actual ESPN box score data.
- **Inactive Player Filter**: Automatically excludes inactive players not present in recent ESPN box scores or those with low productivity.
- **Player Configuration**: Per-user, per-slate overrides for custom projections, boosts, locks, or exclusions.
- **Lineup Grading**: Client-side engine assigns letter grades to lineups based on projected score, efficiency, construction, ceiling, and player health, with sport-specific considerations.
- **Live Score Tracker**: Real-time tracking of active lineup performance with per-player scoring breakdowns.
- **Notification Preferences**: Configurable email/SMS alerts for injuries, scoring, and reminders.
- **Performance Dashboard**: Displays aggregate performance stats against optimal and field, with historical data.
- **Track Record**: Shows user's overall DFS history and performance summary.
- **GatedContent Component**: Manages access to features based on user subscription tier.
- **Showdown Builder**: Single-game DFS lineup optimization for CPT/FLEX or MVP/FLEX formats.

### Platform Configuration
- Shared configuration in `shared/platform-config.ts` for sport-specific roster slots, salary caps, and position constraints.
- **Multi-Platform Support**: DraftKings, FanDuel, and Yahoo platform configs. Yahoo uses $200 salary cap (not $50K). Soccer excluded from Yahoo.
- **PlatformSelector Component**: `client/src/components/PlatformSelector.tsx` — tab bar for switching DK/FD/YH with platform colors and tier gating.
- **Platform Colors**: DraftKings=emerald, FanDuel=blue, Yahoo=purple. Exported as `PLATFORM_COLORS`.
- **Salary Formatting**: Yahoo salaries display as `$XX` (not `$XX,XXX`). Use `formatSalary()`/`formatCap()` helpers in optimizer pages.
- **CSV Export**: Platform-aware CSV format — DK uses `Name (ID)`, FD uses `ID:Name`, Yahoo uses `Name`.

### Data Storage
- **Database**: PostgreSQL.
- **ORM**: Drizzle ORM.
- **Key Tables**: Users, slates, players, lineups, subscriptions, player history, player overrides, lineup scores, etc.

### Ownership Projection Engine
- Modular, multi-sport engine using softmax-based probability distribution.
- Configurable weights for projection, salary, value, recency, and position chalk multipliers.
- Supports `gpp_large`, `gpp_small`, and `cash` contest types.

### Ownership Heatmap
- Displays top-owned players by position for selected sport/slate and contest type.

### Subscription System
- **Tiers**: Basic (free), Star, and Pro, with 7-day free trials.
- **Payment**: Stripe Elements for upgrades and customer portal for management.

## External Dependencies

- **PostgreSQL Database**: Main data storage.
- **Stripe**: Payment gateway.
- **DraftKings Public API**: DFS data source.
- **ESPN Public API**: Live sports news and scores.
- **PrizePicks Public API**: Player prop projections.
- **NPM Packages**: `drizzle-orm`, `javascript-lp-solver`, `express`, `bcryptjs`, `stripe`, `@tanstack/react-query`, `zod`, `wouter`, `shadcn/ui`.