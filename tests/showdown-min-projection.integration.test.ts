import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Player, Slate } from "../shared/schema";

const require = createRequire(import.meta.url);

function makeSlate(): Slate {
  return {
    id: 77,
    sport: "NFL",
    platform: "draftkings",
    name: "NFL Showdown Regression",
    startTime: new Date("2099-09-13T17:00:00.000Z"),
    isMain: false,
    isActive: true,
    draftGroupId: 7701,
    gameType: "Showdown",
    label: "NFL Showdown Regression",
    gameCount: 1,
    contestCount: 1,
    salaryCap: 50_000,
  } as Slate;
}

function makePlayer(id: number, projectedPoints: number): Player {
  return {
    id,
    slateId: 77,
    name: `Showdown Fixture ${id}`,
    position: "WR",
    team: "HOU",
    salary: 5_000,
    projectedPoints: String(projectedPoints),
    fppg: String(projectedPoints),
    opponent: "BUF",
    gameInfo: "HOU @ BUF 1:00 PM ET",
    injuryStatus: null,
    injuryDetail: null,
  } as Player;
}

function routeHandler(router: any, path: string): (req: any, res: any) => Promise<unknown> {
  const layer = router.stack.find((entry: any) =>
    entry.route?.path === path && entry.route.methods?.post,
  );
  assert.ok(layer, `expected POST ${path} to be registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function responseCapture() {
  const state: { status: number; body?: any } = { status: 200 };
  const response = {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: any) {
      state.body = body;
      return this;
    },
    sendStatus(code: number) {
      state.status = code;
      return this;
    },
  };
  return { state, response };
}

test("Showdown optimize and Sim enforce minProjection after playerProjections and before CPT/sampling", async () => {
  const dbPath = require.resolve("../server/db.ts");
  const showdownPath = require.resolve("../server/showdown-route.ts");
  const storagePath = require.resolve("../server/storage.ts");
  const previousDbModule = require.cache[dbPath];
  const previousShowdownModule = require.cache[showdownPath];
  const previousStorageModule = require.cache[storagePath];
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unit-test/unit-test";
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [],
            }),
          }),
        }),
      },
      pool: {},
    },
  } as any;

  const showdownModule = require("../server/showdown-route.ts") as typeof import("../server/showdown-route");
  const storageModule = require("../server/storage.ts") as typeof import("../server/storage");
  const storage = storageModule.storage as any;
  const slate = makeSlate();
  const players = [
    makePlayer(1, 12),
    makePlayer(2, 12),
    makePlayer(3, 12),
    makePlayer(4, 12),
    makePlayer(5, 12),
    makePlayer(6, 12),
    makePlayer(7, 5),
  ];

  const originals = new Map<string, unknown>();
  for (const method of ["getSlate", "getPlayersBySlate", "getSubscription", "getUser"]) {
    originals.set(method, storage[method]);
  }
  storage.getSlate = async (slateId: number) => slateId === slate.id ? slate : undefined;
  storage.getPlayersBySlate = async (slateId: number) => slateId === slate.id ? players : [];
  storage.getSubscription = async () => ({ tier: "pro" });
  storage.getUser = async () => ({ id: "showdown-test-user", isAdmin: false });

  try {
    const optimize = routeHandler(showdownModule.showdownRouter, "/api/showdown/optimize");
    const sim = routeHandler(showdownModule.showdownRouter, "/api/showdown/optimize/sim");

    // The raw projection for player 7 is below the cutoff, but the explicit
    // request projection is a manual boost. It must be considered eligible.
    const boostedPayload = {
      slateId: slate.id,
      sport: "NFL",
      platform: "draftkings",
      lineupCount: 1,
      minProjection: 8,
      playerProjections: { "7": 100 },
    };
    const optimizeCapture = responseCapture();
    await optimize({ body: boostedPayload }, optimizeCapture.response);
    assert.equal(optimizeCapture.state.status, 200);
    assert.equal(optimizeCapture.state.body.lineups.length, 1);
    assert.ok(
      optimizeCapture.state.body.lineups[0].captain.id === 7 ||
      optimizeCapture.state.body.lineups[0].flexPlayers.some((player: Player) => player.id === 7),
      "manually boosted player should remain eligible for Showdown optimization",
    );

    const simCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: { ...boostedPayload, numSims: 50 },
    }, simCapture.response);
    assert.equal(simCapture.state.status, 200);
    assert.ok(simCapture.state.body.lineups.length > 0);
    assert.ok(
      simCapture.state.body.lineups[0].captain.id === 7 ||
      simCapture.state.body.lineups[0].flexPlayers.some((player: Player) => player.id === 7),
      "manually boosted player should remain eligible before Showdown simulation sampling",
    );

    const lockedPayload = {
      slateId: slate.id,
      sport: "NFL",
      platform: "draftkings",
      lineupCount: 1,
      lockedCaptainId: 7,
      minProjection: 8,
    };
    const lockedOptimizeCapture = responseCapture();
    await optimize({ body: lockedPayload }, lockedOptimizeCapture.response);
    assert.equal(lockedOptimizeCapture.state.status, 400);
    assert.match(lockedOptimizeCapture.state.body.message, /Locked captain Showdown Fixture 7/);
    assert.match(lockedOptimizeCapture.state.body.message, /Remove the lock or lower minProjection/);

    const lockedSimCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: { ...lockedPayload, numSims: 50 },
    }, lockedSimCapture.response);
    assert.equal(lockedSimCapture.state.status, 400);
    assert.match(lockedSimCapture.state.body.message, /Locked captain Showdown Fixture 7/);
    assert.match(lockedSimCapture.state.body.message, /Remove the lock or lower minProjection/);
  } finally {
    for (const [method, original] of originals) storage[method] = original;
    if (previousShowdownModule) require.cache[showdownPath] = previousShowdownModule;
    else delete require.cache[showdownPath];
    if (previousStorageModule) require.cache[storagePath] = previousStorageModule;
    else delete require.cache[storagePath];
    if (previousDbModule) require.cache[dbPath] = previousDbModule;
    else delete require.cache[dbPath];
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});