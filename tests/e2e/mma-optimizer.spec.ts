import { expect, test, type Page } from "@playwright/test";

const futureDate = "12/31/2099 8:00 PM ET";
const fighters = [
  ["Test Future F1", "990001"],
  ["Test Future F2", "990002"],
  ["Test Future F3", "990003"],
  ["Test Future F4", "990004"],
  ["Test Future F5", "990005"],
  ["Test Future F6", "990006"],
  ["Test Future F7", "990007"],
  ["Test Future F8", "990008"],
];

function salaryCsv(): string {
  const rows = fighters.map(([name, id], index) =>
    `F,"${name}",${id},7000,"TEST BOUT ${index + 1} ${futureDate}",TST,99`,
  );
  return [
    "Position,Name,ID,Salary,Game Info,TeamAbbrev,AvgPointsPerGame",
    ...rows,
  ].join("\n");
}

async function importCsv(page: Page, contents: string, name = "test-only-mma.csv") {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(contents),
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/mma-optimizer");
});

test("imports a future MMA salary slate, requires projections, applies controls, and exports six fighters", async ({ page }) => {
  await importCsv(page, salaryCsv());

  const projections = page.locator('input[aria-label$=" projection"]');
  await expect(projections).toHaveCount(8);
  for (let index = 0; index < 8; index++) {
    await expect(projections.nth(index)).toHaveValue("");
  }

  await page.getByLabel("Test Future F1 projection").fill("30");
  await page.getByLabel("Test Future F2 projection").fill("29");
  await page.getByLabel("Test Future F3 projection").fill("28");
  await page.getByLabel("Test Future F4 projection").fill("27");
  await page.getByLabel("Test Future F5 projection").fill("26");
  await page.getByLabel("Test Future F6 projection").fill("25");
  await page.getByLabel("Test Future F7 projection").fill("24");
  await page.getByLabel("Test Future F8 projection").fill("1");

  await page.getByRole("button", { name: "Lock Test Future F1" }).click();
  await expect(page.getByRole("button", { name: "Unlock Test Future F1" })).toBeVisible();
  await page.getByRole("button", { name: "Exclude Test Future F8" }).click();
  await expect(page.getByRole("button", { name: "Include Test Future F8" })).toBeVisible();

  await page.getByRole("button", { name: "Generate lineups" }).click();
  await expect(page.getByRole("heading", { name: "Optimized lineups" })).toBeVisible();
  await expect(page.getByText("$42,000 · $8,000 left")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export DK CSV" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let exported = "";
  for await (const chunk of stream!) exported += chunk.toString();
  const [header, row] = exported.trim().split("\n");
  expect(download.suggestedFilename()).toBe("draftkings-mma-lineups.csv");
  expect(header.split(",")).toHaveLength(6);
  expect(header).toBe('"F","F","F","F","F","F"');
  expect(exported).not.toContain("Entry ID");
  expect(row.split(",")).toHaveLength(6);

  await page.getByLabel("Test Future F2 projection").fill("31");
  await expect(page.getByRole("heading", { name: "Optimized lineups" })).toBeHidden();
});

test("reports a non-MMA salary CSV and remains usable", async ({ page }) => {
  await importCsv(page, "Position,Name,ID,Salary\nQB,Not MMA,991001,7000", "not-mma.csv");
  await expect(page.getByRole("alert")).toContainText("Non-MMA position");
  await expect(page.getByText("Start with a DraftKings salary file")).toBeVisible();
});

test("keeps the MMA pool usable without page-level horizontal overflow", async ({ page }) => {
  await importCsv(page, salaryCsv());
  await expect(page.getByRole("heading", { name: "Fighter pool" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});