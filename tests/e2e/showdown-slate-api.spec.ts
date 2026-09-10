import { expect, test } from "@playwright/test";

test("returns only real Showdown slates for the Showdown Builder", async ({ request }) => {
  const response = await request.get("/api/showdown/slates?sport=NFL&platform=draftkings");
  expect(response.ok()).toBeTruthy();

  const slates = await response.json();
  expect(slates.length).toBeGreaterThan(0);
  expect(slates.every((slate: { gameType?: string }) => slate.gameType?.toLowerCase() === "showdown")).toBeTruthy();
  expect(slates.some((slate: { label?: string }) => slate.label?.includes("SF@LAR"))).toBeTruthy();
});