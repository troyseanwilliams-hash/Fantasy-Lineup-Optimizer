import type { Player } from "@shared/schema";
import type { Platform, Sport } from "@shared/platform-config";
import { apiRequest } from "@/lib/queryClient";

export interface ExportSlate {
  id: number;
  sport: string;
  platform: string;
  draftGroupId: number | null;
  gameType: string | null;
  label: string | null;
  name: string;
}

export interface ExportPlayersResponse {
  slate: ExportSlate;
  players: Player[];
}

interface ResolveExportPlayersArgs {
  slateId: number;
  playerIds: number[];
  captainId?: number;
}

/**
 * Resolve internal roster IDs to the platform IDs for the current draft group.
 * This endpoint is deliberately called at export time: IDs on the player pool
 * can be stale after a slate rolls over to a new draft group.
 */
export async function resolveExportPlayers({
  slateId,
  playerIds,
  captainId,
}: ResolveExportPlayersArgs): Promise<ExportPlayersResponse> {
  const uniquePlayerIds = Array.from(new Set(playerIds.map(Number)));
  if (uniquePlayerIds.length === 0 || uniquePlayerIds.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error("No valid players were available to export.");
  }

  const payload: { slateId: number; playerIds: number[]; captainId?: number } = {
    slateId,
    playerIds: uniquePlayerIds,
  };
  if (captainId !== undefined) payload.captainId = captainId;

  const response = await apiRequest("POST", "/api/exports/resolve-players", payload);
  const result = await response.json() as ExportPlayersResponse;
  if (!result?.slate || !Array.isArray(result.players)) {
    throw new Error("The export resolver returned an invalid response.");
  }
  return result;
}

export function validateExportSlate(
  result: ExportPlayersResponse,
  expected: { slateId: number; sport: Sport | string; platform: Platform | string },
): void {
  if (Number(result.slate.id) !== Number(expected.slateId)) {
    throw new Error("The export slate changed before player IDs were resolved.");
  }
  if (String(result.slate.sport).toLowerCase() !== String(expected.sport).toLowerCase()) {
    throw new Error("The export resolver returned a different sport.");
  }
  if (String(result.slate.platform).toLowerCase() !== String(expected.platform).toLowerCase()) {
    throw new Error("The export resolver returned a different platform.");
  }
}

export function resolvedPlayersById(result: ExportPlayersResponse): Map<number, Player> {
  const byId = new Map<number, Player>();
  for (const player of result.players) {
    const id = Number(player?.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (byId.has(id)) throw new Error("The export resolver returned duplicate players.");
    byId.set(id, player);
  }
  return byId;
}

export function formatResolvedPlayer(player: Player, platform: Platform | string): string {
  if (!player || !player.name) throw new Error("A roster slot is missing its player name.");
  if (platform === "draftkings") {
    const id = Number(player.draftKingsPlayerId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`DraftKings ID missing for ${player.name}.`);
    }
    return `${player.name} (${id})`;
  }
  if (platform === "fanduel") {
    const id = Number(player.fanDuelPlayerId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`FanDuel ID missing for ${player.name}.`);
    }
    return `${id}:${player.name}`;
  }
  return player.name;
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, "\"\"")}"`;
  return value;
}

export function exportFilename(
  slate: ExportSlate,
  sport: Sport | string,
  platform: Platform | string,
  suffix: string,
): string {
  const clean = (value: string) => value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "slate";
  const slateName = clean(slate.label || slate.name || `slate-${slate.id}`);
  const draftGroup = slate.draftGroupId == null ? "DGunknown" : `DG${slate.draftGroupId}`;
  return `${slateName}_slate${slate.id}_${draftGroup}_${clean(String(sport))}_${clean(String(platform))}_${suffix}.csv`;
}