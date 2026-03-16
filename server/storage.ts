import { db } from "./db";
import { eq, and, inArray, lt, gte, desc, isNull, isNotNull, ne, sql } from "drizzle-orm";

function getTodayLineupCutoff(): Date {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etDate = new Date(etStr);
  const etHour = etDate.getHours();

  const cutoff = new Date(etDate);
  if (etHour < 5) {
    cutoff.setDate(cutoff.getDate() - 1);
  }
  cutoff.setHours(5, 0, 0, 0);

  const offsetMs = now.getTime() - etDate.getTime();
  return new Date(cutoff.getTime() + offsetMs);
}
import {
  slates, players, lineups, subscriptions, props, alerts, prizePicksEntries, playerHistory, winningLineups, playerOverrides,
  lineupScores, alertDeliveries, notificationPreferences, performanceSnapshots,
  type Slate, type InsertSlate,
  type Player, type InsertPlayer,
  type Lineup, type InsertLineup,
  type Subscription, type InsertSubscription,
  type Prop, type InsertProp,
  type Alert, type InsertAlert,
  type PrizePicksEntry, type InsertPrizePicksEntry,
  type PlayerHistory, type InsertPlayerHistory,
  type WinningLineup, type InsertWinningLineup,
  type PlayerOverride, type InsertPlayerOverride,
  type LineupScore, type InsertLineupScore,
  type AlertDelivery, type InsertAlertDelivery,
  type NotificationPreference, type InsertNotificationPreference,
  type PerformanceSnapshot, type InsertPerformanceSnapshot,
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
  batchUpdatePlayerHistoryActualPoints(sport: string, slateDate: string, updates: Array<{ playerName: string; actualPoints: string }>): Promise<void>;
  getZeroPointPlayerNames(sport: string, minAppearances?: number): Promise<string[]>;

  createWinningLineup(data: InsertWinningLineup): Promise<WinningLineup>;
  getWinningLineups(sport?: string, limit?: number): Promise<WinningLineup[]>;
  getWinningLineupsBySport(sport: string): Promise<WinningLineup[]>;
  getWinningLineupBySlateDate(sport: string, slateDate: string, platform?: string): Promise<WinningLineup | undefined>;
  deleteWinningLineup(id: number): Promise<void>;

  getPlayerOverrides(userId: string, slateId: number): Promise<PlayerOverride[]>;
  upsertPlayerOverride(data: InsertPlayerOverride): Promise<PlayerOverride>;
  deletePlayerOverride(userId: string, slateId: number, playerId: number): Promise<void>;
  deletePlayerOverridesBySlate(slateId: number): Promise<void>;
  deletePlayerOverridesByUser(userId: string, slateId: number): Promise<void>;

  getAllLineups(userId: string): Promise<Lineup[]>;
  getLineupScores(userId: string): Promise<LineupScore[]>;
  getLineupScore(lineupId: number): Promise<LineupScore | undefined>;
  upsertLineupScore(data: InsertLineupScore): Promise<LineupScore>;

  getNotificationPreferences(userId: string): Promise<NotificationPreference | undefined>;
  upsertNotificationPreferences(data: InsertNotificationPreference): Promise<NotificationPreference>;

  createAlertDelivery(data: InsertAlertDelivery): Promise<AlertDelivery>;
  getAlertDeliveries(alertId: number): Promise<AlertDelivery[]>;

  getPerformanceSnapshots(userId: string, sport?: string): Promise<PerformanceSnapshot[]>;
  createPerformanceSnapshot(data: InsertPerformanceSnapshot): Promise<PerformanceSnapshot>;
  getAggregatePerformance(userId: string): Promise<{
    totalSlates: number;
    avgVsOptimal: number;
    avgVsField: number;
    avgAccuracy: number;
    sportBreakdown: Record<string, { slates: number; avgVsOptimal: number; avgVsField: number; avgAccuracy: number }>;
  }>;
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
    const allSlates = await db.select({ id: slates.id }).from(slates);
    for (const slate of allSlates) {
      await this.deleteSlateAndPlayers(slate.id);
    }
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
    await db.delete(playerOverrides).where(eq(playerOverrides.slateId, slateId));
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
    await db.delete(playerOverrides).where(eq(playerOverrides.slateId, slateId));
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
    const cutoff = getTodayLineupCutoff();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, cutoff));
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
    const cutoff = getTodayLineupCutoff();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, cutoff));
    if (activeSlateIds.length === 0) return 0;
    const ids = activeSlateIds.map(s => s.id);
    const rows = await db.select().from(lineups).where(
      and(eq(lineups.userId, userId), inArray(lineups.slateId, ids))
    );
    return rows.length;
  }

  async getLineupCountBySport(userId: string, sport: string): Promise<number> {
    const cutoff = getTodayLineupCutoff();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, cutoff));
    if (activeSlateIds.length === 0) return 0;
    const ids = activeSlateIds.map(s => s.id);
    const rows = await db.select().from(lineups).where(
      and(eq(lineups.userId, userId), eq(lineups.sport, sport), inArray(lineups.slateId, ids))
    );
    return rows.length;
  }

  async deleteExpiredLineups(): Promise<number> {
    const now = new Date();
    const etHour = parseInt(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(now));
    if (etHour < 5 || etHour > 10) return 0;

    const cutoff = getTodayLineupCutoff();
    const expiredSlateIds = await db.select({ id: slates.id }).from(slates).where(lt(slates.startTime, cutoff));
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
    const cutoff = getTodayLineupCutoff();
    const activeSlateIds = await db.select({ id: slates.id }).from(slates).where(gte(slates.startTime, cutoff));
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

  async batchUpdatePlayerHistoryActualPoints(sport: string, slateDate: string, updates: Array<{ playerName: string; actualPoints: string }>): Promise<void> {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(u =>
        db.update(playerHistory)
          .set({ actualPoints: u.actualPoints })
          .where(and(
            eq(playerHistory.sport, sport),
            eq(playerHistory.slateDate, slateDate),
            eq(playerHistory.playerName, u.playerName)
          ))
      ));
    }
  }

  async getZeroPointPlayerNames(sport: string, minAppearances = 2): Promise<string[]> {
    const results = await db.execute(sql`
      WITH ranked AS (
        SELECT player_name, actual_points, projected_points,
          ROW_NUMBER() OVER (PARTITION BY player_name ORDER BY slate_date DESC) as rn
        FROM player_history
        WHERE sport = ${sport}
          AND CAST(projected_points AS NUMERIC) > 0
      )
      SELECT player_name
      FROM ranked
      WHERE rn <= 5
      GROUP BY player_name
      HAVING COUNT(*) >= ${minAppearances}
        AND SUM(CASE WHEN actual_points IS NOT NULL AND CAST(actual_points AS NUMERIC) > 1 THEN 1 ELSE 0 END) = 0
        AND SUM(CASE WHEN actual_points IS NOT NULL THEN 1 ELSE 0 END) >= 1
    `);
    return (results.rows as Array<{ player_name: string }>).map(r => r.player_name);
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

  async getWinningLineupsBySport(sport: string): Promise<WinningLineup[]> {
    return await db.select().from(winningLineups)
      .where(eq(winningLineups.sport, sport))
      .orderBy(desc(winningLineups.slateDate));
  }

  async getWinningLineupBySlateDate(sport: string, slateDate: string, platform?: string): Promise<WinningLineup | undefined> {
    const conditions = [eq(winningLineups.sport, sport), eq(winningLineups.slateDate, slateDate)];
    if (platform) {
      conditions.push(eq(winningLineups.platform, platform));
    }
    const [result] = await db.select().from(winningLineups).where(and(...conditions));
    return result;
  }

  async deleteWinningLineup(id: number): Promise<void> {
    await db.delete(winningLineups).where(eq(winningLineups.id, id));
  }

  async getPlayerOverrides(userId: string, slateId: number): Promise<PlayerOverride[]> {
    return await db.select().from(playerOverrides)
      .where(and(eq(playerOverrides.userId, userId), eq(playerOverrides.slateId, slateId)));
  }

  async upsertPlayerOverride(data: InsertPlayerOverride): Promise<PlayerOverride> {
    const existing = await db.select().from(playerOverrides)
      .where(and(
        eq(playerOverrides.userId, data.userId),
        eq(playerOverrides.slateId, data.slateId),
        eq(playerOverrides.playerId, data.playerId)
      ));
    if (existing.length > 0) {
      const [updated] = await db.update(playerOverrides)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(playerOverrides.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(playerOverrides).values(data).returning();
    return created;
  }

  async deletePlayerOverride(userId: string, slateId: number, playerId: number): Promise<void> {
    await db.delete(playerOverrides)
      .where(and(
        eq(playerOverrides.userId, userId),
        eq(playerOverrides.slateId, slateId),
        eq(playerOverrides.playerId, playerId)
      ));
  }

  async deletePlayerOverridesBySlate(slateId: number): Promise<void> {
    await db.delete(playerOverrides).where(eq(playerOverrides.slateId, slateId));
  }

  async deletePlayerOverridesByUser(userId: string, slateId: number): Promise<void> {
    await db.delete(playerOverrides)
      .where(and(eq(playerOverrides.userId, userId), eq(playerOverrides.slateId, slateId)));
  }

  async getAllLineups(userId: string): Promise<Lineup[]> {
    return await db.select().from(lineups)
      .where(eq(lineups.userId, userId))
      .orderBy(desc(lineups.id));
  }

  async getLineupScores(userId: string): Promise<LineupScore[]> {
    return await db.select().from(lineupScores)
      .where(eq(lineupScores.userId, userId))
      .orderBy(desc(lineupScores.lastUpdated));
  }

  async getLineupScore(lineupId: number): Promise<LineupScore | undefined> {
    const [result] = await db.select().from(lineupScores)
      .where(eq(lineupScores.lineupId, lineupId)).limit(1);
    return result;
  }

  async upsertLineupScore(data: InsertLineupScore): Promise<LineupScore> {
    const existing = await this.getLineupScore(data.lineupId);
    if (existing) {
      const [updated] = await db.update(lineupScores)
        .set({ ...data, lastUpdated: new Date() })
        .where(eq(lineupScores.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(lineupScores).values(data).returning();
    return created;
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreference | undefined> {
    const [result] = await db.select().from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId)).limit(1);
    return result;
  }

  async upsertNotificationPreferences(data: InsertNotificationPreference): Promise<NotificationPreference> {
    const existing = await this.getNotificationPreferences(data.userId);
    if (existing) {
      const [updated] = await db.update(notificationPreferences)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(notificationPreferences).values(data).returning();
    return created;
  }

  async createAlertDelivery(data: InsertAlertDelivery): Promise<AlertDelivery> {
    const [created] = await db.insert(alertDeliveries).values(data).returning();
    return created;
  }

  async getAlertDeliveries(alertId: number): Promise<AlertDelivery[]> {
    return await db.select().from(alertDeliveries)
      .where(eq(alertDeliveries.alertId, alertId));
  }

  async getPerformanceSnapshots(userId: string, sport?: string): Promise<PerformanceSnapshot[]> {
    if (sport) {
      return await db.select().from(performanceSnapshots)
        .where(and(eq(performanceSnapshots.userId, userId), eq(performanceSnapshots.sport, sport)))
        .orderBy(desc(performanceSnapshots.slateDate));
    }
    return await db.select().from(performanceSnapshots)
      .where(eq(performanceSnapshots.userId, userId))
      .orderBy(desc(performanceSnapshots.slateDate));
  }

  async createPerformanceSnapshot(data: InsertPerformanceSnapshot): Promise<PerformanceSnapshot> {
    const [created] = await db.insert(performanceSnapshots).values(data).returning();
    return created;
  }

  async getAggregatePerformance(userId: string): Promise<{
    totalSlates: number;
    avgVsOptimal: number;
    avgVsField: number;
    avgAccuracy: number;
    sportBreakdown: Record<string, { slates: number; avgVsOptimal: number; avgVsField: number; avgAccuracy: number }>;
  }> {
    const snapshots = await this.getPerformanceSnapshots(userId);
    if (snapshots.length === 0) {
      return { totalSlates: 0, avgVsOptimal: 0, avgVsField: 0, avgAccuracy: 0, sportBreakdown: {} };
    }

    const toN = (v: string | null | undefined) => v != null && v !== "" ? parseFloat(v) : 0;
    let totalVsOpt = 0, totalVsField = 0, totalAcc = 0, accCount = 0;
    const bySport: Record<string, { slates: number; vsOpt: number; vsField: number; acc: number; accCount: number }> = {};

    for (const s of snapshots) {
      const optScore = toN(s.optimalScore);
      const vsOpt = optScore > 0 ? (toN(s.userScore) / optScore) * 100 : 0;
      const fieldAvg = toN(s.fieldAvgScore);
      const vsField = fieldAvg > 0 ? (toN(s.userScore) / fieldAvg) * 100 : 0;
      const acc = toN(s.projectionAccuracy);

      totalVsOpt += vsOpt;
      totalVsField += vsField;
      if (acc > 0) { totalAcc += acc; accCount++; }

      if (!bySport[s.sport]) bySport[s.sport] = { slates: 0, vsOpt: 0, vsField: 0, acc: 0, accCount: 0 };
      bySport[s.sport].slates++;
      bySport[s.sport].vsOpt += vsOpt;
      bySport[s.sport].vsField += vsField;
      if (acc > 0) { bySport[s.sport].acc += acc; bySport[s.sport].accCount++; }
    }

    const sportBreakdown: Record<string, { slates: number; avgVsOptimal: number; avgVsField: number; avgAccuracy: number }> = {};
    for (const [sport, d] of Object.entries(bySport)) {
      sportBreakdown[sport] = {
        slates: d.slates,
        avgVsOptimal: d.slates > 0 ? Math.round((d.vsOpt / d.slates) * 10) / 10 : 0,
        avgVsField: d.slates > 0 ? Math.round((d.vsField / d.slates) * 10) / 10 : 0,
        avgAccuracy: d.accCount > 0 ? Math.round((d.acc / d.accCount) * 10) / 10 : 0,
      };
    }

    return {
      totalSlates: snapshots.length,
      avgVsOptimal: Math.round((totalVsOpt / snapshots.length) * 10) / 10,
      avgVsField: Math.round((totalVsField / snapshots.length) * 10) / 10,
      avgAccuracy: accCount > 0 ? Math.round((totalAcc / accCount) * 10) / 10 : 0,
      sportBreakdown,
    };
  }
}

export const storage = new DatabaseStorage();
