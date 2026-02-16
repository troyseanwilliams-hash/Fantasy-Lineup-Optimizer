export type Platform = "draftkings" | "fanduel";

export interface PlatformConfig {
  platform: Platform;
  label: string;
  shortLabel: string;
  salaryCap: number;
  rosterSize: number;
  slots: string[];
  positionConstraints: Record<string, { min?: number; max?: number; equal?: number }>;
}

export const PLATFORM_CONFIGS: Record<string, Record<Platform, PlatformConfig>> = {
  NBA: {
    draftkings: {
      platform: "draftkings",
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
        G: { min: 3 },
        F: { min: 3 },
      },
    },
    fanduel: {
      platform: "fanduel",
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
        G: { min: 4 },
        F: { min: 4 },
      },
    },
  },
};

export function getPlatformConfig(sport: string, platform: Platform): PlatformConfig {
  const sportConfigs = PLATFORM_CONFIGS[sport];
  if (!sportConfigs) throw new Error(`Unsupported sport: ${sport}`);
  const config = sportConfigs[platform];
  if (!config) throw new Error(`Unsupported platform: ${platform}`);
  return config;
}

export function getSlotDisplayName(slot: string): string {
  return slot.replace(/\d+$/, "");
}

export function positionFitsSlot(position: string, slot: string): boolean {
  const displaySlot = getSlotDisplayName(slot);
  const positions = position.split("/");
  switch (displaySlot) {
    case "PG": return positions.includes("PG");
    case "SG": return positions.includes("SG");
    case "SF": return positions.includes("SF");
    case "PF": return positions.includes("PF");
    case "C": return positions.includes("C");
    case "G": return positions.includes("PG") || positions.includes("SG");
    case "F": return positions.includes("SF") || positions.includes("PF");
    case "UTIL": return true;
    default: return false;
  }
}

export function assignPlayersToSlots(
  players: Array<{ id: number; position: string; [key: string]: any }>,
  slots: string[]
): Record<string, any | null> {
  function solve(slotIdx: number, used: Set<number>): Record<string, any | null> | null {
    if (slotIdx >= slots.length) {
      const result: Record<string, any | null> = {};
      slots.forEach(s => result[s] = null);
      return result;
    }
    const slot = slots[slotIdx];
    const eligible = players.filter(p => !used.has(p.id) && positionFitsSlot(p.position, slot));

    const sorted = [...eligible].sort((a, b) => {
      const aSlots = slots.filter(s => s !== slot && positionFitsSlot(a.position, s)).length;
      const bSlots = slots.filter(s => s !== slot && positionFitsSlot(b.position, s)).length;
      return aSlots - bSlots;
    });

    for (const p of sorted) {
      const nextUsed = new Set(used);
      nextUsed.add(p.id);
      const result = solve(slotIdx + 1, nextUsed);
      if (result) {
        result[slot] = p;
        return result;
      }
    }
    return null;
  }

  const emptyResult: Record<string, any | null> = {};
  slots.forEach(s => emptyResult[s] = null);
  return solve(0, new Set()) || emptyResult;
}
