import { db } from "./db";
import { eq, and, inArray, lt, gte, desc, isNull, isNotNull, ne, sql } from "drizzle-orm";
import {
  slates, players, lineups, subscriptions, props, alerts, prizePicksEntries, playerHistory, winningLineups,
  type Slate, type InsertSlate,
  type Player, type InsertPlayer,
  type Lineup, type InsertLineup,
  type Subscription, type InsertSubscription,
  type Prop, type InsertProp,
  type Alert, type InsertAlert,
  type PrizePicksEntry, type InsertPrizePicksEntry,
  type PlayerHistory, type InsertPlayerHistory,
  type WinningLineup, type InsertWinningLineup,
} from "@shared/schema";

import { authStorage, type IAuthStorage } from "./replit_integrations/auth/storage";

export interface IStorage extends IAuthStorage {
  getSlates(): Promise<Slate[]>;
  getSlate(id: number): Promise<Slate | undefined>;
  createSlate(slate: InsertSlate): Promise<Slate>;
  clearAllSlatesAndPlayers(): Promise<void>;
  deleteSlateAndPlayers(slateId: number): Promise<void>;
  deletePlayersBySlate(slateId: number): Promise<void>;
  updateSlateDraftGroupId(slateId: number, draftGroupId: number): Promise<void>;
  updatePlayerDraftKingsId(playerId: number, draftKingsPlayerId: number): Promise<void>;

  getPlayersBySlate(slateId: number): Promise<Player[]>;
  getAllPlayers(): Promise<Player[]>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  bulkCreatePlayers(players: InsertPlayer[]): Promise<Player[]>;
  updatePlayerBoosts(slateId: number, boosts: { playerId: number; boostScore: string; boostReason: string }[]): Promise<void>;
  updatePlayerInjuries(updates: { playerId: number; injuryStatus: string; injuryDetail: string }[]): Promise<void>;

  getLineups(userId: string): Promise<Lineup[]>;
  createLineup(lineup: InsertLineup): Promise<Lineup>;
  updateLineup(id: number, data: { playerIds: number[]; totalSalary: number; totalProjectedPoints: string }): Promise<Lineup>;
  deleteLineup(id: number): Promise<void>;
  getLineup(id: number): Promise<Lineup | undefined>;
  getLineupCount(userId: string): Promise<number>;
  getLineupCountBySport(userId: string, sport: string): Promise<number>;
  deleteExpiredLineups(): Promise<number>;
  getAllActiveLineups(): Promise<Lineup[]>;

  getSubscription(userId: string): Promise<Subscription | undefined>;
  getSubscriptionByStripeCustomerId(customerId: string): Promise<Subscription | undefined>;
  upsertSubscription(sub: InsertSubscription): Promise<Subscription>;
  getExpiredGraceSubscriptions(): Promise<Subscription[]>;
  getUnpaidPremiumSubscriptions(): Promise<Subscription[]>;

  getPropsByDate(date: string, sport?: string): Promise<Prop[]>;
  bulkCreateProps(props: InsertProp[]): Promise<Prop[]>;
  clearPropsByDate(date: string): Promise<void>;

  getReviewLineups(userId: string): Promise<Lineup[]>;
  moveLineupsToReview(slateIds: number[]): Promise<number>;
  backfillPlayerSnapshots(): Promise<number>;
  deleteOldReviewLineups(cutoffDate: Date): Promise<number>;

  getAlerts(userId: string): Promise<Alert[]>;
  getUnreadAlertCount(userId: string): Promise<number>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  bulkCreateAlerts(alerts: InsertAlert[]): Promise<Alert[]>;
  markAlertRead(id: number, userId: string): Promise<void>;
  markAllAlertsRead(userId: string): Promise<void>;

  getPrizePicksEntries(userId: string): Promise<PrizePicksEntry[]>;
  createPrizePicksEntry(entry: InsertPrizePicksEntry): Promise<PrizePicksEntry>;
  deletePrizePicksEntry(id: number, userId: string): Promise<void>;
  getPrizePicksEntryCount(userId: string): Promise<number>;
  deleteAllPrizePicksEntries(): Promise<number>;

