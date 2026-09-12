import { expect, test } from "@playwright/test";

test("never returns classic slates to the Showdown Builder", async ({ request }) => {
  const response = await request.get("/api/showdown/slates?sport=NFL&platform=draftkings");
  expect(response.ok()).toBeTruthy();

  const slates = await response.json();
  expect(slates.every((slate: { gameType?: string }) => slate.gameType?.toLowerCase() === "showdown")).toBeTruthy();
});