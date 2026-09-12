import { expect, test } from "@playwright/test";

const slate = {
  id: 911001,
  sport: "NFL",
  platform: "draftkings",
  name: "NFL Main Slate",
  label: "NFL Main Slate",
  startTime: "2099-09-13T17:00:00Z",
  isActive: true,
  isMain: true,
  gameType: "Classic",
  draftGroupId: 1911001,
  gameCount: 14,
  games: ["BUF @ HOU", "DET @ NO", "KC @ LV", "DAL @ NYG"],
  salaryCap: 50000,
};

type FixturePlayer = {
  id: number;
  slateId: number;
  name: string;
  team: string;
  position: string;
  salary: number;
  fppg: string;
  projectedPoints: string;
  opponent: string;
  gameInfo: string;
  injuryStatus: string | null;
  injuryDetail: string | null;
  boostScore: string;
  boostReason: string;
  draftKingsPlayerId: number;
  isConfirmedStarter: boolean;
  ownershipProjection: number;
  recentActualAvg: number;
  gamesTracked: number;
};

type SimLineup = {
  lineup: FixturePlayer[];
  key: string;
  frequency: number;
  freqPct: number;
  avgSimScore: number;
  medianScore: number;
  p75Score: number;
  p90Score: number;
  compositeScore: number;
  totalSalary: number;
  stackedGame: string;
  stackCount: number;
  stackTeams: string[];
  evScore: number;
  winPct: number;
  cashPct: number;
  dupeFactor: number;
};

const games = [
  { away: "BUF", home: "HOU", time: "1:00 PM ET" },
  { away: "DET", home: "NO", time: "1:00 PM ET" },
  { away: "KC", home: "LV", time: "4:25 PM ET" },
  { away: "DAL", home: "NYG", time: "8:20 PM ET" },
  { away: "SF", home: "SEA", time: "4:05 PM ET" },
  { away: "PHI", home: "WAS", time: "1:00 PM ET" },
  { away: "GB", home: "CHI", time: "1:00 PM ET" },
  { away: "MIA", home: "NYJ", time: "1:00 PM ET" },
];

const positionCounts: Array<[string, number]> = [
  ["QB", 64],
  ["RB", 180],
  ["WR", 300],
  ["TE", 96],
  ["DST", 71],
];

const salaries: Record<string, number> = {
  QB: 6500,
  RB: 5400,
  WR: 5000,
  TE: 4200,
  DST: 3000,
};

const projections: Record<string, number> = {
  QB: 24,
  RB: 16,
  WR: 14,
  TE: 11,
  DST: 8,
};

const allTeams = games.flatMap(game => [game.away, game.home]);

function buildPlayers(): FixturePlayer[] {
  let id = 1;
  return positionCounts.flatMap(([position, count]) =>
    Array.from({ length: count }, (_, index) => {
      const game = games[(id - 1) % games.length];
      const team = allTeams[(id - 1) % allTeams.length];
      const opponent = team === game.away ? game.home : game.away;
      const salary = salaries[position] + (index % 5) * 100;
      const projectedPoints = projections[position] - (index % 7) * 0.2;
      const player: FixturePlayer = {
        id,
        slateId: slate.id,
        name: `Fixture ${position} ${index + 1}`,
        team,
        position,
        salary,
        fppg: projectedPoints.toFixed(1),
        projectedPoints: projectedPoints.toFixed(1),
        opponent,
        gameInfo: `${game.away} @ ${game.home} ${game.time}`,
        injuryStatus: null,
        injuryDetail: null,
        boostScore: ((index % 5) - 2).toFixed(1),
        boostReason: "Fixture projection adjustment",
        draftKingsPlayerId: 900000 + id,
        isConfirmedStarter: position !== "DST",
        ownershipProjection: 5 + (index % 25) * 1.25,
        recentActualAvg: Math.max(0, projectedPoints - 1.2),
        gamesTracked: 8 + (index % 5),
      };
      id += 1;
      return player;
    }),
  );
}

const players = buildPlayers();
const playersByPosition = players.reduce<Record<string, FixturePlayer[]>>((groups, player) => {
  (groups[player.position] ||= []).push(player);
  return groups;
}, {});