  bulkInsertPlayerHistory(records: InsertPlayerHistory[]): Promise<void>;
  getPlayerHistoryByName(playerName: string, sport: string, limit?: number): Promise<PlayerHistory[]>;
  getPlayerHistoryBySport(sport: string, limit?: number): Promise<PlayerHistory[]>;
  cleanOldPlayerHistory(daysToKeep: number): Promise<number>;
  updatePlayerHistoryActualPoints(sport: string, slateDate: string, playerName: string, actualPoints: string): Promise<void>;

  createWinningLineup(data: InsertWinningLineup): Promise<WinningLineup>;
  getWinningLineups(sport?: string, limit?: number): Promise<WinningLineup[]>;
  getWinningLineupBySlateDate(sport: string, slateDate: string): Promise<WinningLineup | undefined>;
}

export class DatabaseStorage implements IStorage {
  getUser = authStorage.getUser.bind(authStorage);
  upsertUser = authStorage.upsertUser.bind(authStorage);

  async getSlates(): Promise<Slate[]> {
    return await db.select().from(slates).orderBy(slates.startTime);
  }

  async getSlate(id: number): Promise<Slate | undefined> {
    const [slate] = await db.select().from(slates).where(eq(slates.id, id));
    return slate;
  }

  async createSlate(insertSlate: InsertSlate): Promise<Slate> {
    const [slate] = await db.insert(slates).values(insertSlate).returning();
    return slate;
  }

  async clearAllSlatesAndPlayers(): Promise<void> {
    await db.delete(players);
    await db.delete(slates);
  }

  async deleteSlateAndPlayers(slateId: number): Promise<void> {
    const slateLineups = await db.select().from(lineups).where(eq(lineups.slateId, slateId));
    if (slateLineups.length > 0) {
      const slatePlayers = await db.select().from(players).where(eq(players.slateId, slateId));
      for (const lineup of slateLineups) {
        if (!lineup.playerSnapshot || (Array.isArray(lineup.playerSnapshot) && (lineup.playerSnapshot as any[]).length === 0)) {
          const rosterPlayers = slatePlayers.filter(p => lineup.playerIds.includes(p.id));
          if (rosterPlayers.length > 0) {
            const snapshot = rosterPlayers.map(p => ({
              id: p.id, name: p.name, team: p.team, position: p.position,
              salary: p.salary, fppg: p.fppg, projectedPoints: p.projectedPoints,
              opponent: p.opponent, gameInfo: p.gameInfo,
              draftKingsPlayerId: p.draftKingsPlayerId,
              boostScore: p.boostScore, boostReason: p.boostReason,
            }));
            await db.update(lineups).set({ playerSnapshot: snapshot, status: "review", reviewedAt: new Date() }).where(eq(lineups.id, lineup.id));
          } else {
            await db.update(lineups).set({ status: "review", reviewedAt: new Date() }).where(eq(lineups.id, lineup.id));
          }
        } else {
          await db.update(lineups).set({ status: "review", reviewedAt: new Date() }).where(eq(lineups.id, lineup.id));
        }
      }
      const lineupIds = slateLineups.map(l => l.id);
      await db.update(alerts).set({ lineupId: null }).where(inArray(alerts.lineupId, lineupIds));
    }
    const slatePlayers = await db.select({ id: players.id }).from(players).where(eq(players.slateId, slateId));
    if (slatePlayers.length > 0) {
      const playerIds = slatePlayers.map(p => p.id);
      await db.update(props).set({ playerId: null }).where(inArray(props.playerId, playerIds));
      await db.update(alerts).set({ playerId: null }).where(inArray(alerts.playerId, playerIds));
    }
    await db.delete(players).where(eq(players.slateId, slateId));
    const remainingLineups = await db.select({ id: lineups.id }).from(lineups).where(eq(lineups.slateId, slateId));
    if (remainingLineups.length === 0) {
      await db.delete(slates).where(eq(slates.id, slateId));
    } else {
      console.log(`[Storage] Keeping slate ${slateId} — ${remainingLineups.length} review lineups still reference it`);
    }
  }

