import { db } from "./db";
import { eq, and, inArray } from "drizzle-orm";
import {
  slates, players, lineups, subscriptions, props,
  type Slate, type InsertSlate,
  type Player, type InsertPlayer,
  type Lineup, type InsertLineup,
  type Subscription, type InsertSubscription,
  type Prop, type InsertProp
} from "@shared/schema";

import { authStorage, type IAuthStorage } from "./replit_integrations/auth/storage";

export interface IStorage extends IAuthStorage {
  getSlates(): Promise<Slate[]>;
  getSlate(id: number): Promise<Slate | undefined>;
  createSlate(slate: InsertSlate): Promise<Slate>;
  clearAllSlatesAndPlayers(): Promise<void>;

  getPlayersBySlate(slateId: number): Promise<Player[]>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  bulkCreatePlayers(players: InsertPlayer[]): Promise<Player[]>;

  getLineups(userId: string): Promise<Lineup[]>;
  createLineup(lineup: InsertLineup): Promise<Lineup>;
  deleteLineup(id: number): Promise<void>;
  getLineup(id: number): Promise<Lineup | undefined>;
  getLineupCount(userId: string): Promise<number>;
  getLineupCountBySport(userId: string, sport: string): Promise<number>;

  getSubscription(userId: string): Promise<Subscription | undefined>;
  upsertSubscription(sub: InsertSubscription): Promise<Subscription>;

  getPropsByDate(date: string, sport?: string): Promise<Prop[]>;
  bulkCreateProps(props: InsertProp[]): Promise<Prop[]>;
  clearPropsByDate(date: string): Promise<void>;
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

  async getPlayersBySlate(slateId: number): Promise<Player[]> {
    return await db.select().from(players).where(eq(players.slateId, slateId));
  }

  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const [player] = await db.insert(players).values(insertPlayer).returning();
    return player;
  }

  async bulkCreatePlayers(insertPlayers: InsertPlayer[]): Promise<Player[]> {
    return await db.insert(players).values(insertPlayers).returning();
  }

  async getLineups(userId: string): Promise<Lineup[]> {
    return await db.select().from(lineups).where(eq(lineups.userId, userId));
  }

  async createLineup(insertLineup: InsertLineup): Promise<Lineup> {
    const [lineup] = await db.insert(lineups).values(insertLineup).returning();
    return lineup;
  }

  async deleteLineup(id: number): Promise<void> {
    await db.delete(lineups).where(eq(lineups.id, id));
  }

  async getLineup(id: number): Promise<Lineup | undefined> {
    const [lineup] = await db.select().from(lineups).where(eq(lineups.id, id));
    return lineup;
  }

  async getLineupCount(userId: string): Promise<number> {
    const rows = await db.select().from(lineups).where(eq(lineups.userId, userId));
    return rows.length;
  }

  async getLineupCountBySport(userId: string, sport: string): Promise<number> {
    const rows = await db.select().from(lineups).where(
      and(eq(lineups.userId, userId), eq(lineups.sport, sport))
    );
    return rows.length;
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
}

export const storage = new DatabaseStorage();
