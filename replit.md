# ProLineup AI

## Overview

ProLineup AI is a Daily Fantasy Sports (DFS) lineup optimizer web application. It helps users build winning DFS lineups for platforms like DraftKings and FanDuel by using Linear Programming (LP) optimization on player projections. Users can browse available slates (game sets), view player pools with stats and salaries, lock/exclude players, adjust projections, run LP-based optimization to generate optimal lineups under salary cap constraints, and save lineups to a personal vault.

The app supports 4 sports: NBA, NHL, MLB, and NFL (ordered by season priority in SPORT_ORDER). Each sport has platform-specific roster configurations for both DraftKings and FanDuel. The Home dashboard features a sport selector to switch between sports.

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
- **Optimizer** (`/optimizer/:id`): Full-screen lineup builder with player table, lock/exclude controls, custom projections, LP optimization, platform-aware slot display
- **Saved Lineups** (`/lineups`): "Vault" of previously saved optimized lineups
- **Pricing** (`/pricing`): Subscription tiers (Free vs Pro) with feature comparison
- **Admin** (`/admin`): Slate creation, player bulk upload (JSON), and database seeding

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript (compiled with tsx in dev, esbuild for production)
- **API Pattern**: RESTful JSON API under `/api/` prefix. Routes defined in `shared/routes.ts` with Zod schemas for validation, used by both client and server
- **Optimization Engine**: `javascript-lp-solver` for Linear Programming-based lineup optimization on the server
- **Authentication**: Replit OpenID Connect (OIDC) auth via Passport.js with session-based auth stored in PostgreSQL
- **Session Store**: `connect-pg-simple` storing sessions in the `sessions` table

### Platform Configuration
- **Shared config**: `shared/platform-config.ts` defines roster slots, salary caps, position constraints, and position filters per sport/platform
- **Sport order**: Defined in `SPORT_ORDER` array: NHL, MLB, NFL, NBA (reorderable by season)
- **NBA DK**: 8 slots (PG, SG, SF, PF, C, G, F, UTIL), $50K cap | **NBA FD**: 9 slots (PG×2, SG×2, SF×2, PF×2, C), $60K cap
- **NHL DK**: 9 slots (C×2, W×3, D×2, G, UTIL), $50K cap | **NHL FD**: 9 slots (C×2, W×4, D×2, G), $55K cap
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
5. **lineups** - Saved optimized lineups per user (player IDs array, total salary, total projected points, platform)
6. **subscriptions** - User subscription tiers (userId, tier: free/pro, status, stripeCustomerId, stripeSubscriptionId)

### Subscription System
- **Free tier**: 1 saved lineup max
- **Pro tier**: 20 saved lineups, export functionality
- **Payment**: Stripe integration not yet connected (marked "Coming Soon" on pricing page)
- **TODO**: Set up Replit Stripe connector (connector:ccfg_stripe_01K611P4YQR0SZM11XFRQJC44Y) when ready to enable payments

### Shared Code
The `shared/` directory contains code used by both client and server:
- `schema.ts` - Drizzle table definitions and Zod schemas
- `platform-config.ts` - Platform-specific roster configurations (DK/FD)
- `routes.ts` - API route definitions with paths, methods, input/output schemas, and a `buildUrl` helper
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
