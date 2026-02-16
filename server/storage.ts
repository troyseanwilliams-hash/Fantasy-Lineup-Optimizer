import { db } from "./db";
import { eq, inArray } from "drizzle-orm";
import {
  slates, players, lineups,
  type Slate, type InsertSlate,
  type Player, type InsertPlayer,
  type Lineup, type InsertLineup
} from "@shared/schema";

// Import auth storage to merge interfaces
import { authStorage, type IAuthStorage } from "./replit_integrations/auth/storage";

export interface IStorage extends IAuthStorage {
  // Slates
  getSlates(): Promise<Slate[]>;
  getSlate(id: number): Promise<Slate | undefined>;
  createSlate(slate: InsertSlate): Promise<Slate>;

  // Players
  getPlayersBySlate(slateId: number): Promise<Player[]>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  bulkCreatePlayers(players: InsertPlayer[]): Promise<Player[]>;

  // Lineups
  getLineups(userId: string): Promise<Lineup[]>;
  createLineup(lineup: InsertLineup): Promise<Lineup>;
  deleteLineup(id: number): Promise<void>;
  getLineup(id: number): Promise<Lineup | undefined>;
}

export class DatabaseStorage implements IStorage {
  // --- Auth Delegate ---
  getUser = authStorage.getUser.bind(authStorage);
  upsertUser = authStorage.upsertUser.bind(authStorage);

  // --- Slates ---
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

  // --- Players ---
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

  // --- Lineups ---
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
}

export const storage = new DatabaseStorage();