  async deletePlayersBySlate(slateId: number): Promise<void> {
    const slatePlayers = await db.select({ id: players.id }).from(players).where(eq(players.slateId, slateId));
    if (slatePlayers.length > 0) {
      const playerIds = slatePlayers.map(p => p.id);
      await db.update(props).set({ playerId: null }).where(inArray(props.playerId, playerIds));
      await db.update(alerts).set({ playerId: null }).where(inArray(alerts.playerId, playerIds));
    }
    await db.delete(players).where(eq(players.slateId, slateId));
  }

  async updateSlateDraftGroupId(slateId: number, draftGroupId: number): Promise<void> {
    await db.update(slates).set({ draftGroupId }).where(eq(slates.id, slateId));
  }

  async updateSlateData(slateId: number, data: { name?: string; startTime?: Date; draftGroupId?: number | null }): Promise<void> {
    const update: any = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.startTime !== undefined) update.startTime = data.startTime;
    if (data.draftGroupId !== undefined) update.draftGroupId = data.draftGroupId;
    await db.update(slates).set(update).where(eq(slates.id, slateId));
  }

  async updatePlayerDraftKingsId(playerId: number, draftKingsPlayerId: number): Promise<void> {
    await db.update(players).set({ draftKingsPlayerId }).where(eq(players.id, playerId));
  }

  async getPlayersBySlate(slateId: number): Promise<Player[]> {
    return await db.select().from(players).where(eq(players.slateId, slateId));
  }

  async getAllPlayers(): Promise<Player[]> {
    return await db.select().from(players);
  }

  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const [player] = await db.insert(players).values(insertPlayer).returning();
    return player;
  }

  async bulkCreatePlayers(insertPlayers: InsertPlayer[]): Promise<Player[]> {
    return await db.insert(players).values(insertPlayers).returning();
  }

  async updatePlayerBoosts(slateId: number, boosts: { playerId: number; boostScore: string; boostReason: string }[]): Promise<void> {
    for (const boost of boosts) {
      await db.update(players)
        .set({ boostScore: boost.boostScore, boostReason: boost.boostReason })
        .where(and(eq(players.id, boost.playerId), eq(players.slateId, slateId)));
    }
  }

  async updatePlayerInjuries(updates: { playerId: number; injuryStatus: string; injuryDetail: string }[]): Promise<void> {
    for (const update of updates) {
      await db.update(players)
        .set({ injuryStatus: update.injuryStatus, injuryDetail: update.injuryDetail })
        .where(eq(players.id, update.playerId));
    }
  }

  async getLineups(userId: string): Promise<Lineup[]> {
    const now = new Date();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, now));
    if (activeSlateIds.length === 0) return [];
    const ids = activeSlateIds.map(s => s.id);
    return await db.select().from(lineups).where(
      and(eq(lineups.userId, userId), inArray(lineups.slateId, ids), eq(lineups.status, "active"))
    );
  }

  async createLineup(insertLineup: InsertLineup): Promise<Lineup> {
    const [lineup] = await db.insert(lineups).values(insertLineup).returning();
    return lineup;
  }

  async updateLineup(id: number, data: { playerIds: number[]; totalSalary: number; totalProjectedPoints: string; playerSnapshot?: any }): Promise<Lineup> {
    const setData: any = { playerIds: data.playerIds, totalSalary: data.totalSalary, totalProjectedPoints: data.totalProjectedPoints };
    if (data.playerSnapshot) setData.playerSnapshot = data.playerSnapshot;
    const [updated] = await db.update(lineups)
      .set(setData)
      .where(eq(lineups.id, id))
      .returning();
    return updated;
  }

  async deleteLineup(id: number): Promise<void> {
    await db.delete(alerts).where(eq(alerts.lineupId, id));
    await db.delete(lineups).where(eq(lineups.id, id));
  }

  async getLineup(id: number): Promise<Lineup | undefined> {
    const [lineup] = await db.select().from(lineups).where(eq(lineups.id, id));
    return lineup;
  }

  async getLineupCount(userId: string): Promise<number> {
    const now = new Date();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, now));
    if (activeSlateIds.length === 0) return 0;
    const ids = activeSlateIds.map(s => s.id);
    const rows = await db.select().from(lineups).where(
      and(eq(lineups.userId, userId), inArray(lineups.slateId, ids))
    );
    return rows.length;
  }

  async getLineupCountBySport(userId: string, sport: string): Promise<number> {
    const now = new Date();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, now));
    if (activeSlateIds.length === 0) return 0;
    const ids = activeSlateIds.map(s => s.id);
    const rows = await db.select().from(lineups).where(
      and(eq(lineups.userId, userId), eq(lineups.sport, sport), inArray(lineups.slateId, ids))
    );
    return rows.length;
  }

  async deleteExpiredLineups(): Promise<number> {
    const now = new Date();
    const expiredSlateIds = await db.select({ id: slates.id }).from(slates).where(lt(slates.startTime, now));
    if (expiredSlateIds.length === 0) return 0;
    const ids = expiredSlateIds.map(s => s.id);
    const activeLineups = await db.select().from(lineups)
      .where(and(inArray(lineups.slateId, ids), eq(lineups.status, "active")));
    if (activeLineups.length === 0) return 0;

    for (const lineup of activeLineups) {
      const allPlayers = await db.select().from(players).where(eq(players.slateId, lineup.slateId));
      const rosterPlayers = allPlayers.filter(p => lineup.playerIds.includes(p.id));
      if (rosterPlayers.length > 0) {
        const snapshot = rosterPlayers.map(p => ({
          id: p.id, name: p.name, team: p.team, position: p.position,
          salary: p.salary, fppg: p.fppg, projectedPoints: p.projectedPoints,
          opponent: p.opponent, gameInfo: p.gameInfo,
          draftKingsPlayerId: p.draftKingsPlayerId,
          boostScore: p.boostScore, boostReason: p.boostReason,
        }));
        await db.update(lineups)
          .set({ status: "review", reviewedAt: now, playerSnapshot: snapshot })
          .where(eq(lineups.id, lineup.id));
      } else {
        await db.update(lineups)
          .set({ status: "review", reviewedAt: now })
          .where(eq(lineups.id, lineup.id));
      }
    }
    return activeLineups.length;
  }

  async getAllActiveLineups(): Promise<Lineup[]> {
    const now = new Date();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, now));
    if (activeSlateIds.length === 0) return [];
    const ids = activeSlateIds.map(s => s.id);
    return await db.select().from(lineups).where(inArray(lineups.slateId, ids));
  }

  async getReviewLineups(userId: string): Promise<Lineup[]> {
    return await db.select().from(lineups).where(
      and(eq(lineups.userId, userId), eq(lineups.status, "review"))
    );
  }

  async moveLineupsToReview(slateIds: number[]): Promise<number> {
    if (slateIds.length === 0) return 0;
    const now = new Date();
    const activeLineups = await db.select().from(lineups)
      .where(and(inArray(lineups.slateId, slateIds), eq(lineups.status, "active")));
    if (activeLineups.length === 0) return 0;

    for (const lineup of activeLineups) {
      const allPlayers = await db.select().from(players).where(eq(players.slateId, lineup.slateId));
      const rosterPlayers = allPlayers.filter(p => lineup.playerIds.includes(p.id));
      if (rosterPlayers.length > 0) {
        const snapshot = rosterPlayers.map(p => ({
          id: p.id, name: p.name, team: p.team, position: p.position,
          salary: p.salary, fppg: p.fppg, projectedPoints: p.projectedPoints,
          opponent: p.opponent, gameInfo: p.gameInfo,
          draftKingsPlayerId: p.draftKingsPlayerId,
          boostScore: p.boostScore, boostReason: p.boostReason,
        }));
        await db.update(lineups)
          .set({ status: "review", reviewedAt: now, playerSnapshot: snapshot })
          .where(eq(lineups.id, lineup.id));
      } else {
        await db.update(lineups)
          .set({ status: "review", reviewedAt: now })
          .where(eq(lineups.id, lineup.id));
      }
    }
    return activeLineups.length;
  }

  async backfillPlayerSnapshots(): Promise<number> {
    const lineupsWithoutSnapshot = await db.select().from(lineups)
      .where(sql`${lineups.playerSnapshot} IS NULL`);
    if (lineupsWithoutSnapshot.length === 0) return 0;

    let count = 0;
    for (const lineup of lineupsWithoutSnapshot) {
      const allPlayers = await db.select().from(players).where(eq(players.slateId, lineup.slateId));
      const rosterPlayers = allPlayers.filter(p => lineup.playerIds.includes(p.id));
      if (rosterPlayers.length > 0) {
        const snapshot = rosterPlayers.map(p => ({
          id: p.id, name: p.name, team: p.team, position: p.position,
          salary: p.salary, fppg: p.fppg, projectedPoints: p.projectedPoints,
          opponent: p.opponent, gameInfo: p.gameInfo,
          draftKingsPlayerId: p.draftKingsPlayerId,
          boostScore: p.boostScore, boostReason: p.boostReason,
        }));
        await db.update(lineups).set({ playerSnapshot: snapshot }).where(eq(lineups.id, lineup.id));
        count++;
      }
    }
    return count;
  }

  async deleteOldReviewLineups(cutoffDate: Date): Promise<number> {
    const deleted = await db.delete(lineups)
      .where(and(eq(lineups.status, "review"), lt(lineups.reviewedAt, cutoffDate)))
      .returning();
    return deleted.length;
  }

  async getSubscription(userId: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return sub;
  }

  async upsertSubscription(sub: InsertSubscription): Promise<Subscription> {
    const existing = await this.getSubscription(sub.userId);
    if (existing) {
      const [updated] = await db.update(subscriptions)
        .set({ ...sub, updatedAt: new Date() })
        .where(eq(subscriptions.userId, sub.userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(subscriptions).values(sub).returning();
    return created;
  }

  async getSubscriptionByStripeCustomerId(customerId: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId));
    return sub;
  }

  async getExpiredGraceSubscriptions(): Promise<Subscription[]> {
    return await db.select().from(subscriptions).where(
      and(
        isNotNull(subscriptions.graceEndsAt),
        lt(subscriptions.graceEndsAt, new Date()),
        ne(subscriptions.tier, "free")
      )
    );
  }

  async getUnpaidPremiumSubscriptions(): Promise<Subscription[]> {
    return await db.select().from(subscriptions).where(
      and(
        ne(subscriptions.tier, "free"),
        isNull(subscriptions.stripeSubscriptionId),
        isNull(subscriptions.graceEndsAt)
      )
    );
  }

  async getPropsByDate(date: string, sport?: string): Promise<Prop[]> {
    if (sport) {
      return await db.select().from(props).where(
        and(eq(props.createdDate, date), eq(props.sport, sport))
      );
    }
    return await db.select().from(props).where(eq(props.createdDate, date));
  }

  async bulkCreateProps(insertProps: InsertProp[]): Promise<Prop[]> {
    if (insertProps.length === 0) return [];
    return await db.insert(props).values(insertProps).returning();
  }

  async clearPropsByDate(date: string): Promise<void> {
    await db.delete(props).where(eq(props.createdDate, date));
  }

  async getAlerts(userId: string): Promise<Alert[]> {
    return await db.select().from(alerts)
      .where(eq(alerts.userId, userId))
      .orderBy(desc(alerts.createdAt));
  }

  async getUnreadAlertCount(userId: string): Promise<number> {
    const rows = await db.select().from(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.isRead, false)));
    return rows.length;
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [created] = await db.insert(alerts).values(alert).returning();
    return created;
  }

  async bulkCreateAlerts(insertAlerts: InsertAlert[]): Promise<Alert[]> {
    if (insertAlerts.length === 0) return [];
    return await db.insert(alerts).values(insertAlerts).returning();
  }

  async markAlertRead(id: number, userId: string): Promise<void> {
    await db.update(alerts)
      .set({ isRead: true })
      .where(and(eq(alerts.id, id), eq(alerts.userId, userId)));
  }

  async markAllAlertsRead(userId: string): Promise<void> {
    await db.update(alerts)
      .set({ isRead: true })
      .where(eq(alerts.userId, userId));
  }

  async getPrizePicksEntries(userId: string): Promise<PrizePicksEntry[]> {
    return await db.select().from(prizePicksEntries)
      .where(eq(prizePicksEntries.userId, userId))
      .orderBy(desc(prizePicksEntries.createdAt));
  }

  async createPrizePicksEntry(entry: InsertPrizePicksEntry): Promise<PrizePicksEntry> {
    const [created] = await db.insert(prizePicksEntries).values(entry).returning();
    return created;
  }

  async deletePrizePicksEntry(id: number, userId: string): Promise<void> {
    await db.delete(prizePicksEntries)
      .where(and(eq(prizePicksEntries.id, id), eq(prizePicksEntries.userId, userId)));
  }

  async getPrizePicksEntryCount(userId: string): Promise<number> {
    const rows = await db.select().from(prizePicksEntries)
      .where(eq(prizePicksEntries.userId, userId));
    return rows.length;
  }

  async deleteAllPrizePicksEntries(): Promise<number> {
    const all = await db.select({ id: prizePicksEntries.id }).from(prizePicksEntries);
    if (all.length === 0) return 0;
    await db.delete(prizePicksEntries);
    return all.length;
  }

  async bulkInsertPlayerHistory(records: InsertPlayerHistory[]): Promise<void> {
    if (records.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await db.insert(playerHistory).values(batch);
    }
  }

  async getPlayerHistoryByName(playerName: string, sport: string, limit = 30): Promise<PlayerHistory[]> {
    return await db.select().from(playerHistory)
      .where(and(eq(playerHistory.playerName, playerName), eq(playerHistory.sport, sport)))
      .orderBy(desc(playerHistory.slateDate))
      .limit(limit);
  }

  async getPlayerHistoryBySport(sport: string, limit = 500): Promise<PlayerHistory[]> {
    return await db.select().from(playerHistory)
      .where(eq(playerHistory.sport, sport))
      .orderBy(desc(playerHistory.slateDate))
      .limit(limit);
  }

  async cleanOldPlayerHistory(daysToKeep: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const deleted = await db.delete(playerHistory)
      .where(lt(playerHistory.slateDate, cutoffStr))
      .returning();
    return deleted.length;
  }

  async updatePlayerHistoryActualPoints(sport: string, slateDate: string, playerName: string, actualPoints: string): Promise<void> {
    await db.update(playerHistory)
      .set({ actualPoints })
      .where(and(
        eq(playerHistory.sport, sport),
        eq(playerHistory.slateDate, slateDate),
        eq(playerHistory.playerName, playerName)
      ));
  }

  async createWinningLineup(data: InsertWinningLineup): Promise<WinningLineup> {
    const [result] = await db.insert(winningLineups).values(data).returning();
    return result;
  }

  async getWinningLineups(sport?: string, limit = 30): Promise<WinningLineup[]> {
    if (sport) {
      return await db.select().from(winningLineups)
        .where(eq(winningLineups.sport, sport))
        .orderBy(desc(winningLineups.slateDate))
        .limit(limit);
    }
    return await db.select().from(winningLineups)
      .orderBy(desc(winningLineups.slateDate))
      .limit(limit);
  }

  async getWinningLineupBySlateDate(sport: string, slateDate: string): Promise<WinningLineup | undefined> {
    const [result] = await db.select().from(winningLineups)
      .where(and(eq(winningLineups.sport, sport), eq(winningLineups.slateDate, slateDate)));
    return result;
  }
}

export const storage = new DatabaseStorage();
