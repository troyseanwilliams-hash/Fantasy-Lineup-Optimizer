import { users, type User, type UpsertUser } from "@shared/models/auth";
import { subscriptions } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  completeOnboarding(id: string, data: {
    salutation: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    smsConsent: boolean;
    emailConsent: boolean;
  }): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...userData,
        email: userData.email?.toLowerCase(),
      })
      .returning();

    await db.insert(subscriptions).values({
      userId: user.id,
      tier: "free",
      status: "active",
    }).onConflictDoNothing();

    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    let user: User;
    try {
      const [result] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
          },
        })
        .returning();
      user = result;
    } catch (err: any) {
      if (err?.code === "23505" && err?.constraint?.includes("email")) {
        const withoutEmail = { ...userData, email: undefined };
        const [result] = await db
          .insert(users)
          .values(withoutEmail)
          .onConflictDoUpdate({
            target: users.id,
            set: {
              firstName: userData.firstName,
              lastName: userData.lastName,
              profileImageUrl: userData.profileImageUrl,
              updatedAt: new Date(),
            },
          })
          .returning();
        user = result;
      } else {
        throw err;
      }
    }

    const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
    if (!existingSub) {
      await db.insert(subscriptions).values({
        userId: user.id,
        tier: "pro",
        status: "active",
      }).onConflictDoNothing();
    }

    return user;
  }

  async completeOnboarding(id: string, data: {
    salutation?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    smsConsent?: boolean;
    emailConsent?: boolean;
  }): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        salutation: data.salutation || "",
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone || "",
        smsConsent: data.smsConsent ?? false,
        emailConsent: data.emailConsent ?? false,
        onboardingComplete: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return user;
  }
}

export const authStorage = new AuthStorage();
