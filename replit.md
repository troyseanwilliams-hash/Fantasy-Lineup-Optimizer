# EliteLineup AI

## Overview

EliteLineup AI is a Daily Fantasy Sports (DFS) lineup optimizer web application. It helps users build winning DFS lineups for platforms like DraftKings and FanDuel by using Linear Programming (LP) optimization on player projections. Users can browse available slates (game sets), view player pools with stats and salaries, lock/exclude players, adjust projections, run LP-based optimization to generate optimal lineups under salary cap constraints, and save lineups to a personal vault.

The app supports 5 sports: NBA, NHL, GOLF, MLB, and NFL (ordered by priority in SPORT_ORDER). Active sports (NBA, NHL, GOLF) are shown in the dashboard; MLB and NFL are hidden until their seasons start. GOLF uses a tournament-style format (6 golfers, no home/away matchups). Each sport has platform-specific roster configurations for both DraftKings and FanDuel. The Home dashboard features a sport selector to switch between active sports.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side router)
- **State/Data Management**: TanStack React Query for server state, local React state for UI
- **UI Components**: shadcn/ui component library (New York style) built on Radix UI primitives
- **Styling**: Tailwind CSS with dark theme (slate/emerald color scheme for DK, blue for FD), CSS custom properties for theming
- **Build Tool**: Vite with HMR in development
- **Tables**: @tanstack/react-table for player data tables with sorting/filtering
- **Path aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Key Pages
- **Home** (`/`): Landing page for unauthenticated users, slate dashboard for authenticated users (shows main slates only with platform badges)
- **Optimizer** (`/optimizer/:id`): Full-screen lineup builder with player table, lock/exclude controls, custom projections, LP optimization, platform-aware slot display. Pro users see Own% column with color-coded ownership projections and Fade toggle (purple ghost icon) to reduce highly-owned player projections during optimization.
- **Saved Lineups** (`/lineups`): "Vault" with expandable lineup cards, full roster table with slot assignments, inline player swap (position/salary-constrained), CSV export (Pro only), sort controls (by projection, ownership, salary, date), and Review tab (Star/Pro only) showing expired lineups with contest winner comparison
- **Pricing** (`/pricing`): Subscription tiers (Basic vs Star vs Pro) with feature comparison
- **Prop Bets** (`/props`): AI-generated daily prop picks organized per sport, PrizePicks live lines board with sport tabs, and DraftKings/FanDuel affiliate marketing links (DFS + Sportsbook)
- **Parlay Builder** (`/parlays`): Pro-exclusive feature to combine multiple player props across any sport into cross-sport parlays with combined odds, potential payout calculator, wager presets, AI confidence insights, and direct DraftKings bet placement links. Free/Star/unauth users see an upgrade prompt. Pro: up to 8 legs with AI insights and DK affiliate links.
- **PrizePicks Builder** (`/prizepicks`): Pro-exclusive feature to build PrizePicks entries using live player projections. Browse real-time lines across all sports, pick More or Less on stat lines, build 2-6 pick entries with payout multiplier calculator (3x-25x), search/filter by player or stat type, copy entry details, and link to PrizePicks. Non-Pro users see upgrade prompt.
- **News** (`/news/:sport`): Live sport-specific player news from ESPN's public API, with sport tabs to switch between NBA/NHL/MLB
- **Admin** (`/admin`): Slate creation, player bulk upload (JSON), and database seeding

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript (compiled with tsx in dev, esbuild for production)
- **API Pattern**: RESTful JSON API under `/api/` prefix. Routes defined in `shared/routes.ts` with Zod schemas for validation, used by both client and server
- **Optimization Engine**: `javascript-lp-solver` for Linear Programming-based lineup optimization on the server
- **Authentication**: Replit OpenID Connect (OIDC) auth via Passport.js with session-based auth stored in PostgreSQL
- **Session Store**: `connect-pg-simple` storing sessions in the `sessions` table
- **Cron Jobs**: (1) Hourly at :30 — auto-refresh DraftKings slates/players, Odds API props, and PrizePicks projections cache via `seedDatabase(true)` + `generateDailyProps` + PrizePicks pre-warm. (2) Daily at 2 AM ET — vault reset moving expired lineups to "review" status and deleting old reviews.
- **Live Scores**: ESPN public scoreboard API with 60-second server-side caching. Endpoints: `GET /api/scores` (all sports) and `GET /api/scores/:sport`. Supports NBA, NHL, MLB, NFL, GOLF with team scores, game status, and golf leaderboards.
- **Optimizer Lock**: Both client and server prevent lineup generation after a slate's start time has passed
- **Player Exposure Limits**: Pro optimizer supports per-player exposure percentage caps during multi-lineup generation (tracked and enforced server-side)

