import { type Platform, type Sport, ACTIVE_SPORTS } from "./platform-config";

// ============================================================
// AFFILIATE LINKS
// All URLs include both a ref tag (for affiliate tracking) and
// UTM parameters (for traffic source analytics in your dashboard).
// Update ref= and utm_source= values if your affiliate ID changes.
// ============================================================

interface AffiliateLink {
  url: string;
  label: string;
  description: string;
}

interface PlatformAffiliateLinks {
  dfs: AffiliateLink;
  sportsbook: AffiliateLink;
}

export const AFFILIATE_LINKS: Record<Platform, PlatformAffiliateLinks> = {
  draftkings: {
    dfs: {
      url: "https://www.draftkings.com/?ref=elitelineup&utm_source=elitelineup&utm_medium=app&utm_campaign=dfs",
      label: "Play on DraftKings DFS",
      description: "Build winning DFS lineups on DraftKings",
    },
    sportsbook: {
      url: "https://sportsbook.draftkings.com/?ref=elitelineup&utm_source=elitelineup&utm_medium=app&utm_campaign=sportsbook",
      label: "Bet on DraftKings Sportsbook",
      description: "Place your prop bets on DraftKings Sportsbook",
    },
  },
  fanduel: {
    dfs: {
      url: "https://www.fanduel.com/?ref=elitelineup&utm_source=elitelineup&utm_medium=app&utm_campaign=dfs",
      label: "Play on FanDuel DFS",
      description: "Build winning DFS lineups on FanDuel",
    },
    sportsbook: {
      url: "https://sportsbook.fanduel.com/?ref=elitelineup&utm_source=elitelineup&utm_medium=app&utm_campaign=sportsbook",
      label: "Bet on FanDuel Sportsbook",
      description: "Place your prop bets on FanDuel Sportsbook",
    },
  },
};

// ============================================================
// AFFILIATE PROMOS
// Keyed by Sport to match ACTIVE_SPORTS in platform-config.
// Every active sport must have an entry here — enforced by the
// getPromo() helper below which will throw in development if
// a sport is missing, catching gaps at startup rather than runtime.
// ============================================================

interface SportPromo {
  dk: string;
  fd: string;
}

// Must contain an entry for every value in ACTIVE_SPORTS.
// If you add a sport to ACTIVE_SPORTS, add a matching entry here.
export const AFFILIATE_PROMOS: Record<Sport, SportPromo> = {
  NBA: {
    dk: "Get up to $1,000 bonus on your first NBA DFS contest",
    fd: "New users get $5 free on NBA contests",
  },
  NHL: {
    dk: "Score big with DraftKings NHL contests",
    fd: "Try FanDuel NHL for exciting hockey action",
  },
  MLB: {
    dk: "Swing for the fences with DraftKings MLB",
    fd: "Step up to the plate on FanDuel MLB",
  },
  NFL: {
    dk: "Dominate the gridiron on DraftKings NFL",
    fd: "Win big with FanDuel NFL contests",
  },
  GOLF: {
    dk: "Tee off with DraftKings PGA Golf contests",
    fd: "Drive your lineup on FanDuel Golf",
  },
  // Added: SOCCER was in ACTIVE_SPORTS but missing from promos,
  // causing undefined returns for any Soccer slate.
  SOCCER: {
    dk: "Build your winning lineup on DraftKings Soccer",
    fd: "Score big with FanDuel Soccer contests",
  },
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Returns the affiliate link for a given platform and context.
 * Use this instead of indexing AFFILIATE_LINKS directly to get
 * type-safe access.
 */
export function getAffiliateLink(
  platform: Platform,
  context: "dfs" | "sportsbook"
): AffiliateLink {
  return AFFILIATE_LINKS[platform][context];
}

/**
 * Returns the promo copy for a given sport and platform.
 * Throws in development if the sport is not in AFFILIATE_PROMOS,
 * so missing entries are caught at startup rather than silently
 * returning undefined in production.
 */
export function getPromo(sport: Sport, platform: Platform): string {
  const promo = AFFILIATE_PROMOS[sport];

  if (!promo) {
    const msg = `No affiliate promo configured for sport: "${sport}". Add an entry to AFFILIATE_PROMOS.`;
    if (process.env.NODE_ENV === "development") {
      throw new Error(msg);
    }
    console.error(msg);
    return "";
  }

  return platform === "draftkings" ? promo.dk : promo.fd;
}

/**
 * Validates that every active sport has a corresponding promo entry.
 * Call this at app startup (e.g. in your server entry point) to catch
 * configuration gaps before they reach users.
 *
 * @example
 * // In server/index.ts:
 * validateAffiliatePromos();
 */
export function validateAffiliatePromos(): void {
  const missing = ACTIVE_SPORTS.filter(sport => !AFFILIATE_PROMOS[sport]);
  if (missing.length > 0) {
    throw new Error(
      `Missing affiliate promos for active sports: ${missing.join(", ")}. ` +
      `Add entries to AFFILIATE_PROMOS in affiliate-config.ts.`
    );
  }
}
