// ============================================================
// platform-config.ts — FULL REPLACEMENT
// Adds "yahoo" as a first-class Platform alongside
// "draftkings" and "fanduel". All existing DK/FD configs
// are untouched. Yahoo configs follow actual Yahoo DFS rules:
//   - $200 salary cap (Yahoo uses a $200 budget, not $50K)
//   - NBA: PG/SG/SF/PF/C/G/F/UTIL — 8 players
//   - NFL: QB/WR×3/RB×2/TE/FLEX/K — 9 players (KICKER slot)
//   - MLB: SP×2/C/1B/2B/3B/SS/OF×2 — 9 players (SP not P)
//   - NHL: C/LW/RW/D×2/G — 6 players (LW/RW split)
//   - GOLF: G×6 — 6 players (same as DK/FD)
//   - SOCCER: F×2/MF×2/D×2/GK — 7 players
// ============================================================

export type Platform = "draftkings" | "fanduel" | "yahoo";
export type Sport = "NBA" | "NHL" | "MLB" | "NFL" | "GOLF" | "SOCCER";

export const SPORT_ORDER: Sport[] = ["NBA", "GOLF", "NHL", "SOCCER", "MLB", "NFL"];
export const ACTIVE_SPORTS: Sport[] = ["NBA", "GOLF", "NHL", "SOCCER"];

export interface PlatformConfig {
  platform: Platform;
  sport: Sport;
  label: string;
  shortLabel: string;
  salaryCap: number;
  rosterSize: number;
  slots: string[];
  positionConstraints: Record<string, { min?: number; max?: number; equal?: number }>;
  aggregateConstraints?: Record<string, { min?: number; max?: number }>;
  positionFilters: string[];
}

