import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("keeps the mobile menu usable without duplicating the Draft Hub action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Phone-only menu assertion");

  await expect(page.getByTestId("mobile-header-nfl-draft")).toHaveCount(0);
  await page.getByTestId("mobile-menu-btn").click();

  const menu = page.getByTestId("mobile-menu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("mobile-nav-nfl-draft-top")).toBeVisible();

  const dimensions = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(dimensions.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.viewportHeight);
});