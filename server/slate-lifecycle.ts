import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { slates } from "@shared/schema";
import { getLatestGameStart } from "./slate-lifecycle-utils";

export { getLatestGameStart } from "./slate-lifecycle-utils";

const DEFAULT_GRACE_HOURS = 3;

export async function deactivateExpiredSlates(
  graceHours = DEFAULT_GRACE_HOURS,
): Promise<number> {
  const activeSlates = (await storage.getSlates()).filter(s => s.isActive !== false);
  const now = Date.now();
  let count = 0;

  for (const slate of activeSlates) {
    const players = await storage.getPlayersBySlate(slate.id);
    const latestGameStart = getLatestGameStart(slate, players);
    if (latestGameStart.getTime() + graceHours * 60 * 60 * 1000 >= now) continue;

    await db
      .update(slates)
      .set({ isActive: false })
      .where(and(eq(slates.id, slate.id), eq(slates.isActive, true)));
    count++;
  }

  return count;
}