### Platform Configuration
- **Shared config**: `shared/platform-config.ts` defines roster slots, salary caps, position constraints, and position filters per sport/platform
- **Sport order**: Defined in `SPORT_ORDER` array: NBA, NHL, GOLF, MLB, NFL
- **Active sports**: Defined in `ACTIVE_SPORTS` array: NBA, NHL, GOLF (MLB and NFL hidden until season)
- **NBA DK**: 8 slots (PG, SG, SF, PF, C, G, F, UTIL), $50K cap | **NBA FD**: 9 slots (PG×2, SG×2, SF×2, PF×2, C), $60K cap
- **NHL DK**: 9 slots (C×2, W×3, D×2, G, UTIL), $50K cap | **NHL FD**: 9 slots (C×2, W×4, D×2, G), $55K cap
- **GOLF DK**: 6 slots (G×6), $50K cap | **GOLF FD**: 6 slots (G×6), $60K cap (tournament-style, all golfers)
- **MLB DK**: 10 slots (P×2, C, 1B, 2B, 3B, SS, OF×3), $50K cap | **MLB FD**: 9 slots (P, C/1B, 2B, 3B, SS, OF×3, UTIL), $35K cap
- **NFL DK**: 9 slots (QB, RB×2, WR×3, TE, FLEX, DST), $50K cap | **NFL FD**: 9 slots (QB, RB×2, WR×3, TE, FLEX, DEF), $60K cap
- **Color schemes**: DraftKings = emerald, FanDuel = blue

### Data Storage
- **Database**: PostgreSQL (required, via `DATABASE_URL` environment variable)
- **ORM**: Drizzle ORM with `drizzle-zod` for schema-to-Zod validation
- **Schema location**: `shared/schema.ts` and `shared/models/auth.ts`
- **Migration strategy**: `drizzle-kit push` (push-based, no migration files needed for dev)

### Database Tables
1. **users** - User profiles (id, email, name, profile image) - required for Replit Auth
2. **sessions** - Session storage (sid, sess JSON, expire) - required for Replit Auth
3. **slates** - Game slates (sport, platform, name, start time, isMain flag)
4. **players** - Player pool per slate (name, team, position, salary, fppg, projected points, opponent, game info)
5. **lineups** - Saved optimized lineups per user (player IDs array, total salary, total projected points, platform, status: active/review, reviewedAt, contestWinnerData). Active lineups filtered by slate startTime; expired lineups move to "review" status at 2 AM ET; review lineups auto-deleted after 24 hours.
6. **subscriptions** - User subscription tiers (userId, tier: free/pro, status, stripeCustomerId, stripeSubscriptionId)
7. **props** - Daily AI-generated prop bets (sport, playerName, team, opponent, propType, line, pick, confidence, isLocked, createdDate)

### Affiliate Marketing
- **Config**: `shared/affiliate-config.ts` contains placeholder affiliate URLs for DraftKings and FanDuel (DFS + Sportsbook)
- **Display**: Affiliate banners shown on Prop Bets page per sport section (sportsbook) and at page top (DFS)
- **Links**: Update placeholder URLs in `shared/affiliate-config.ts` with actual affiliate tracking links

