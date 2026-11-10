import { expect, test, type Page } from "@playwright/test";

const widths = [375, 390, 1024, 1280, 1440];
const identities = ["admin", "member", "guest"] as const;
type Identity = (typeof identities)[number];
const longName = "Alexandria-Montgomery-Worthington-LongAccountName";

async function mockNavigation(page: Page, identity: Identity) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/user") {
      await route.fulfill({
        status: identity === "guest" ? 401 : 200,
        json: identity === "guest" ? { message: "Unauthorized" } : {
          id: "header-regression-user",
          firstName: longName,
          email: `${longName.toLowerCase()}@example.com`,
          isAdmin: identity === "admin",
        },
      });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/subscription": {
        tier: identity === "admin" ? "pro" : "star",
        status: "active",
        isAdmin: identity === "admin",
      },
      "/api/slates": [
        { id: 731, sport: "NBA", platform: "draftkings", isMain: true, name: "NBA Main" },
        { id: 732, sport: "NFL", platform: "draftkings", isMain: true, name: "NFL Main" },
        { id: 733, sport: "GOLF", platform: "draftkings", isMain: true, name: "Golf Main" },
      ],
      "/api/alerts": { alerts: [], unreadCount: 12 },
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });
}

async function expectHeaderFits(page: Page) {
  const header = page.getByTestId("site-header");
  await expect(header).toBeVisible();
  const dimensions = await header.evaluate(element => {
    const viewport = document.documentElement.clientWidth;
    const rect = element.getBoundingClientRect();
    const overflowing = Array.from(element.querySelectorAll<HTMLElement>("*")).filter(child => {
      const box = child.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > viewport + 1);
    }).map(child => child.dataset.testid || child.tagName);
    const row = element.firstElementChild as HTMLElement;
    return {
      left: rect.left,
      right: rect.right,
      viewport,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      rowWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      overflowing,
    };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.rowScrollWidth).toBeLessThanOrEqual(dimensions.rowWidth);
  expect(dimensions.overflowing).toEqual([]);
}

async function expectMenuFits(page: Page) {
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const fits = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth &&
      rect.bottom <= window.innerHeight + 1 && element.scrollWidth <= element.clientWidth;
  });
  expect(fits).toBe(true);
  await expect(menu.getByText(/\b(MLB|UFC|MMA)\b/)).toHaveCount(0);
}

for (const width of widths) {
  for (const identity of identities) {
    test(`${identity} navigation stays accessible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await mockNavigation(page, identity);
      // A static route isolates the header from unrelated dashboard data.
      await page.goto("/about");
      await expectHeaderFits(page);
      const signedIn = identity !== "guest";

      if (width >= 1024) {
        await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
        await expect(page.getByTestId("mobile-menu-btn")).toBeHidden();
        await expect(page.getByTestId("nav-admin")).toHaveCount(identity === "admin" ? 1 : 0);
        await page.getByTestId("nav-tools").click();
        await expectMenuFits(page);
        await expect(page.getByTestId("nav-top-stacks").locator("xpath=..")).toHaveAttribute("href", "/top-stacks");
        await expect(page.getByTestId("nav-player-config")).toHaveCount(signedIn ? 1 : 0);
        await expect(page.getByTestId("nav-scout")).toHaveCount(signedIn ? 1 : 0);
        await expect(page.getByTestId("nav-ownership")).toHaveCount(identity === "admin" ? 1 : 0);
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("nav-tools")).toBeFocused();

        if (signedIn) {
          await page.getByTestId("sport-selector").click();
          await expectMenuFits(page);
          await expect(page.getByTestId("sport-menu-nba-dk").locator("xpath=..")).toHaveAttribute("href", "/optimizer/731");
          await expect(page.getByTestId(`sport-menu-nba-${identity === "admin" ? "pro" : "star"}-dk`).locator("xpath=..")).toHaveAttribute("href", "/optimizer-pro/731");
          await page.keyboard.press("Escape");
          await page.getByTestId("nav-my-dfs").click();
          await expectMenuFits(page);
          await expect(page.getByTestId("nav-vault")).toBeVisible();
          await expect(page.getByTestId("nav-performance")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByTestId("account-menu")).toHaveAttribute("title", longName);
          await expect(page.getByTestId("account-menu")).toContainText(identity === "admin" ? "CHAMPION" : "SHARPSHOOTER");
          await page.getByTestId("account-menu").click();
          await expectMenuFits(page);
          await expect(page.getByTestId("logout-btn")).toBeVisible();
          await page.getByTestId("menu-plans").click();
          await expect(page).toHaveURL(/\/pricing$/);
          await expectHeaderFits(page);
        } else {
          await page.getByTestId("sign-in-btn").click();
          await expect(page).toHaveURL(/\/login$/);
        }
      } else {
        const toggle = page.getByTestId("mobile-menu-btn");
        await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const menu = page.getByTestId("mobile-menu");
        await expect(menu).toBeVisible();
        await expectHeaderFits(page);
        await expect(menu.getByText(/\b(MLB|UFC|MMA)\b/)).toHaveCount(0);
        await expect(page.getByTestId("mobile-nav-admin")).toHaveCount(identity === "admin" ? 1 : 0);
        await expect(page.getByTestId("mobile-nav-player-config")).toHaveCount(signedIn ? 1 : 0);
        await expect(page.getByTestId("mobile-nav-ownership")).toHaveCount(identity === "admin" ? 1 : 0);
        if (signedIn) {
          await expect(menu.getByText(longName, { exact: true })).toBeVisible();
          for (const id of ["mobile-sport-nba-dk", `mobile-sport-nba-${identity === "admin" ? "pro" : "star"}`, "mobile-logout-btn"]) {
            const control = page.getByTestId(id);
            await control.scrollIntoViewIfNeeded();
            await expect(control).toBeInViewport();
          }
        }
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await toggle.click();
        await page.getByTestId("mobile-nav-pricing").click();
        await expect(page).toHaveURL(/\/pricing$/);
        await expect(menu).toHaveCount(0);
        await expect(toggle).toBeFocused();
        await expectHeaderFits(page);
        if (!signedIn) {
          await toggle.click();
          await page.getByTestId("mobile-sign-in-btn").click();
          await expect(page).toHaveURL(/\/login$/);
        }
      }
    });
  }
}

test("closes the mobile disclosure on outside press and desktop resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNavigation(page, "admin");
  await page.goto("/about");
  const toggle = page.getByTestId("mobile-menu-btn");
  const menu = page.getByTestId("mobile-menu");
  await toggle.click();
  await expect(menu).toBeVisible();
  // The logo is also a usable touch target, not just decorative artwork.
  await page.getByRole("link", { name: "EliteLineup home" }).focus();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(menu).toHaveCount(0);
  await expectHeaderFits(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  // Dispatch the outside pointer press without navigating away from this route.
  await page.locator("main").dispatchEvent("pointerdown");
  await expect(menu).toHaveCount(0);
});
