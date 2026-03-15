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
- **FanDuel Ingest** (`server/fanduel-ingest.ts`): Fetches FD slates/players via four sources in priority order: (1) SportsData.io with correct `YYYY-MMM-DD` date format (`SPORTSDATA_API_KEY`), (2) FD JSON API, (3) FD CSV download, (4) **DK Cross-Platform Fallback** — when no FD API keys are set, derives FD slates from existing DraftKings data with proportionally scaled salaries (DK $50K → FD $60K/$55K/$35K per sport) and mapped positions. Auth uses `_fanduel_session` cookie (`FD_SESSION_COOKIE`) or Bearer token (`FD_AUTH_TOKEN`) with proper Origin/Referer headers. Includes retry logic (3 attempts with backoff), request timeouts, ET-based date filtering, and improved main slate detection (`is_guaranteed`, `is_primary`, label regex).
- **Platform-Gated DK Statuses**: `applyLiveDKStatuses` and `getInactivePlayerIds` are only called when `slate.platform === "draftkings"` — never for FanDuel or Yahoo slates.
- **Yahoo Ingest** (`server/yahoo-ingest.ts`): Fetches Yahoo DFS slates/players via three sources: (1) RotoWire API (`ROTOWIRE_API_KEY`), (2) Yahoo DFS Lobby API using correct `contestId` parameter and `fantasyPointsPerGame` for FPPG, (3) CSV upload. **Critical API patterns**: Yahoo wraps both contests and players in `{ result: [...], error: ... }` sub-objects — always access `.result`. Contest `startTime` is in **milliseconds** (not seconds). Player fields use camelCase (`firstName`, `lastName`, `teamAbbr`, `eligiblePositions`, `salary`, `code`). Contest URL: `https://dfyql-ro.sports.yahoo.com/v2/contests?sport={slug}&status=open`. Player URL: `https://dfyql-ro.sports.yahoo.com/v2/contestPlayers?contestId={id}`. Both APIs work **without auth** (OAuth client_credentials broken). Yahoo salary cap is $200.
- **Ingest Routes** (`server/routes/ingest.ts`): Admin-only API at `/api/ingest` for triggering FD/Yahoo data ingestion per sport or all sports. Auth via session admin or `ADMIN_INGEST_KEY` header. Includes daily 5 AM ET cron scheduler. Yahoo CSV upload via multipart POST.
- **AI Scout** (`server/ai-scout.ts`): Scrapes news from Rotowire/ESPN/CBS Sports and optionally analyzes with Google Gemini AI (requires `GEMINI_API_KEY`) to generate player signals (injury opps, lineup promotions, value spikes, hot streaks). Uses `gemini-2.0-flash` model via REST API. Graceful degradation without API key. Endpoints: `GET /api/scout/status` (public), `GET /api/scout/signals/:sport` (public, triggers on-demand scan if cache empty), `POST /api/scout/refresh` (auth required, force re-scan). Frontend: `ScoutPanel` component embedded in Optimizer/ProOptimizer player pools, `ScoutDashboard` page at `/scout`. Signals feed into `customProjections` via "Apply Boosts" button, preserving user overrides (user projections take precedence). Available to paid tiers via Tools menu.

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