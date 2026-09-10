import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { slates, type Player, type Slate } from "@shared/schema";
import { parseEasternTime } from "./balldontlie";

const DEFAULT_GRACE_HOURS = 3;

export function getLatestGameStart(slate: Slate, players: Player[]): Date {
  let latestGameStart = new Date(slate.startTime);
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(slate.startTime));
  const year = dateParts.find(part => part.type === "year")?.value;
  const month = dateParts.find(part => part.type === "month")?.value;
  const day = dateParts.find(part => part.type === "day")?.value;
  const slateDate = `${year}-${month}-${day}`;

  for (const player of players) {
    const match = player.gameInfo?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/i);
    if (!match) continue;

    const [, hourText, minute, meridiem] = match;
    let hour = Number(hourText);
    if (meridiem.toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (meridiem.toUpperCase() === "AM" && hour === 12) hour = 0;

    const gameStart = parseEasternTime(
      `${slateDate}T${String(hour).padStart(2, "0")}:${minute}:00`,
    );
    if (gameStart > latestGameStart) latestGameStart = gameStart;
  }

  return latestGameStart;
}

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