### Subscription System
- **Basic tier** (display name for "free" DB value): 1 saved team per sport, no CSV export, no multi-lineup generation, no AI boost
- **Star tier** ($19.99/mo, first month $9.99, annual $200/yr): 20 saved teams per sport, CSV export, multi-lineup generation (up to 5)
- **Pro tier** ($49.99/mo, first month $29.99, annual $499/yr): 150 saved teams per sport, CSV export, multi-lineup generation (up to 20), Parlay Builder (8 legs + DK bet links + AI insights), AI boost analysis & injury tracking, ownership projections & player fading
- **Per-sport limits**: Backend checks per-sport count via `getLineupCountBySport()` with tier-based max (1/20/150)
- **Subscription API**: `/api/subscription` returns `tier`, `sportCounts`, `maxLineupsPerSport`
- **Payment**: Stripe integration not yet connected (marked "Coming Soon" on pricing page)
- **TODO**: Set up Replit Stripe connector when ready to enable payments

### Shared Code
The `shared/` directory contains code used by both client and server:
- `schema.ts` - Drizzle table definitions and Zod schemas
- `platform-config.ts` - Platform-specific roster configurations (DK/FD)
- `routes.ts` - API route definitions with paths, methods, input/output schemas, and a `buildUrl` helper
- `affiliate-config.ts` - DraftKings/FanDuel affiliate URLs and sport-specific promo text
- `seed_data.ts` - Sample NBA player/slate data for both DK and FD platforms
- `models/auth.ts` - Auth-related table definitions

### Build & Deploy
- **Development**: `npm run dev` runs tsx with Vite dev server middleware for HMR
- **Production build**: `npm run build` runs Vite for client bundle + esbuild for server bundle into `dist/`
- **Production start**: `npm start` serves the built assets with `node dist/index.cjs`
- **Database sync**: `npm run db:push` pushes schema to database

## External Dependencies

### Required Services
- **PostgreSQL Database**: Connected via `DATABASE_URL` environment variable. Used for all data storage including auth sessions
- **Replit Auth (OIDC)**: Authentication via `ISSUER_URL` (defaults to `https://replit.com/oidc`). Requires `REPL_ID` and `SESSION_SECRET` environment variables

### Live Data Integration
- **DraftKings Public API**: Primary data source for DFS player pools. Fetches real active player salaries, positions, and game info from DK's unauthenticated contest/draftables endpoints. No API key required.
  - Endpoints: `draftkings.com/lobby/getcontests?sport={SPORT}` → `api.draftkings.com/draftgroups/v1/draftgroups/{id}/draftables`
  - Supports NBA, NHL, MLB, NFL. Falls back to static seed data when DK returns no valid data (e.g., MLB pre-season)
  - FanDuel data is derived from DK data with salary ratios based on platform salary caps
- **Ball Don't Lie API**: Previously used for NBA data, replaced by DraftKings API for more accurate DFS-specific player pools
- **ESPN Public API**: Used for live sport-specific news articles on the News page
- **PrizePicks Public API**: Live player prop projections displayed on Prop Bets page. No API key required.
  - Endpoint: `https://partner-api.prizepicks.com/projections?league_id={id}&per_page=1000`
  - League IDs: NBA=7, NHL=8, GOLF=1, MLB=2, NFL=9, SOCCER=82
  - JSON:API response format (data[] + included[] arrays); player data in `included` where `type === "new_player"`
  - 5-minute server-side cache per sport to avoid rate limiting
  - Module: `server/prizepicks.ts` with `fetchPrizePicksProjections(sport)` and `getSupportedPPSports()`
  - Route: `GET /api/prizepicks/:sport` returns `{ sport, projections[] }`
- **Data module**: `server/balldontlie.ts` handles all DK API fetching, player processing, and static fallbacks

### Key NPM Packages
- `drizzle-orm` + `drizzle-kit` - Database ORM and migration tooling
- `javascript-lp-solver` - Linear Programming solver for lineup optimization
- `express` + `express-session` - HTTP server and session management
- `passport` + `openid-client` - Authentication
- `@tanstack/react-query` - Client-side data fetching/caching
- `zod` + `drizzle-zod` - Runtime validation shared between client and server
- `wouter` - Client-side routing
- shadcn/ui ecosystem (Radix UI, Tailwind CSS, class-variance-authority, lucide-react)

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (required)
- `SESSION_SECRET` - Secret for session encryption (required)
- `REPL_ID` - Replit environment identifier (set automatically on Replit)
- `ISSUER_URL` - OIDC issuer URL (defaults to Replit's OIDC endpoint)