export const PLATFORM_CONFIGS: Record<string, Record<Platform, PlatformConfig>> = {
  NBA: {
    draftkings: {
      platform: "draftkings",
      sport: "NBA",
      label: "DraftKings",
      shortLabel: "DK",
      salaryCap: 50000,
      rosterSize: 8,
      slots: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"],
      positionConstraints: {
        PG: { min: 1 },
        SG: { min: 1 },
        SF: { min: 1 },
        PF: { min: 1 },
        C: { min: 1, max: 2 },
      },
      aggregateConstraints: { G: { min: 3 }, F: { min: 3 } },
      positionFilters: ["PG", "SG", "SF", "PF", "C"],
    },
    fanduel: {
      platform: "fanduel",
      sport: "NBA",
      label: "FanDuel",
      shortLabel: "FD",
      salaryCap: 60000,
      rosterSize: 9,
      slots: ["PG", "PG2", "SG", "SG2", "SF", "SF2", "PF", "PF2", "C"],
      positionConstraints: {
        PG: { min: 2 },
        SG: { min: 2 },
        SF: { min: 2 },
        PF: { min: 2 },
        C: { min: 1, max: 1 },
      },
      aggregateConstraints: { G: { min: 4 }, F: { min: 4 } },
      positionFilters: ["PG", "SG", "SF", "PF", "C"],
    },
    yahoo: {
      platform: "yahoo",
      sport: "NBA",
      label: "Yahoo",
      shortLabel: "YH",
      salaryCap: 200,
      rosterSize: 8,
      slots: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"],
      positionConstraints: {
        PG: { min: 1 },
        SG: { min: 1 },
        SF: { min: 1 },
        PF: { min: 1 },
        C: { min: 1, max: 2 },
      },
      aggregateConstraints: { G: { min: 3 }, F: { min: 3 } },
      positionFilters: ["PG", "SG", "SF", "PF", "C"],
    },
  },
  NHL: {
    draftkings: {
      platform: "draftkings",
      sport: "NHL",
      label: "DraftKings",
      shortLabel: "DK",
      salaryCap: 50000,
      rosterSize: 9,
      slots: ["C", "C2", "W", "W2", "W3", "D", "D2", "G", "UTIL"],
      positionConstraints: {
        C: { min: 2 },
        W: { min: 3 },
        D: { min: 2 },
        G: { min: 1, max: 1 },
      },
      aggregateConstraints: { SKATER: { min: 8 } },
      positionFilters: ["C", "W", "D", "G"],
    },
    fanduel: {
      platform: "fanduel",
      sport: "NHL",
      label: "FanDuel",
      shortLabel: "FD",
      salaryCap: 55000,
      rosterSize: 9,
      slots: ["C", "C2", "W", "W2", "W3", "W4", "D", "D2", "G"],
      positionConstraints: {
        C: { min: 2 },
        W: { min: 4 },
        D: { min: 2 },
        G: { min: 1, max: 1 },
      },
      positionFilters: ["C", "W", "D", "G"],
    },
    yahoo: {
      platform: "yahoo",
      sport: "NHL",
      label: "Yahoo",
      shortLabel: "YH",
      salaryCap: 200,
      rosterSize: 6,
      // Yahoo uses LW/RW split instead of generic W
      slots: ["C", "LW", "RW", "D", "D2", "G"],
      positionConstraints: {
        C: { min: 1, max: 1 },
        LW: { min: 1, max: 1 },
        RW: { min: 1, max: 1 },
        D: { min: 2 },
        G: { min: 1, max: 1 },
      },
      positionFilters: ["C", "LW", "RW", "D", "G"],
    },
  },
  MLB: {
    draftkings: {
      platform: "draftkings",
      sport: "MLB",
      label: "DraftKings",
      shortLabel: "DK",
      salaryCap: 50000,
      rosterSize: 10,
      slots: ["P", "P2", "C", "1B", "2B", "3B", "SS", "OF", "OF2", "OF3"],
      positionConstraints: {
        P: { min: 2 },
        C: { min: 1, max: 1 },
        "1B": { min: 1, max: 1 },
        "2B": { min: 1, max: 1 },
        "3B": { min: 1, max: 1 },
        SS: { min: 1, max: 1 },
        OF: { min: 3 },
      },
      positionFilters: ["P", "C", "1B", "2B", "3B", "SS", "OF"],
    },
    fanduel: {
      platform: "fanduel",
      sport: "MLB",
      label: "FanDuel",
      shortLabel: "FD",
      salaryCap: 35000,
      rosterSize: 9,
      slots: ["P", "C/1B", "2B", "3B", "SS", "OF", "OF2", "OF3", "UTIL"],
      positionConstraints: {
        P: { min: 1, max: 1 },
        "C/1B": { min: 1 },
        "2B": { min: 1 },
        "3B": { min: 1 },
        SS: { min: 1 },
        OF: { min: 3 },
      },
      aggregateConstraints: { HITTER: { min: 8 } },
      positionFilters: ["P", "C", "1B", "2B", "3B", "SS", "OF"],
    },
    yahoo: {
      platform: "yahoo",
      sport: "MLB",
      label: "Yahoo",
      shortLabel: "YH",
      salaryCap: 200,
      rosterSize: 9,
      // Yahoo uses SP (starting pitcher) not generic P
      slots: ["SP", "SP2", "C", "1B", "2B", "3B", "SS", "OF", "OF2"],
      positionConstraints: {
        SP: { min: 2 },
        C: { min: 1, max: 1 },
        "1B": { min: 1, max: 1 },
        "2B": { min: 1, max: 1 },
        "3B": { min: 1, max: 1 },
        SS: { min: 1, max: 1 },
        OF: { min: 2 },
      },
      positionFilters: ["SP", "C", "1B", "2B", "3B", "SS", "OF"],
    },
  },
  NFL: {
    draftkings: {
      platform: "draftkings",
      sport: "NFL",
      label: "DraftKings",
      shortLabel: "DK",
      salaryCap: 50000,
      rosterSize: 9,
      slots: ["QB", "RB", "RB2", "WR", "WR2", "WR3", "TE", "FLEX", "DST"],
      positionConstraints: {
        QB: { min: 1, max: 1 },
        RB: { min: 2 },
        WR: { min: 3 },
        TE: { min: 1 },
        DST: { min: 1, max: 1 },
      },
      aggregateConstraints: { FLEX: { min: 7 } },
      positionFilters: ["QB", "RB", "WR", "TE", "DST"],
    },
    fanduel: {
      platform: "fanduel",
      sport: "NFL",
      label: "FanDuel",
      shortLabel: "FD",
      salaryCap: 60000,
      rosterSize: 9,
      slots: ["QB", "RB", "RB2", "WR", "WR2", "WR3", "TE", "FLEX", "DEF"],
      positionConstraints: {
        QB: { min: 1, max: 1 },
        RB: { min: 2 },
        WR: { min: 3 },
        TE: { min: 1 },
        DEF: { min: 1, max: 1 },
      },
      aggregateConstraints: { FLEX: { min: 7 } },
      positionFilters: ["QB", "RB", "WR", "TE", "DEF"],
    },
    yahoo: {
      platform: "yahoo",
      sport: "NFL",
      label: "Yahoo",
      shortLabel: "YH",
      salaryCap: 200,
      rosterSize: 9,
      // Yahoo NFL has a KICKER (K) slot — unique vs DK/FD
      slots: ["QB", "WR", "WR2", "WR3", "RB", "RB2", "TE", "FLEX", "K"],
      positionConstraints: {
        QB: { min: 1, max: 1 },
        WR: { min: 3 },
        RB: { min: 2 },
        TE: { min: 1 },
        K: { min: 1, max: 1 },
      },
      aggregateConstraints: { FLEX: { min: 7 } },
      positionFilters: ["QB", "RB", "WR", "TE", "K"],
    },
  },
  GOLF: {
    draftkings: {
      platform: "draftkings",
      sport: "GOLF",
      label: "DraftKings",
      shortLabel: "DK",
      salaryCap: 50000,
      rosterSize: 6,
      slots: ["G", "G2", "G3", "G4", "G5", "G6"],
      positionConstraints: { G: { equal: 6 } },
      positionFilters: ["G"],
    },
    fanduel: {
      platform: "fanduel",
      sport: "GOLF",
      label: "FanDuel",
      shortLabel: "FD",
      salaryCap: 60000,
      rosterSize: 6,
      slots: ["G", "G2", "G3", "G4", "G5", "G6"],
      positionConstraints: { G: { equal: 6 } },
      positionFilters: ["G"],
    },
    yahoo: {
      platform: "yahoo",
      sport: "GOLF",
      label: "Yahoo",
      shortLabel: "YH",
      salaryCap: 200,
      rosterSize: 6,
      slots: ["G", "G2", "G3", "G4", "G5", "G6"],
      positionConstraints: { G: { equal: 6 } },
      positionFilters: ["G"],
    },
  },
  SOCCER: {
    draftkings: {
      platform: "draftkings",
      sport: "SOCCER",
      label: "DraftKings",
      shortLabel: "DK",
      salaryCap: 50000,
      rosterSize: 8,
      slots: ["F", "F2", "M", "M2", "D", "D2", "GK", "UTIL"],
      positionConstraints: {
        F: { min: 2 },
        M: { min: 2 },
        D: { min: 2 },
        GK: { min: 1, max: 1 },
      },
      aggregateConstraints: { OUTFIELD: { min: 7 } },
      positionFilters: ["F", "M", "D", "GK"],
    },
    fanduel: {
      platform: "fanduel",
      sport: "SOCCER",
      label: "FanDuel",
      shortLabel: "FD",
      salaryCap: 60000,
      rosterSize: 7,
      slots: ["F", "F2", "M", "M2", "D", "D2", "GK"],
      positionConstraints: {
        F: { min: 2 },
        M: { min: 2 },
        D: { min: 2 },
        GK: { min: 1, max: 1 },
      },
      aggregateConstraints: { OUTFIELD: { min: 6 } },
      positionFilters: ["F", "M", "D", "GK"],
    },
    yahoo: {
      platform: "yahoo",
      sport: "SOCCER",
      label: "Yahoo",
      shortLabel: "YH",
      salaryCap: 200,
      rosterSize: 7,
      slots: ["F", "F2", "MF", "MF2", "D", "D2", "GK"],
      positionConstraints: {
        F: { min: 2 },
        MF: { min: 2 },
        D: { min: 2 },
        GK: { min: 1, max: 1 },
      },
      aggregateConstraints: { OUTFIELD: { min: 6 } },
      positionFilters: ["F", "MF", "D", "GK"],
    },
  },
};

