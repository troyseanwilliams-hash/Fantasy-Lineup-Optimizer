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
- **Authentication**: Replit OpenID Connect (OIDC) auth via Passport.js with session-based authentication stored in PostgreSQL
- **Cron Jobs**: Hourly tasks for data refresh (DraftKings slates/players, Odds API props, PrizePicks projections) and daily vault maintenance.
- **Live Scores**: ESPN public scoreboard API with server-side caching.

### Platform Configuration
- Shared configuration in `shared/platform-config.ts` defines roster slots, salary caps, and position constraints per sport/platform.
- Specific configurations for NBA, NHL, GOLF, MLB, NFL, and SOCCER for both DraftKings and FanDuel.

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with `drizzle-zod` for schema validation.
- **Key Tables**: `users`, `sessions`, `slates`, `players`, `lineups`, `subscriptions`, `props`, `prizepicks_entries`.

### Subscription System
- **Tiers**: Basic, Star, and Pro, offering varying levels of saved lineups, multi-lineup generation, CSV export, and access to advanced features like Parlay Builder, PrizePicks Builder, and AI insights.

### Shared Code
- The `shared/` directory centralizes common code for both client and server, including database schemas, platform configurations, API routes, and affiliate marketing details.

## External Dependencies

- **PostgreSQL Database**: Primary data store for all application data and user sessions.
- **DraftKings Public API**: Used for fetching DFS player pools, salaries, and game information without requiring an API key.
- **ESPN Public API**: Provides live sport-specific news articles.
- **PrizePicks Public API**: Fetches live player prop projections for various sports, with server-side caching to manage rate limits.
- **NPM Packages**: Key packages include `drizzle-orm`, `javascript-lp-solver`, `express`, `bcryptjs`, `@tanstack/react-query`, `zod`, `wouter`, and shadcn/ui ecosystem components.