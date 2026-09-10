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

test("preserves login and registration selectors", async ({ page }) => {
  await expect(page.getByTestId("input-email")).toBeAttached();
  await expect(page.getByTestId("input-password")).toBeAttached();
  await expect(page.getByTestId("toggle-password-visibility")).toBeAttached();
  await expect(page.getByTestId("btn-submit-login")).toBeAttached();
  await expect(page.getByTestId("btn-toggle-auth-mode")).toBeAttached();
  await expect(page.getByTestId("badge-free-trial")).toBeAttached();

  await page.getByTestId("btn-toggle-auth-mode").click();

  for (const testId of [
    "input-first-name",
    "input-last-name",
    "input-email",
    "input-password",
    "input-phone",
    "checkbox-sms-consent",
    "checkbox-email-consent",
    "badge-free-trial",
    "btn-submit-login",
    "btn-toggle-auth-mode",
  ]) {
    await expect(page.getByTestId(testId)).toBeAttached();
  }
});