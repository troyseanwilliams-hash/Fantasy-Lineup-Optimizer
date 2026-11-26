import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
});

test("keeps the desktop marketing panel and login form visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only layout assertion");

  await expect(page.getByTestId("login-feature-list")).toBeVisible();
  await expect(page.getByTestId("login-social-proof")).toBeVisible();
  await expect(page.getByTestId("login-mobile-banner")).toBeHidden();
  await expect(page.getByTestId("input-email")).toBeVisible();
  await expect(page.getByTestId("input-password")).toBeVisible();
  await expect(page.getByTestId("btn-submit-login")).toBeVisible();
});

test("keeps the compact banner and login form visible without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Phone-only layout assertion");

  await expect(page.getByTestId("login-mobile-banner")).toBeVisible();
  await expect(page.getByTestId("login-feature-list")).toBeHidden();
  await expect(page.getByTestId("input-email")).toBeVisible();
  await expect(page.getByTestId("input-password")).toBeVisible();
  await expect(page.getByTestId("btn-submit-login")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test("offers sign-up alongside sign-in while public registration is open", async ({ page }) => {
  await expect(page.getByTestId("input-email")).toBeVisible();
  await expect(page.getByTestId("input-password")).toBeVisible();
  await expect(page.getByTestId("toggle-password-visibility")).toBeVisible();
  await expect(page.getByTestId("btn-submit-login")).toBeVisible();
  await expect(page.getByTestId("signup-closed-notice")).toHaveCount(0);
  await page.getByTestId("btn-toggle-auth-mode").click();
  await expect(page.getByTestId("input-first-name")).toBeVisible();
});