export function getPlatformConfig(sport: string, platform: Platform): PlatformConfig {
  const sportConfigs = PLATFORM_CONFIGS[sport];
  if (!sportConfigs) throw new Error(`Unsupported sport: ${sport}`);
  const config = sportConfigs[platform];
  if (!config) throw new Error(`Unsupported platform: ${platform} for sport: ${sport}`);
  return config;
}

export function getSlotDisplayName(slot: string): string {
  return slot.replace(/\d+$/, "");
}

export function positionFitsSlot(position: string, slot: string, sport?: string): boolean {
  const displaySlot = getSlotDisplayName(slot);
  const positions = position.split("/");

  switch (displaySlot) {
    case "PG": return positions.includes("PG");
    case "SG": return positions.includes("SG");
    case "SF": return positions.includes("SF");
    case "PF": return positions.includes("PF");
    case "G":
      if (sport === "NHL") return positions.includes("G");
      if (sport === "GOLF") return positions.includes("G");
      return positions.includes("PG") || positions.includes("SG");
    case "F":
      if (sport === "SOCCER") return positions.includes("F");
      return positions.includes("SF") || positions.includes("PF");
    case "C":
      return positions.includes("C");
    case "W":
      return positions.includes("W") || positions.includes("LW") || positions.includes("RW");
    case "LW":
      return positions.includes("LW") || positions.includes("W");
    case "RW":
      return positions.includes("RW") || positions.includes("W");
    case "D":
      return positions.includes("D");
    case "P":
      return positions.includes("P") || positions.includes("SP") || positions.includes("RP");
    case "SP":
      return positions.includes("SP") || positions.includes("P");
    case "1B": return positions.includes("1B");
    case "2B": return positions.includes("2B");
    case "3B": return positions.includes("3B");
    case "SS": return positions.includes("SS");
    case "OF":
      return positions.includes("OF") || positions.includes("LF") || positions.includes("CF") || positions.includes("RF");
    case "C/1B":
      return positions.includes("C") || positions.includes("1B");
    case "QB": return positions.includes("QB");
    case "RB": return positions.includes("RB");
    case "WR": return positions.includes("WR");
    case "TE": return positions.includes("TE");
    case "DST": return positions.includes("DST");
    case "DEF": return positions.includes("DEF") || positions.includes("DST");
    case "K":
      return positions.includes("K") || positions.includes("PK");
    case "GK": return positions.includes("GK");
    case "M":
      return positions.includes("M") || positions.includes("MF");
    case "MF":
      return positions.includes("MF") || positions.includes("M");
    case "FLEX":
      return positions.includes("RB") || positions.includes("WR") || positions.includes("TE");
    case "UTIL":
      if (sport === "NHL") {
        return positions.includes("C") || positions.includes("W") || positions.includes("LW") || positions.includes("RW") || positions.includes("D");
      }
      if (sport === "MLB") {
        return !positions.includes("P") && !positions.includes("SP") && !positions.includes("RP");
      }
      if (sport === "SOCCER") {
        return positions.includes("F") || positions.includes("M") || positions.includes("MF") || positions.includes("D");
      }
      return true;
    default: return false;
  }
}

