export const AFFILIATE_LINKS = {
  draftkings: {
    dfs: {
      url: "https://www.draftkings.com/?ref=elitelineup",
      label: "Play on DraftKings DFS",
      description: "Build winning DFS lineups on DraftKings",
    },
    sportsbook: {
      url: "https://sportsbook.draftkings.com/?ref=elitelineup",
      label: "Bet on DraftKings Sportsbook",
      description: "Place your prop bets on DraftKings Sportsbook",
    },
  },
  fanduel: {
    dfs: {
      url: "https://www.fanduel.com/?ref=elitelineup",
      label: "Play on FanDuel DFS",
      description: "Build winning DFS lineups on FanDuel",
    },
    sportsbook: {
      url: "https://sportsbook.fanduel.com/?ref=elitelineup",
      label: "Bet on FanDuel Sportsbook",
      description: "Place your prop bets on FanDuel Sportsbook",
    },
  },
} as const;

export const AFFILIATE_PROMOS: Record<string, { dk: string; fd: string }> = {
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
};