function makeSimLineups(count: number): SimLineup[] {
  const qbs = playersByPosition.QB;
  const rbs = playersByPosition.RB;
  const wrs = playersByPosition.WR;
  const tes = playersByPosition.TE;
  const dsts = playersByPosition.DST;

  return Array.from({ length: count }, (_, index) => {
    const lineup = [
      qbs[index % qbs.length],
      rbs[(index * 2) % rbs.length],
      rbs[(index * 2 + 1) % rbs.length],
      wrs[(index * 3) % wrs.length],
      wrs[(index * 3 + 1) % wrs.length],
      wrs[(index * 3 + 2) % wrs.length],
      tes[index % tes.length],
      tes[(index + 37) % tes.length],
      dsts[index % dsts.length],
    ];
    const totalSalary = lineup.reduce((total, player) => total + player.salary, 0);
    const baseScore = lineup.reduce((total, player) => total + Number(player.projectedPoints), 0);
    const medianScore = Math.round((baseScore + (index % 9) * 0.7) * 10) / 10;
    const p75Score = Math.round((medianScore + 9.4) * 10) / 10;
    const p90Score = Math.round((p75Score + 12.8) * 10) / 10;
    const avgSimScore = Math.round((medianScore - 2.1) * 10) / 10;
    const frequency = 1 + (index % 24);

    return {
      lineup,
      key: lineup.map(player => player.id).sort((a, b) => a - b).join(","),
      frequency,
      freqPct: Math.round((frequency / count) * 1000) / 10,
      avgSimScore,
      medianScore,
      p75Score,
      p90Score,
      compositeScore: Math.round((avgSimScore * 0.35 + p75Score * 0.35 + p90Score * 0.2 + frequency * 0.1) * 10) / 10,
      totalSalary,
      stackedGame: "BUF-HOU",
      stackCount: 4,
      stackTeams: ["BUF", "HOU"],
      evScore: Math.round((0.82 + (index % 17) / 100) * 100) / 100,
      winPct: Math.round((1.2 + (index % 8) / 10) * 100) / 100,
      cashPct: Math.round((18 + (index % 20) / 2) * 10) / 10,
      dupeFactor: Math.round((1.05 + (index % 9) / 100) * 100) / 100,
    };
  });
}

const lineups200 = makeSimLineups(200);
let lineups500: SimLineup[] | undefined;

function isCompleteValidNflLineup(lineup: SimLineup): boolean {
  const positionTotals = lineup.lineup.reduce<Record<string, number>>((totals, player) => {
    totals[player.position] = (totals[player.position] || 0) + 1;
    return totals;
  }, {});
  const ids = new Set(lineup.lineup.map(player => player.id));
  const requiredFields = [
    "id", "slateId", "name", "team", "position", "salary", "fppg",
    "projectedPoints", "opponent", "gameInfo", "injuryStatus", "injuryDetail",
    "boostScore", "boostReason", "draftKingsPlayerId", "isConfirmedStarter",
    "ownershipProjection", "recentActualAvg", "gamesTracked",
  ];

  return lineup.lineup.length === 9
    && ids.size === 9
    && positionTotals.QB === 1
    && positionTotals.RB === 2
    && positionTotals.WR === 3
    && positionTotals.TE === 2
    && positionTotals.DST === 1
    && lineup.lineup.every(player => requiredFields.every(field => (player as Record<string, unknown>)[field] !== undefined));
}