export function assignPlayersToSlots(
  players: Array<{ id: number; position: string; [key: string]: any }>,
  slots: string[],
  sport?: string
): Record<string, any | null> {
  const isFlexSlot = (base: string) => {
    if (sport === "SOCCER") return false;
    if (sport === "GOLF" && base === "G") return false;
    if (sport === "NHL" && base === "G") return false;
    return base === "G" || base === "F";
  };
  const specificSlots = slots.filter(s => {
    const base = getSlotDisplayName(s);
    return base !== "UTIL" && base !== "FLEX" && !isFlexSlot(base);
  });
  const flexSlots = slots.filter(s => {
    const base = getSlotDisplayName(s);
    return isFlexSlot(base);
  });
  const utilSlots = slots.filter(s => {
    const base = getSlotDisplayName(s);
    return base === "UTIL" || base === "FLEX";
  });
  const orderedSlots = [...specificSlots, ...flexSlots, ...utilSlots];

  function solve(slotIdx: number, used: Set<number>): Record<string, any | null> | null {
    if (slotIdx >= orderedSlots.length) {
      const result: Record<string, any | null> = {};
      slots.forEach(s => (result[s] = null));
      return result;
    }
    const slot = orderedSlots[slotIdx];
    const remainingSlots = orderedSlots.slice(slotIdx + 1);
    const eligible = players.filter(p => !used.has(p.id) && positionFitsSlot(p.position, slot, sport));
    const sorted = [...eligible].sort((a, b) => {
      const aFlex = remainingSlots.filter(s => positionFitsSlot(a.position, s, sport)).length;
      const bFlex = remainingSlots.filter(s => positionFitsSlot(b.position, s, sport)).length;
      return aFlex - bFlex;
    });
    for (const p of sorted) {
      const nextUsed = new Set(used);
      nextUsed.add(p.id);
      const result = solve(slotIdx + 1, nextUsed);
      if (result) { result[slot] = p; return result; }
    }
    return null;
  }

  const btResult = solve(0, new Set());
  if (btResult) return btResult;

  const greedyResult: Record<string, any | null> = {};
  slots.forEach(s => (greedyResult[s] = null));
  const used = new Set<number>();
  for (const slot of orderedSlots) {
    const eligible = players.filter(p => !used.has(p.id) && positionFitsSlot(p.position, slot, sport));
    if (eligible.length > 0) {
      const best = eligible.sort((a, b) => {
        const aFlex = orderedSlots.filter(s => greedyResult[s] === null && s !== slot && positionFitsSlot(a.position, s, sport)).length;
        const bFlex = orderedSlots.filter(s => greedyResult[s] === null && s !== slot && positionFitsSlot(b.position, s, sport)).length;
        return aFlex - bFlex;
      })[0];
      greedyResult[slot] = best;
      used.add(best.id);
    }
  }
  const unassigned = players.filter(p => !used.has(p.id));
  for (const p of unassigned) {
    const emptySlot = slots.find(s => greedyResult[s] === null && positionFitsSlot(p.position, s, sport));
    if (emptySlot) { greedyResult[emptySlot] = p; used.add(p.id); }
  }
  return greedyResult;
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

export const ALL_PLATFORMS: { value: Platform; label: string; shortLabel: string }[] = [
  { value: "draftkings", label: "DraftKings", shortLabel: "DK" },
  { value: "fanduel",    label: "FanDuel",    shortLabel: "FD" },
  { value: "yahoo",      label: "Yahoo",      shortLabel: "YH" },
];

export const PLATFORM_COLORS: Record<Platform, { bg: string; text: string; border: string }> = {
  draftkings: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  fanduel:    { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20"    },
  yahoo:      { bg: "bg-purple-500/10",  text: "text-purple-400",  border: "border-purple-500/20"  },
};

// Yahoo DFS does not offer a Soccer product
export const YAHOO_SUPPORTED_SPORTS: Sport[] = ["NBA", "NFL", "MLB", "NHL", "GOLF"];

export function isPlatformSupported(sport: Sport, platform: Platform): boolean {
  if (platform === "yahoo") return YAHOO_SUPPORTED_SPORTS.includes(sport);
  return true;
}
