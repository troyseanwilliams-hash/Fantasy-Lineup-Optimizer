import type { Player, Slate } from "@shared/schema";
import { parseEasternTime } from "./balldontlie";

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
    const exactTimestamp = player.gameInfo?.match(/\[DK_START:([^\]]+)\]/i)?.[1];
    if (exactTimestamp) {
      try {
        const exactGameStart = parseEasternTime(exactTimestamp);
        if (Number.isFinite(exactGameStart.getTime())) {
          if (exactGameStart > latestGameStart) latestGameStart = exactGameStart;
          continue;
        }
      } catch {
        // Fall back to the legacy display-time parser below.
      }
    }

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