import type { Express } from "express";
import type { IStorage } from "./storage";
import type { Player, Slate, Lineup, PlayerOverride } from "@shared/schema";
import { z } from "zod";
import { getLatestGameStart } from "./slate-lifecycle-utils";

export const retiredPlayerDetail = "No longer listed in the current contest player pool";
export function resolveConfigurationOverrides(overrides: PlayerOverride[], players: Player[]): PlayerOverride[] {
  const byId = new Map(players.map(p => [p.id, p]));
  const currentByDk = new Map(players.filter(p => p.injuryDetail !== retiredPlayerDetail && p.draftKingsPlayerId).map(p => [p.draftKingsPlayerId, p]));
  const resolved = new Map<number, PlayerOverride>();
  // A current row's settings win over its older retired alias.
  for (const override of [...overrides].sort((a, b) => Number(byId.get(b.playerId)?.injuryDetail === retiredPlayerDetail) - Number(byId.get(a.playerId)?.injuryDetail === retiredPlayerDetail))) {
    const source = byId.get(override.playerId);
    const replacement = source?.injuryDetail === retiredPlayerDetail && source.draftKingsPlayerId ? currentByDk.get(source.draftKingsPlayerId) : undefined;
    const playerId = replacement && replacement.slateId === override.slateId ? replacement.id : override.playerId;
    resolved.set(playerId, { ...override, playerId });
  }
  return Array.from(resolved.values());
}
export function configurationExpiry(slate: Slate, players: Player[]) {
  const expiresAt = new Date(getLatestGameStart(slate, players).getTime() + 3 * 3600000);
  return { expiresAt: expiresAt.toISOString(), isExpired: slate.isActive === false || Date.now() >= expiresAt.getTime() };
}

export function configurationExposures(userId: string, slateId: number, players: Player[], lineups: Lineup[], historicalPlayers: Player[] = players) {
  const scoped = lineups.filter(l => l.userId === userId && l.slateId === slateId);
  const ids = new Set(players.map(p => p.id));
  const byDk = new Map(players.filter(p => p.draftKingsPlayerId).map(p => [p.draftKingsPlayerId, p.id]));
  const historicalById = new Map(historicalPlayers.filter(p => p.slateId === slateId).map(p => [p.id, p]));
  const exposures: Record<string, { count: number; pct: number }> = Object.fromEntries(players.map(p => [p.id, { count: 0, pct: 0 }]));
  for (const lineup of scoped) {
    const snapshot = new Map((Array.isArray(lineup.playerSnapshot) ? lineup.playerSnapshot : []).map(p => [p.id, p]));
    const members = new Set(lineup.playerIds.map(id => ids.has(id) ? id : byDk.get(snapshot.get(id)?.draftKingsPlayerId ?? historicalById.get(id)?.draftKingsPlayerId ?? null)).filter((id): id is number => id !== undefined));
    for (const id of Array.from(members)) exposures[id].count++;
  }
  for (const value of Object.values(exposures)) value.pct = scoped.length ? value.count * 100 / scoped.length : 0;
  return { exposures, lineupCount: scoped.length };
}

const bodySchema = z.object({
  customProjection: z.number().finite().min(0).max(500).nullable().optional(),
  boostPercent: z.number().refine(v => [0, 5, 10, 15, 20].includes(v)).nullable().optional(),
  isExcluded: z.boolean().nullable().optional(),
  isLocked: z.boolean().nullable().optional(),
  minExposure: z.number().int().min(0).max(100).nullable().optional(),
  maxExposure: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().max(200).nullable().optional(),
  dkPlayerId: z.number().int().positive().optional(),
});
const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

