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

test("keeps sign-in available while public registration is closed", async ({ page }) => {
  await expect(page.getByTestId("input-email")).toBeVisible();
  await expect(page.getByTestId("input-password")).toBeVisible();
  await expect(page.getByTestId("toggle-password-visibility")).toBeVisible();
  await expect(page.getByTestId("btn-submit-login")).toBeVisible();
  await expect(page.getByTestId("signup-closed-notice")).toBeVisible();
  await expect(page.getByTestId("btn-toggle-auth-mode")).toHaveCount(0);
  await expect(page.getByTestId("input-first-name")).toHaveCount(0);
  await expect(page.getByTestId("input-phone")).toHaveCount(0);
});

test("rejects direct registration API requests", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "signup-block-test@example.com", password: "ValidPassword123!" }),
    });
    return { status: response.status, body: await response.json() };
  });

  expect(result.status).toBe(403);
  expect(result.body.message).toBe("New account registration is temporarily closed.");
});