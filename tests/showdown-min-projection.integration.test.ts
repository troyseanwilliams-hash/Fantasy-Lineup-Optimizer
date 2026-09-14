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

    const captainExposurePayload = {
      slateId: slate.id,
      sport: "NFL",
      platform: "draftkings",
      lineupCount: 4,
      perPlayerCaptainMinExposure: { "7": 50, "6": 0 },
      perPlayerCaptainMaxExposure: { "1": 25, "6": 0 },
    };
    const exposureCapture = responseCapture();
    await optimize({ body: captainExposurePayload }, exposureCapture.response);
    assert.equal(exposureCapture.state.status, 200, JSON.stringify(exposureCapture.state.body));
    assert.equal(exposureCapture.state.body.lineups.length, 4);
    const captainCounts = exposureCapture.state.body.lineups.reduce((counts: Record<number, number>, lineup: any) => {
      counts[lineup.captain.id] = (counts[lineup.captain.id] || 0) + 1;
      return counts;
    }, {});
    assert.ok((captainCounts[7] || 0) >= 2, "player 7 should captain at least 50% of four lineups");
    assert.ok((captainCounts[1] || 0) <= 1, "player 1 should captain no more than 25% of four lineups");

    const simExposureCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: { ...captainExposurePayload, numSims: 50 },
    }, simExposureCapture.response);
    assert.equal(simExposureCapture.state.status, 200, JSON.stringify(simExposureCapture.state.body));
    assert.equal(simExposureCapture.state.body.lineups.length, 4);
    const simCaptainCounts = simExposureCapture.state.body.lineups.reduce((counts: Record<number, number>, lineup: any) => {
      counts[lineup.captain.id] = (counts[lineup.captain.id] || 0) + 1;
      return counts;
    }, {});
    assert.ok((simCaptainCounts[7] || 0) >= 2, "Sim should honor player 7's minimum captain exposure");
    assert.ok((simCaptainCounts[1] || 0) <= 1, "Sim should honor player 1's maximum captain exposure");

    const exactSplitSimCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        numSims: 50,
        perPlayerCaptainMinExposure: { "7": 50 },
        perPlayerCaptainMaxExposure: { "7": 50 },
      },
    }, exactSplitSimCapture.response);
    assert.equal(exactSplitSimCapture.state.status, 200, JSON.stringify(exactSplitSimCapture.state.body));
    assert.equal(
      exactSplitSimCapture.state.body.lineups.filter((lineup: any) => lineup.captain.id === 7).length,
      2,
      "Sim should preserve baseline candidates while enforcing an exact 50% captain split",
    );

    const roundedMaxCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 3,
        perPlayerCaptainMaxExposure: { "1": 25 },
      },
    }, roundedMaxCapture.response);
    assert.equal(roundedMaxCapture.state.status, 200, JSON.stringify(roundedMaxCapture.state.body));
    assert.equal(
      roundedMaxCapture.state.body.lineups.filter((lineup: any) => lineup.captain.id === 1).length,
      0,
      "25% of three lineups must round down to zero captain appearances",
    );

    const lockedMaxCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 3,
        lockedCaptainId: 1,
        perPlayerCaptainMaxExposure: { "1": 99 },
        perPlayerMaxExposure: { "1": 25 },
      },
    }, lockedMaxCapture.response);
    assert.equal(lockedMaxCapture.state.status, 200, JSON.stringify(lockedMaxCapture.state.body));
    assert.ok(lockedMaxCapture.state.body.lineups.every((lineup: any) => lineup.captain.id === 1));

    const lockedCaptainOverridesOtherMinimumCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        numSims: 50,
        lockedCaptainId: 1,
        perPlayerCaptainMinExposure: { "7": 50 },
        perPlayerCaptainMaxExposure: { "1": 25 },
      },
    }, lockedCaptainOverridesOtherMinimumCapture.response);
    assert.equal(
      lockedCaptainOverridesOtherMinimumCapture.state.status,
      200,
      JSON.stringify(lockedCaptainOverridesOtherMinimumCapture.state.body),
    );
    assert.ok(lockedCaptainOverridesOtherMinimumCapture.state.body.lineups.every(
      (lineup: any) => lineup.captain.id === 1,
    ));

    const stricterGlobalCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        perPlayerCaptainMinExposure: { "7": 50 },
        globalMaxExposure: 25,
        perPlayerMaxExposure: { "7": 100 },
      },
    }, stricterGlobalCapture.response);
    assert.equal(stricterGlobalCapture.state.status, 400);
    assert.match(stricterGlobalCapture.state.body.message, /exceeds their overall maximum/i);

    const overallConflictCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        perPlayerCaptainMinExposure: { "7": 50 },
        perPlayerMaxExposure: { "7": 25 },
      },
    }, overallConflictCapture.response);
    assert.equal(overallConflictCapture.state.status, 400);
    assert.match(overallConflictCapture.state.body.message, /exceeds their overall maximum/i);

    const aggregateMaxCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        perPlayerCaptainMaxExposure: Object.fromEntries(players.map(player => [String(player.id), 10])),
      },
    }, aggregateMaxCapture.response);
    assert.equal(aggregateMaxCapture.state.status, 400);
    assert.match(aggregateMaxCapture.state.body.message, /combined maximum captain exposures/i);

    const conflictingExposureCapture = responseCapture();
    await optimize({
      body: {
        ...captainExposurePayload,
        perPlayerCaptainMinExposure: { "7": 60 },
        perPlayerCaptainMaxExposure: { "7": 40 },
      },
    }, conflictingExposureCapture.response);
    assert.equal(conflictingExposureCapture.state.status, 400);
    assert.match(conflictingExposureCapture.state.body.message, /minimum captain exposure cannot exceed/i);

    const flexExposurePayload = {
      slateId: slate.id,
      sport: "NFL",
      platform: "draftkings",
      lineupCount: 4,
      perPlayerFlexMinExposure: { "7": 50, "6": 0 },
      perPlayerFlexMaxExposure: { "2": 25, "6": 0 },
    };
    const flexExposureCapture = responseCapture();
    await optimize({ body: flexExposurePayload }, flexExposureCapture.response);
    assert.equal(flexExposureCapture.state.status, 200, JSON.stringify(flexExposureCapture.state.body));
    assert.equal(flexExposureCapture.state.body.lineups.length, 4);
    assert.ok(
      flexExposureCapture.state.body.lineups.filter((lineup: any) =>
        lineup.flexPlayers.some((player: Player) => player.id === 7)
      ).length >= 2,
      "player 7 should occupy FLEX in at least 50% of four lineups",
    );
    assert.ok(
      flexExposureCapture.state.body.lineups.filter((lineup: any) =>
        lineup.flexPlayers.some((player: Player) => player.id === 2)
      ).length <= 1,
      "player 2 should occupy FLEX in no more than 25% of four lineups",
    );

    const flexSimCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: { ...flexExposurePayload, numSims: 50 },
    }, flexSimCapture.response);
    assert.equal(flexSimCapture.state.status, 200, JSON.stringify(flexSimCapture.state.body));
    assert.equal(flexSimCapture.state.body.lineups.length, 4);
    assert.ok(
      flexSimCapture.state.body.lineups.filter((lineup: any) =>
        lineup.flexPlayers.some((player: Player) => player.id === 7)
      ).length >= 2,
      "Sim should honor player 7's minimum FLEX exposure",
    );
    assert.ok(
      flexSimCapture.state.body.lineups.filter((lineup: any) =>
        lineup.flexPlayers.some((player: Player) => player.id === 2)
      ).length <= 1,
      "Sim should honor player 2's maximum FLEX exposure",
    );

    const combinedRoleSimCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        numSims: 50,
        perPlayerCaptainMinExposure: { "1": 50 },
        perPlayerCaptainMaxExposure: { "1": 50 },
        perPlayerFlexMinExposure: { "6": 50, "7": 50 },
        perPlayerFlexMaxExposure: { "6": 50, "7": 50 },
      },
    }, combinedRoleSimCapture.response);
    assert.equal(combinedRoleSimCapture.state.status, 200, JSON.stringify(combinedRoleSimCapture.state.body));
    assert.equal(
      combinedRoleSimCapture.state.body.lineups.filter((lineup: any) => lineup.captain.id === 1).length,
      2,
    );
    for (const playerId of [6, 7]) {
      assert.equal(
        combinedRoleSimCapture.state.body.lineups.filter((lineup: any) =>
          lineup.flexPlayers.some((player: Player) => player.id === playerId)
        ).length,
        2,
        `Sim portfolio should jointly satisfy player ${playerId}'s exact FLEX exposure`,
      );
    }

    const flexOnlyCapCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        perPlayerCaptainMinExposure: { "2": 50 },
        perPlayerFlexMaxExposure: { "2": 25 },
      },
    }, flexOnlyCapCapture.response);
    assert.equal(flexOnlyCapCapture.state.status, 200, JSON.stringify(flexOnlyCapCapture.state.body));
    assert.ok(
      flexOnlyCapCapture.state.body.lineups.filter((lineup: any) => lineup.captain.id === 2).length >= 2,
      "a FLEX cap must not prevent the player from appearing as captain",
    );

    const lockedFlexConflictCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 3,
        lockedFlexIds: [2],
        perPlayerFlexMaxExposure: { "2": 99 },
      },
    }, lockedFlexConflictCapture.response);
    assert.equal(lockedFlexConflictCapture.state.status, 400);
    assert.match(lockedFlexConflictCapture.state.body.message, /locked FLEX player conflicts/i);

    const redundantLockedFlexMinCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        numSims: 50,
        lockedFlexIds: [2],
        perPlayerFlexMinExposure: { "2": 50 },
      },
    }, redundantLockedFlexMinCapture.response);
    assert.equal(
      redundantLockedFlexMinCapture.state.status,
      200,
      JSON.stringify(redundantLockedFlexMinCapture.state.body),
    );
    assert.ok(redundantLockedFlexMinCapture.state.body.lineups.every((lineup: any) =>
      lineup.flexPlayers.some((player: Player) => player.id === 2)
    ));

    const crossRoleLockCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        lockedFlexIds: [2],
        perPlayerCaptainMinExposure: { "2": 25 },
      },
    }, crossRoleLockCapture.response);
    assert.equal(crossRoleLockCapture.state.status, 400);
    assert.match(crossRoleLockCapture.state.body.message, /locked FLEX player conflicts.*minimum captain/i);

    const duplicateRoleLockCapture = responseCapture();
    await sim({
      session: { userId: "showdown-test-user" },
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        numSims: 50,
        lockedCaptainId: 2,
        lockedFlexIds: [2],
      },
    }, duplicateRoleLockCapture.response);
    assert.equal(duplicateRoleLockCapture.state.status, 400);
    assert.match(duplicateRoleLockCapture.state.body.message, /same player cannot be locked as both/i);

    const conflictingFlexCapture = responseCapture();
    await optimize({
      body: {
        slateId: slate.id,
        sport: "NFL",
        platform: "draftkings",
        lineupCount: 4,
        perPlayerFlexMinExposure: { "7": 60 },
        perPlayerFlexMaxExposure: { "7": 40 },
      },
    }, conflictingFlexCapture.response);
    assert.equal(conflictingFlexCapture.state.status, 400);
    assert.match(conflictingFlexCapture.state.body.message, /minimum FLEX exposure cannot exceed/i);

    const originalSport = slate.sport;
    const originalRoleData = players.slice(0, 3).map(player => ({
      position: player.position,
      team: player.team,
      projectedPoints: player.projectedPoints,
    }));
    players[0].position = "QB/TE";
    players[1].position = "QB";
    players[2].position = "WR";
    players[0].team = players[1].team = players[2].team = "HOU";
    players[0].projectedPoints = players[1].projectedPoints = "100";
    try {
      const authoritativeNflCapture = responseCapture();
      await optimize({
        body: {
          slateId: slate.id,
          sport: "NBA",
          platform: "draftkings",
          lineupCount: 1,
          lockedCaptainId: 3,
          lockedFlexIds: [1, 2],
        },
      }, authoritativeNflCapture.response);
      assert.equal(authoritativeNflCapture.state.status, 400);

      const authoritativeNflSimCapture = responseCapture();
      await sim({
        session: { userId: "showdown-test-user" },
        body: {
          slateId: slate.id,
          sport: "NBA",
          platform: "draftkings",
          lineupCount: 1,
          numSims: 50,
          lockedCaptainId: 3,
          lockedFlexIds: [1, 2],
        },
      }, authoritativeNflSimCapture.response);
      assert.equal(authoritativeNflSimCapture.state.status, 200);
      assert.equal(authoritativeNflSimCapture.state.body.lineups.length, 0);

      (slate as any).sport = "NBA";
      const authoritativeNbaCapture = responseCapture();
      await optimize({
        body: {
          slateId: slate.id,
          sport: "NFL",
          platform: "draftkings",
          lineupCount: 1,
          lockedCaptainId: 3,
          lockedFlexIds: [1, 2],
        },
      }, authoritativeNbaCapture.response);
      assert.equal(authoritativeNbaCapture.state.status, 200, JSON.stringify(authoritativeNbaCapture.state.body));
    } finally {
      (slate as any).sport = originalSport;
      players.slice(0, 3).forEach((player, index) => Object.assign(player, originalRoleData[index]));
    }
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