test("renders 200 simulated NFL lineups responsively without freezing", async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  expect(players).toHaveLength(711);
  expect(lineups200).toHaveLength(200);
  expect(lineups200.every(isCompleteValidNflLineup)).toBeTruthy();

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const simRequests: Array<Record<string, unknown>> = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    // Existing ScoutPanel nested-button warning is unrelated to generation.
    if (message.type() === "error" && !message.text().includes("validateDOMNesting")) consoleErrors.push(message.text());
  });

  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};

    if (path === "/api/auth/user") {
      data = {
        id: "fixture-pro-user",
        email: "fixture-pro@example.com",
        firstName: "Fixture",
        lastName: "User",
        isAdmin: false,
      };
    } else if (path === "/api/subscription") {
      data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    } else if (path === "/api/slates") {
      data = [slate];
    } else if (path.endsWith("/players")) {
      data = players;
    } else if (path === "/api/scout/status") {
      data = {
        next_refresh: 3600,
        per_sport: { NFL: { signal_count: 0, boost_count: 0, injury_count: 0, next_refresh: 3600 } },
      };
    } else if (path.includes("/scout/signals")) {
      data = { signals: [], seconds_until_refresh: 3600 };
    } else if (path === "/api/alerts") {
      data = { alerts: [] };
    } else if (path === "/api/optimize/sim") {
      const requestBody = (route.request().postDataJSON() || {}) as Record<string, unknown>;
      simRequests.push(requestBody);
      const requestedLineupCount = Number(requestBody.lineupCount) || 200;
      if (requestedLineupCount >= 500) lineups500 ||= makeSimLineups(500);
      const returnedLineups = requestedLineupCount >= 500 ? lineups500! : lineups200;
      data = {
        lineups: returnedLineups,
        simsRun: requestedLineupCount,
        uniqueLineups: returnedLineups.length,
        elapsedMs: requestedLineupCount >= 500 ? 10_100 : 9_850,
        exposureSummary: [],
        gamesRepresented: 4,
        context: {
          vegasApplied: true,
          vegasSource: "fixture",
          vegasGamesFound: 4,
          slateAvgTotal: 44.5,
          dvpApplied: true,
          dvpTeamsFound: 16,
        },
      };
    }

    await route.fulfill({ json: data });
  });

  await page.goto(`/optimizer-pro/${slate.id}`);
  await expect(page.getByTestId("pro-optimizer-page")).toBeVisible();
  await expect(page.getByTestId("text-player-count")).toHaveText("711 players");

  const controlIds = ["sim-mode-panel", "btn-sim-mode-toggle", "button-generate"];
  for (const testId of controlIds) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  await page.getByTestId("btn-sim-mode-toggle").click();
  await expect(page.getByTestId("btn-sims-200")).toBeVisible();
  await expect(page.getByTestId("btn-sims-500")).toBeVisible();
  await page.getByTestId("btn-sims-200").click();
  await expect(page.getByTestId("button-generate")).toContainText("200");

  const simResponsePromise = page.waitForResponse(response =>
    response.url().endsWith("/api/optimize/sim") && response.request().method() === "POST",
  );
  await page.getByTestId("button-generate").click();
  const simResponse = await simResponsePromise;
  expect(simResponse.status()).toBe(200);
  const responsePayload = await simResponse.json();
  expect(responsePayload.lineups).toHaveLength(200);
  expect(simRequests[0]).toMatchObject({ slateId: slate.id, lineupCount: 200, numSims: 200 });

  await expect(page.getByTestId("sim-summary-bar")).toContainText("200");

  // Results must open automatically after generation, including on phones.
  const firstLineup = page.getByTestId("lineup-card-0");
  await expect(firstLineup).toBeVisible();
  await expect(firstLineup.locator('[data-testid^="lineup-slot-0-"]')).toHaveCount(9);
  await expect(firstLineup).toContainText("Fixture");
  await expect(page.locator('[data-testid^="lineup-card-"]')).toHaveCount(10);
  await expect(page.getByTestId("show-more-players")).toContainText("75 of 711");

  // Exercise the largest Pro control without replacing the required 200-lineup
  // regression response. This catches a responsive control that cannot select
  // 500, while keeping the focused freeze reproduction deterministic.
  await page.getByTestId("btn-sims-500").click();
  await expect(page.getByTestId("button-generate")).toContainText("500");
  await page.getByTestId("btn-sims-200").click();
  await expect(page.getByTestId("button-generate")).toContainText("200");

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const testId of ["sim-mode-panel", "btn-sims-200", "button-generate"]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, `${testId} should have a responsive layout box`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  }

  const documentDimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(documentDimensions.documentWidth).toBeLessThanOrEqual(documentDimensions.viewportWidth + 1);

  // Scroll through existing results and load another batch without clipping.
  const moreLineups = page.getByTestId("button-load-more-lineups");
  await moreLineups.scrollIntoViewIfNeeded();
  await expect(moreLineups).toBeInViewport();
  await moreLineups.click();
  await expect(page.locator('[data-testid^="lineup-card-"]')).toHaveCount(35);
  const lastLineup = page.getByTestId("lineup-card-34");
  await lastLineup.scrollIntoViewIfNeeded();
  await expect(lastLineup).toBeInViewport();
  if (testInfo.project.name === "desktop") {
    expect(await page.getByTestId("pro-lineup-scroll").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  } else {
    expect(await page.getByTestId("optimizer-page-scroll").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: `screenshots/optimizer-scroll-${testInfo.project.name}.png` });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});