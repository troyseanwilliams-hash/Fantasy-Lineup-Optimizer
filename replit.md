# EliteLineup AI

## Overview

EliteLineup AI is a web application that provides advanced tools for Daily Fantasy Sports (DFS) players on platforms like DraftKings and FanDuel. It optimizes DFS lineups across six major sports (NBA, NHL, GOLF, MLB, NFL, SOCCER) using Linear Programming based on player projections. The application includes features for slate management, player pool customization, lineup optimization, and saving generated lineups. Beyond DFS, it offers functionalities for prop betting, parlay building, and PrizePicks entry optimization. The project's vision is to deliver a comprehensive, data-driven platform that empowers DFS enthusiasts and bettors to enhance their strategies and improve their success rates.

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
- **Authentication**: Session-based using bcryptjs for password hashing.
- **Payments**: Stripe Elements for subscriptions, including webhook handling.
- **Data Refresh**: Hourly cron jobs for DraftKings slates/players, Odds API props, PrizePicks projections, and player status updates. Pre-contest accelerated status refresh (every 5 min within 1 hour of lock). 2 AM ET vault reset clears expired lineups and all PrizePicks vault entries nightly. Slate staleness uses last game start time + 3hr buffer (not just slate start time) to prevent premature next-day replacement while games are still active.
- **Injury Handling**: Live injury statuses fetched directly from DraftKings API at optimization time. OUT and Questionable players are excluded, Doubtful players receive a 30% projection penalty, and Probable players a 90% penalty.
- **Confirmed Starter Boost**: Players confirmed as starters by DraftKings (`playerGameAttributes`) receive a 5% projection boost in Standard, Pro, and Bulk Regenerate optimizers. The `isConfirmedStarter` field is stored in the `players` table, updated during slate refresh and live at optimization time via `applyLiveDKStatuses()`. A green "STARTER" badge is displayed on both optimizer pages.
- **Data Source**: DraftKings public API is the sole system of record for all player/slate data. FPPG extraction uses sport-specific stat attribute IDs: NBA/NFL=90, NHL=341, SOCCER=745, GOLF=219 (generic fallback). Helper `extractFppg()` in `balldontlie.ts` checks all IDs `[219, 90, 341, 745]`.
- **Timezone Handling**: All DraftKings times (StartDateEst, competition.startTime) are treated as Eastern Time via `parseEasternTime()` which auto-detects timezone-naive vs UTC (Z-suffixed) inputs. Game times display via `formatGameTime()` using `Intl.DateTimeFormat` with `America/New_York` for proper EST/EDT handling. All "today" date calculations use `getEasternToday()` for ET-correct dates. Slate start times are stored as UTC in the database. Cron jobs use `timezone: "America/New_York"`.
- **Golf News Hub**: Enhanced `/api/news/golf/enhanced` endpoint combines ESPN news articles with ESPN PGA Tour scoreboard data (tournament leaderboards, round scores, field sizes, live/final status). The `/news/golf` page renders a dedicated "PGA Tour Hub" with hero article, tournament leaderboard cards with tie-aware positioning, and a news feed. Other sports use the standard news layout.
- **Boost Engine**: Data-driven scoring using player history for value, trends, salary movement, floor/ceiling projections, momentum, team environment, and sport-specific stacking (NFL QB-WR, MLB team, NBA/NHL game stacks). Includes `computeBoostScores()`, `computeCorrelationBonus()`, `applyCeilingMode()`, `applyLeverageMode()`, and `applyActualAdjustedProjections()`. Features projection accuracy tracking (boosts consistent outperformers, penalizes underperformers based on actual-vs-projected ratios) and hot/cold actual form detection. The `applyActualAdjustedProjections()` function blends recent actual fantasy points into DK projections using recency-weighted averaging (most recent games weighted higher via 0.85 decay). Blend weight scales from 15% (3 games) to 40% (10+ games), capped at ±25-30% adjustment from base projection.
- **Historical Adjustments**: Auto-learning module (`server/historical-adjustments.ts`) that applies winning lineup patterns to optimizer projections. Analyzes salary range performance and position accuracy from 10+ analyzed slates, applies capped (±12%) multipliers to projections. Integrated into Pro Optimizer and Bulk Regenerate flows. Profile cached 30 min, invalidated on new analysis. Requires minimum 10 slates before activating.
- **Winning Frequency Boost**: Players who frequently appear in winning/optimal lineups receive projection boosts when playing today. Integrated into the boost engine (`server/boost-engine.ts`). Tiers: 50%+ appearance rate = +3.0 boost ("Optimal regular"), 25%+ = +2.0 ("Winning lineup pick"), 2+ appearances = +1.0 ("Past optimal"), single high-value appearance (6x+) = +0.5. Requires 2+ analyzed slates per sport.
- **Winning Lineup Projection Adjustment**: `applyWinningLineupAdjustment()` in `server/boost-engine.ts` nudges player projections toward their cleaned average actual points from winning lineups. Collects all actual point totals per player across up to 50 recent winning lineups, removes statistical outliers via IQR method (when 4+ data points), then blends the cleaned average into the current projection. Blend weight scales from 10% (2 appearances) to 35% (7+ appearances), capped at ±20-25% adjustment from base. Applied in Standard Optimizer, Pro Optimizer, and Bulk Regenerate flows after `applyActualAdjustedProjections()`.
- **Admin Backfill Endpoint**: `POST /api/admin/backfill-and-analyze` fetches DK draftables for a past draft group, inserts player history, and triggers winning lineup analysis. Useful for recovering missed slates.
- **Player History**: Tracks player projection snapshots per slate for trend and volatility analysis.
- **Lineup Preservation**: Saved lineups are moved to "review" status with preserved player snapshots during slate refreshes to prevent data loss.
- **Pro Optimizer Pool Trimming**: Limits player pool to 150 players (sorted by projected points, plus locked players) to improve LP solver performance.
- **Player Swap**: Both Standard and Pro Optimizers support one-click player swaps within generated lineups, filtering replacements by position and salary. PrizePicks Builder also supports swapping picks in the entry slip via the ArrowLeftRight icon, preserving the More/Less direction.
- **DK Entries Import (Champion only)**: Allows users to upload DraftKings entries CSVs to import lineups into the vault, preserving DK metadata and enabling existing swap/regenerate features.
- **Bulk Regenerate (Paid tiers)**: Enables regeneration of multiple selected lineups using advanced optimization algorithms (boost engine, ceiling/leverage mode, correlation, exposure management).
- **Add New Slate (Admin)**: Admin can import additional DraftKings slates beyond the auto-refreshed main slates.
- **Winning Lineup Agent (Admin)**: Automated nightly analysis at 3:30 AM ET constructs "perfect hindsight" optimal lineups using actual ESPN box score data and LP solver. Deduplicates player history snapshots by player name + team + position before LP solve (DraftKings assigns multiple draftable IDs per player across game slots). Batch updates actual points via chunked parallel queries (50/chunk). Stores player-level insights (salary efficiency, projection accuracy, boost hit rate, value plays). Admin dashboard at `/winning-lineups` with sport tabs, aggregated trends, manual slate analysis trigger. Files: `server/winning-lineup-agent.ts`, `server/actual-points.ts`, `client/src/pages/WinningLineups.tsx`.
- **Inactive Player Filter**: Async `getInactivePlayerIds()` auto-refreshes ESPN recently-played cache if expired for NBA/NHL/MLB/NFL. Excludes all players not in recent ESPN boxscores (no FPPG bypass). Applied in GET players, standard optimizer, pro optimizer, bulk regenerate, and dashboard trending/top scorers. Players not in ESPN boxscores with value ≥7.0 pts/$1K are auto-excluded (catches ghost players like bench-warmers inheriting starters' projections). Players in 6.0-7.0 range excluded unless they have an OUT teammate at same position. Returns `{ inactiveIds, zeroPointCount }`. Zero-point history filter queries `player_history` for players with ≥2 appearances and no productive actual points.
- **Player Configuration (Sharpshooter/Champion)**: Per-user, per-slate player overrides stored in `player_overrides` table. Users can set custom projections, boost projections (0/5/10/15/20%), lock players into lineups, or exclude players. Overrides are automatically applied in both Standard and Pro Optimizers (merged with manual optimizer controls). Overrides are cleared when slates refresh. Page at `/player-config` with sport tabs, search/filter, inline editing, rocket boost cycling. Files: `client/src/pages/PlayerConfig.tsx`, API routes in `server/routes.ts`.
- **Lineup Grading**: Client-side grading engine (`client/src/lib/lineup-grader.ts`) assigns letter grades (S/A+/A/B+/B/C/D/F) to all lineups based on 5 weighted criteria: Projected Score (35%), Salary Efficiency (20%), Roster Construction (20%), Ceiling Potential (15%), and Player Health (10%). Sport-specific thresholds and stacking pattern recognition (NFL QB-WR correlation, MLB team stacks, NBA/NHL game stacks). Grades displayed in Vault lineup cards (with expandable breakdown), Standard Optimizer stat bar, and Pro Optimizer generated lineup badges. Vault supports sorting by grade.
- **Live Score Tracker (Sharpshooter+)**: Page at `/live-scores` tracks lineup performance in real-time. Displays active lineups with live points, projected points, completion percentage, and expandable per-player scoring breakdowns. Auto-refreshes every 60 seconds. Files: `client/src/pages/LiveScoreTracker.tsx`, `lineup_scores` table.
- **Notification Preferences (Sharpshooter+)**: Page at `/notifications` allows users to configure email/SMS delivery channels and alert types (injury alerts, scoring milestones, pre-game reminders with configurable timing). Files: `client/src/pages/NotificationPreferences.tsx`, `notification_preferences` table.
- **Performance Dashboard (Sharpshooter+)**: Page at `/performance` shows aggregate performance stats (vs. optimal, vs. field, projection accuracy) with sport breakdown and per-slate history. Files: `client/src/pages/PerformanceDashboard.tsx`, `performance_snapshots` table.
- **Track Record (All tiers)**: Page at `/track-record` shows user's overall DFS history including total lineups, sport breakdown, and performance summary. Files: `client/src/pages/TrackRecord.tsx`.
- **GatedContent Component**: Reusable component (`client/src/components/GatedContent.tsx`) that checks feature access via `/api/content-access` endpoint and renders upgrade prompts for locked features.
- **Content Access API**: `GET /api/content-access` returns per-feature unlock status based on user tier, used by GatedContent component.

### Platform Configuration
- Shared configuration in `shared/platform-config.ts` defines sport-specific roster slots, salary caps, and position constraints for DraftKings and FanDuel across all supported sports.

### Data Storage
- **Database**: PostgreSQL.
- **ORM**: Drizzle ORM with `drizzle-zod`.
- **Key Tables**: `users`, `sessions`, `slates`, `players`, `lineups`, `subscriptions`, `props`, `prizepicks_entries`, `playerHistory`, `winning_lineups`, `player_overrides`, `lineup_scores`, `alert_deliveries`, `notification_preferences`, `performance_snapshots`.

### Ownership Projection Engine
- **Modular, multi-sport engine** utilizing softmax-based probability distribution.
- **Configuration**: Sport-specific weights for projection, salary, value, recency, position chalk multipliers, and ownership ceilings.
- **Contest Types**: Supports `gpp_large`, `gpp_small`, and `cash` contest types with varying concentration levels.
- **Inputs**: Player projections, salary, value, recency trends, consistency, star power, injury status, and position scarcity.

### Ownership Heatmap (Champion-only)
- Displays top-owned players by position for a selected sport/slate with contest type selection.
- Provides APIs for ownership projections and detailed player ownership lists.

### Subscription System
- **Tiers**: Basic (free), Star ($19.99/mo), and Pro ($39.99/mo), each with a 7-day free trial.
- **Payment**: Stripe Elements for in-app upgrades and Stripe Customer Portal for subscription management.
- **Grace Period**: 30-day grace period for existing premium users to subscribe via Stripe.

## External Dependencies

- **PostgreSQL Database**: Main data store.
- **Stripe**: Payment gateway for subscriptions.
- **DraftKings Public API**: Source for DFS player pools, salaries, and game information.
- **ESPN Public API**: Provides live sport-specific news and scores.
- **PrizePicks Public API**: Fetches live player prop projections.
- **NPM Packages**: `drizzle-orm`, `javascript-lp-solver`, `express`, `bcryptjs`, `stripe`, `@tanstack/react-query`, `zod`, `wouter`, and shadcn/ui.