type ConfigurationStorage = Pick<IStorage, "getUser" | "getSubscription" | "getSlate" | "getPlayersBySlate" | "getPlayerOverrides" | "getAllLineups" | "upsertPlayerOverride" | "deletePlayerOverride" | "deletePlayerOverridesByUser">;
export function registerPlayerConfiguration(app: Express, storage: ConfigurationStorage) {
  const handler = (mode: "configuration" | "list" | "put" | "delete" | "reset") => async (req: any, res: any) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Not logged in" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      const sub = await storage.getSubscription(userId);
      if (!user.isAdmin && (!sub || sub.tier === "free")) return res.status(403).json({ message: "Sharpshooter or Champion required" });
      if (!positiveId(req.params.slateId) || (req.params.playerId !== undefined && !positiveId(req.params.playerId))) return res.status(400).json({ message: "Invalid IDs" });
      const slateId = Number(req.params.slateId);
      const slate = await storage.getSlate(slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });
      const allPlayers = await storage.getPlayersBySlate(slateId);
      const players = allPlayers.filter(p => p.injuryDetail !== retiredPlayerDetail);
      const expiry = configurationExpiry(slate, allPlayers);
      const rawOverrides = await storage.getPlayerOverrides(userId, slateId);
      const overrides = resolveConfigurationOverrides(rawOverrides, allPlayers);
      const enriched = overrides.map(o => ({ ...o, dkPlayerId: allPlayers.find(p => p.id === o.playerId)?.draftKingsPlayerId ?? null }));
      if (mode === "list") return res.json(enriched);
      if (mode === "configuration") return res.json({ slate, ...expiry, players, overrides: enriched, ...configurationExposures(userId, slateId, players, await storage.getAllLineups(userId), allPlayers) });
      if (expiry.isExpired) return res.status(409).json({ message: "This slate has expired. Player configuration is read-only." });
      if (mode === "reset") {
        await storage.deletePlayerOverridesByUser(userId, slateId);
        return res.json({ success: true });
      }
      const parsed = bodySchema.safeParse(mode === "put" ? req.body : {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      const { dkPlayerId, ...patch } = parsed.data;
      const original = allPlayers.find(p => p.id === Number(req.params.playerId));
      // A provider ID never authorizes an arbitrary or foreign internal ID.
      if (!original || (dkPlayerId !== undefined && original.draftKingsPlayerId !== dkPlayerId)) return res.status(400).json({ message: "Player IDs do not match the selected slate. Refresh the player pool." });
      const player = original.injuryDetail === retiredPlayerDetail && dkPlayerId
        ? players.find(p => p.draftKingsPlayerId === dkPlayerId) : original;
      if (!player || (mode === "put" && player.injuryDetail === retiredPlayerDetail)) return res.status(400).json({ message: "Player is no longer available in this slate." });
      if (mode === "delete") {
        await storage.deletePlayerOverride(userId, slateId, player.id);
        for (const alias of allPlayers.filter(p => p.id !== player.id && p.draftKingsPlayerId && p.draftKingsPlayerId === player.draftKingsPlayerId && p.injuryDetail === retiredPlayerDetail)) {
          await storage.deletePlayerOverride(userId, slateId, alias.id);
        }
        return res.json({ success: true });
      }
      const old = overrides.find(o => o.playerId === player.id);
      const merged = { ...old, ...patch };
      if ((merged.minExposure ?? 0) > (merged.maxExposure ?? 100) ||
          (merged.isLocked && (merged.isExcluded || (merged.maxExposure ?? 100) < 100)) ||
          (merged.isExcluded && (merged.minExposure ?? 0) > 0)) return res.status(400).json({ message: "Conflicting lock, exclusion, or exposure settings." });
      const saved = await storage.upsertPlayerOverride({
        userId, slateId, playerId: player.id,
        customProjection: merged.customProjection == null ? null : String(merged.customProjection),
        boostPercent: merged.boostPercent ?? 0, isLocked: merged.isLocked ?? false,
        isExcluded: merged.isExcluded ?? false, minExposure: merged.minExposure ?? null,
        maxExposure: merged.maxExposure ?? null, notes: merged.notes ?? null,
      });
      for (const alias of allPlayers.filter(p => p.id !== player.id && p.draftKingsPlayerId && p.draftKingsPlayerId === player.draftKingsPlayerId && p.injuryDetail === retiredPlayerDetail)) {
        await storage.deletePlayerOverride(userId, slateId, alias.id);
      }
      return res.json(saved);
    } catch (error) {
      return res.status(500).json({ message: "Player configuration could not be loaded or saved." });
    }
  };
  app.get("/api/player-configuration/:slateId", handler("configuration"));
  app.get("/api/player-overrides/:slateId", handler("list"));
  app.put("/api/player-overrides/:slateId/:playerId", handler("put"));
  app.delete("/api/player-overrides/:slateId/:playerId", handler("delete"));
  app.delete("/api/player-overrides/:slateId", handler("reset"));
}