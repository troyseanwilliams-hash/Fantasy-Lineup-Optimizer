import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { optimizationConstraintSchema, proOptimizationConstraintSchema, optimizeResponseSchema, proOptimizeResponseSchema } from "../shared/schema";
import { nflPortfolioSettingsSchema } from "../shared/nfl-portfolio";
import { regenerationNflSettings } from "../server/nfl-portfolio";

const require = createRequire(import.meta.url);

test("portfolio boundary is optional, extendable, strips internal policy, and preserves reports", () => {
  const off = optimizationConstraintSchema.parse({ slateId: 1, nflPortfolioLineupPolicy: { catcherCount: 0 } });
  assert.equal(off.nflPortfolio, undefined);
  assert.equal("nflPortfolioLineupPolicy" in off, false);
  const on = proOptimizationConstraintSchema.parse({ slateId: 1, nflPortfolio: { enabled: true }, lineupCount: 3 });
  assert.equal(on.nflPortfolio?.enabled, true);
  const report = { requestedCount: 1, generatedCount: 0, candidateCount: 0, seed: 2026, metrics: [], warnings: [], dataSources: { ownership: "off", vegas: "unavailable", rushing: "manual" }, partial: true };
  assert.deepEqual(optimizeResponseSchema.parse({ lineup: [], totalSalary: 0, totalProjectedPoints: 0, nflPortfolioReport: report }).nflPortfolioReport, report);
  assert.deepEqual(proOptimizeResponseSchema.parse({ lineups: [], nflPortfolioReport: report }).nflPortfolioReport, report);
});

test("explicit strategy propagates; NFL GPP Resim defaults to structure and never saves an invalid batch", async () => {
  const saved = new Map<string, any>();
  const mock = (path: string, exports: any) => {
    const id = require.resolve(path);
    saved.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports } as any;
  };
  const calls: any[] = [];
  const writes: any[] = [];
  const positions = ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "DST", "WR", "WR"];
  const players = positions.map((position, i) => ({
    id: i + 1, slateId: 77, name: `Player ${i + 1}`, position,
    team: i < 6 ? "BUF" : "HOU", opponent: i < 6 ? "HOU" : "BUF",
    gameInfo: "BUF @ HOU 1:00 PM ET", salary: 5000, projectedPoints: "20", fppg: "20",
    injuryStatus: null, injuryDetail: null,
  }));
  let slate = { id: 77, sport: "NFL", platform: "draftkings", gameType: "Classic", draftGroupId: null, startTime: new Date("2099-09-01"), isActive: true };
  let missingTarget = false;
  let inactiveTarget = false;
  let closedTarget = false;
  let failSecondGroup = false;
  let closeDuringGeneration = false;
  let cokerAppearances: number | undefined;
  let portfolioReturnCount: number | undefined;
  let failLegacyExposureGroup = false;
  let savedPlayerOverrides: any[] = [];
  let suppliedOwnership = false;
  let failingAdjustment: "outperformer" | "ceiling" | "leverage" | null = null;
  let failTransactionWriteAt: number | undefined;
  let forceWeakSimulation = false;
  let lastSimulationProjections: Record<number, number> = {};
  const identity = (p: any) => p;
  const mockDb: any = {
    update: () => ({ set: (payload: any) => ({ where: async () => { writes.push(payload); } }) }),
    insert: () => ({ values: (payload: any) => ({ returning: async () => { writes.push(payload); return [{ id: 500, ...payload }]; } }) }),
  };
  mockDb.transaction = async (callback: any) => {
    const staged: any[] = [];
    let writeNumber = 0;
    const transactionExecutor = {
      update: () => ({ set: (payload: any) => ({ where: async () => {
        writeNumber++;
        if (writeNumber === failTransactionWriteAt) throw new Error("Injected transaction write failure");
        staged.push(payload);
      } }) }),
      insert: () => ({ values: (payload: any) => ({ returning: async () => {
        writeNumber++;
        if (writeNumber === failTransactionWriteAt) throw new Error("Injected transaction write failure");
        staged.push(payload);
        return [{ id: 500, ...payload }];
      } }) }),
    };
    const value = await callback(transactionExecutor);
    writes.push(...staged);
    return value;
  };
  mock("../server/db.ts", { db: mockDb, pool: {} });
  mock("../server/replit_integrations/auth/index.ts", { setupAuth: async () => {}, registerAuthRoutes: () => {} });
  mock("../server/storage.ts", { storage: {
    getSlate: async (id: number) => id === 78 && missingTarget ? undefined : ({
      ...slate, id,
      isActive: id === 78 && inactiveTarget ? false : slate.isActive,
      startTime: id === 78 && closedTarget ? new Date("2000-01-01") : slate.startTime,
    }),
    getPlayersBySlate: async () => cokerAppearances === undefined ? players : [
      ...players,
      ...Array.from({ length: 15 }, (_, i) => players.slice(0, 9).map((p, slot) => ({
        ...p, id: 1000 + i * 9 + slot,
      }))).flat(),
    ],
    getUser: async () => ({ isAdmin: true }),
    getSubscription: async () => ({ tier: "pro" }),
    getPlayerOverrides: async (_userId: string, slateId: number) => failLegacyExposureGroup && slateId === 78
      ? [{ playerId: 99999, minExposure: 100, maxExposure: 100 }] : slateId === 77 ? savedPlayerOverrides : [],
    getZeroPointPlayerNames: async () => [],
    getLineup: async (id: number) => ({ id, slateId: id === 4 ? 78 : 77, userId: id === 999 ? "other" : "owner", sport: "NFL", platform: "draftkings" }),
    createLineup: async (payload: any) => { writes.push(payload); return { id: 500, ...payload }; },
    updateLineup: async (_id: number, payload: any) => { writes.push(payload); return payload; },
  } });
  mock("../server/boost-engine.ts", {
    applyActualAdjustedProjections: identity,
    applyWinningLineupAdjustment: identity,
    applyOutperformerMode: (p: any) => {
      if (failingAdjustment === "outperformer") throw new Error("fixture outperformer failure");
      return p;
    },
    applyCeilingMode: (p: any) => {
      if (failingAdjustment === "ceiling") throw new Error("fixture ceiling failure");
      return p;
    },
    applyLeverageMode: (p: any) => {
      if (failingAdjustment === "leverage") throw new Error("fixture leverage failure");
      return p;
    },
    computeCorrelationBonus: () => 0,
  });
  mock("../server/market-projections.ts", { applyMarketProjectionBlend: identity });
  const simulationEngine = require("../server/simulation-engine.ts");
  mock("../server/simulation-engine.ts", {
    ...simulationEngine,
    runSimulations: (...args: any[]) => {
      lastSimulationProjections = args[3];
      return forceWeakSimulation
      ? Array.from({ length: args[2] }, () => ({
          projections: Object.fromEntries(args[0].map((p: any) => [p.id, p.id > 9 ? 500 : 1])),
        }))
      : simulationEngine.runSimulations(...args);
    },
  });
  mock("../server/historical-adjustments.ts", { getHistoricalProfile: async () => ({ ready: false }) });
  mock("../server/ai-scout.ts", { getCachedSignals: () => [] });
  mock("../server/espn-activity.ts", { getRecentlyPlayedCache: () => new Set(), normalizePlayerName: (s: string) => s });
  mock("../server/vegas-client.ts", { buildVegasContext: async () => null });
  mock("../server/variance-profiles.ts", { getEmpiricalCV: (_sport: string, _position: string, _projection: number, prior: number) => prior });
  mock("../server/dvp-client.ts", { buildOpponentMap: () => new Map(), buildDvPContext: async () => null });
  mock("../server/balldontlie-stats.ts", { fetchBDLStats: async () => new Map() });
  mock("../server/ownership-engine.ts", {
    calculateOwnership: async () => suppliedOwnership ? players.map(p => ({
      playerId: p.id, projectedOwnership: p.id === 1 ? 40.1 : 8.2,
      ownershipSource: p.id === 1 ? "supplied" : "estimated",
    })) : [],
    computeOwnershipForPlayers: identity,
  });
  mock("../server/nfl-portfolio.ts", {
    regenerationNflSettings,
    addNflPortfolioConstraints: () => {},
    generateNflPortfolio: async (options: any) => {
      calls.push(options);
      if (options.baseConstraints.slateId === 78 && failSecondGroup) throw new Error("Second target hard validation failed");
      if (options.baseConstraints.slateId === 78 && closeDuringGeneration) closedTarget = true;
       const returnedCount = portfolioReturnCount ?? options.count;
       const lineups = Array.from({ length: returnedCount }, (_, i) => {
         if (cokerAppearances !== undefined) {
           const lineup = players.slice(0, 9).map((p, slot) => ({
             ...p, id: slot === 4 && i < cokerAppearances ? 1 : 1000 + i * 9 + slot,
             name: slot === 4 && i < cokerAppearances ? "Coker" : p.name,
           }));
           return { lineup, totalSalary: 45000, totalProjectedPoints: 180 };
         }
        const lineup = players.slice(0, 9);
        if (i) lineup[4] = players[9];
        return { lineup, totalSalary: 45000, totalProjectedPoints: 180 };
      });
      if (options.scoreCandidates) {
        const scores = await options.scoreCandidates(lineups);
         assert.equal(scores.length, returnedCount);
        assert.ok(scores.every(Number.isFinite));
      }
       return { lineups, report: { requestedCount: options.count, generatedCount: returnedCount, candidateCount: returnedCount, seed: options.settings.seed, metrics: [], warnings: [], dataSources: { ownership: "off", vegas: "unavailable", rushing: "manual" }, partial: returnedCount < options.count } };
    },
  });
  const handlers = new Map<string, any>();
  const app = { set() {}, use() {}, get() {}, delete() {}, put() {}, patch() {}, post(path: string, ...fns: any[]) { handlers.set(path, fns.at(-1)); } };
  const httpApp = express();
  httpApp.use(express.json());
  httpApp.use((req, _res, next) => { (req as any).session = { userId: "owner" }; next(); });
  const server = createServer(httpApp);
  let baseUrl = "";
  const invoke = async (path: string, body: any, expectedStatus = 200) => {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(data));
    return data;
  };
  try {
    const routes = require("../server/routes.ts");
    assert.equal(routes.simRegenerationRuntimeMs(1), 35_000);
    assert.equal(routes.simRegenerationRuntimeMs(193), 68_250);
    assert.equal(routes.simRegenerationRuntimeMs(1_000), 90_000);
    await routes.registerRoutes({}, app);
    for (const [path, handler] of handlers) httpApp.post(path, handler);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const settings = nflPortfolioSettingsSchema.parse({ enabled: true });
    const common = { slateId: 77, contestType: "gpp", nflPortfolio: settings, nflPortfolioLineupPolicy: { catcherCount: 999, minLowOwnedPlayers: 999 } };
    const normal = await invoke("/api/optimize", common);
    assert.equal(normal.nflPortfolioReport.generatedCount, 1);
    const pro = await invoke("/api/optimize/pro", { ...common, lineupCount: 2 });
    assert.equal(pro.lineups.length, 2);
    assert.equal(pro.nflPortfolioReport.requestedCount, 2);
    const sim = await invoke("/api/optimize/sim", { ...common, lineupCount: 2, numSims: 50 });
    assert.equal(sim.nflPortfolioReport.generatedCount, 2);
    assert.equal(sim.simsRun, 50);
    assert.ok(Number.isFinite(sim.lineups[0].medianScore));
    const regen = await invoke("/api/lineups/sim-regenerate", { ...common, ids: [1, 2, 999] });
    assert.equal(regen.nflPortfolioReports[0].slateId, 77);
    assert.equal(regen.nflPortfolioReports[0].report.requestedCount, 2);
    assert.equal(regen.updated, 2);
    assert.equal(writes.length, 2);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(call => call.deadline > 0 && call.settings.enabled));
    assert.ok(calls.every(call => call.baseConstraints.nflPortfolioLineupPolicy === undefined));
    assert.ok(calls[2].scoreCandidates && calls[3].scoreCandidates);
    assert.equal(calls[0].ownershipMap, undefined);
    const defaultNormal = await invoke("/api/optimize", { slateId: 77 });
    const disabledNormal = await invoke("/api/optimize", { slateId: 77, nflPortfolio: { enabled: false } });
    const { solveTimeMs: _defaultTime, ...defaultShape } = defaultNormal;
    const { solveTimeMs: _disabledTime, ...disabledShape } = disabledNormal;
    assert.deepEqual(disabledShape, defaultShape);
    assert.equal("nflPortfolioReport" in disabledNormal, false);
    assert.equal(calls.length, 4);
    for (const path of ["/api/optimize/pro", "/api/optimize/sim"]) {
      const disabled = await invoke(path, { slateId: 77, ids: [1], lineupCount: 1, numSims: 50, nflPortfolio: { enabled: false } });
      assert.equal("nflPortfolioReport" in disabled, false);
      assert.equal("nflPortfolioReports" in disabled, false);
      assert.equal(calls.length, 4);
    }
    const beforeRejectedFloor = writes.length;
    const rejectedFloor = await invoke("/api/lineups/sim-regenerate",
      { ...common, ids: [1, 2], projFloor: 250 }, 400);
    assert.match(rejectedFloor.message, /250 projected points floor/);
    assert.equal(writes.length, beforeRejectedFloor, "portfolio candidates below the deterministic floor must never be saved");

    const acceptedFloor = await invoke("/api/lineups/sim-regenerate",
      { ...common, ids: [1, 2], projFloor: 180 });
    assert.equal(acceptedFloor.updated, 2);
    assert.ok(writes.slice(beforeRejectedFloor).every(write => Number(write.totalProjectedPoints) >= 180));
    const simFloor = await invoke("/api/optimize/sim", {
      slateId: 77, numSims: 50, lineupCount: 2, projectedPointsFloor: 250,
    });
    assert.equal(simFloor.lineups.length, 0, "simulation upside cannot bypass the deterministic floor");
    assert.equal(simFloor.partial, true);
    assert.equal(simFloor.searchDiagnostics.effectiveFloor, 250);
    assert.equal(simFloor.searchDiagnostics.baselineStatus, "best_found");
    const automatic = await invoke("/api/lineups/sim-regenerate", { ids: [1], contestType: "gpp", nflPortfolio: { enabled: false } });
    assert.equal(automatic.nflPortfolioReports[0].report.generatedCount, 1);
    assert.equal(calls.at(-1).strictStructure, true);
    assert.equal(calls.at(-1).structureOnly, true);
    assert.equal(calls.at(-1).settings.rbMinSalary, 4500);
    assert.equal(calls.at(-1).settings.allowLockedCheapRb, false);
    assert.deepEqual(calls.at(-1).settings.nakedQbIds, [1]);
    assert.equal(calls.at(-1).ownershipMap, undefined);
    await invoke("/api/lineups/sim-regenerate", { ids: [1], contestType: "gpp",
      nflPortfolio: { ...settings, rbMinSalary: 0, allowLockedCheapRb: true } }, 200);
    assert.equal(calls.at(-1).settings.rbMinSalary, 4500);
    assert.equal(calls.at(-1).settings.allowLockedCheapRb, false);
    suppliedOwnership = true;
    await invoke("/api/lineups/sim-regenerate", { ids: [1], contestType: "gpp", nflPortfolio: { enabled: false } });
    assert.equal(calls.at(-1).ownershipMap.get(1), 40.1);
    assert.equal(calls.at(-1).ownershipMap.get(2), 8.2);
    assert.equal(calls.at(-1).settings.ownershipMode, "off", "automatic scoring must not enable ownership constraints");
    assert.equal(calls.at(-1).structureOnly, true);
    await invoke("/api/optimize", { ...common, nflPortfolio: { ...settings, ownershipMode: "estimated", ownershipOverrides: { 1: 0 } } });
    assert.equal(calls.at(-1).ownershipMap.get(1), 0, "explicit zero overrides supplied ownership");
    assert.equal(calls.at(-1).ownershipMap.get(2), 8.2);
    await invoke("/api/optimize", { ...common, nflPortfolio: { ...settings, ownershipMode: "provided", ownershipOverrides: { 1: 17 } } });
    assert.deepEqual(Array.from(calls.at(-1).ownershipMap.entries()), [[1, 17]], "provided map must not be filled or overwritten");
    suppliedOwnership = false;
    const beforeAutomaticFailure = writes.length;
    savedPlayerOverrides = [{ playerId: 1, isLocked: true, maxExposure: 40 }];
    await invoke("/api/lineups/sim-regenerate", { ids: [1], contestType: "gpp", nflPortfolio: { enabled: false } }, 400);
    assert.equal(writes.length, beforeAutomaticFailure, "automatic impossible lock/exposure request must not save");
    savedPlayerOverrides = [];
    for (const mode of ["outperformer", "ceiling", "leverage"] as const) {
      failingAdjustment = mode;
      const writesBeforeModeFailure = writes.length;
      const failed = await invoke("/api/lineups/sim-regenerate", {
        ids: [1], contestType: "gpp",
        outperformerMode: mode === "outperformer",
        ceilingMode: mode === "ceiling",
        leverageMode: mode === "leverage",
      }, 400);
      assert.match(failed.message, new RegExp(`${mode === "outperformer" ? "Outperformer" : mode[0].toUpperCase() + mode.slice(1)} Mode could not be applied`));
      assert.match(failed.message, /No lineups were saved/);
      assert.equal(writes.length, writesBeforeModeFailure);
    }
    failingAdjustment = null;
    // Disabled incompatible contexts remain legal and must not reach the engine.
    slate = { ...slate, sport: "NBA" };
    for (const path of ["/api/optimize", "/api/optimize/pro", "/api/optimize/sim", "/api/lineups/sim-regenerate"]) {
      const rejected = await invoke(path, { ...common, ids: [1] }, 400);
      assert.match(rejected.message, /NFL DraftKings Classic GPP/);
    }
    assert.doesNotThrow(() => routes.validateNflPortfolioContext(undefined, slate, "fanduel", "cash"));
    assert.doesNotThrow(() => routes.validateNflPortfolioContext({ ...settings, enabled: false }, slate, "fanduel", "cash"));
    assert.throws(() => routes.validateNflPortfolioContext(settings, slate, "draftkings", "gpp"));
    const before = calls.length;
    const parsed = optimizationConstraintSchema.parse({ slateId: 77, nflPortfolio: { enabled: false } });
    assert.equal(parsed.nflPortfolio?.enabled, false);
    assert.equal(calls.length, before);
    slate = { ...slate, sport: "NFL" };
    const existingWrites = writes.length;
    const multiTarget = { ids: [1, 4], contestType: "gpp", nflPortfolio: settings };
    for (const condition of ["missing", "inactive", "closed"]) {
      missingTarget = condition === "missing";
      inactiveTarget = condition === "inactive";
      closedTarget = condition === "closed";
      const countBefore = calls.length;
      await invoke("/api/lineups/sim-regenerate", multiTarget, 400);
      assert.equal(calls.length, countBefore, "preflight must reject before any solves");
      assert.equal(writes.length, existingWrites);
    }
    missingTarget = inactiveTarget = closedTarget = false;
    failSecondGroup = true;
    await invoke("/api/lineups/sim-regenerate", multiTarget, 400);
    assert.equal(writes.length, existingWrites, "later target validation failure must prevent earlier writes");
    await invoke("/api/lineups/sim-regenerate", { ...multiTarget, nflPortfolio: { enabled: false } }, 400);
    assert.equal(writes.length, existingWrites, "automatic structure also defers every write until all target groups validate");
    failSecondGroup = false;
    closeDuringGeneration = true;
    await invoke("/api/lineups/sim-regenerate", multiTarget, 400);
    assert.equal(writes.length, existingWrites, "kickoff during generation must prevent all queued writes");
    closeDuringGeneration = closedTarget = false;
    const unavailableEv = await invoke("/api/optimize/sim", { ...common, numSims: 50, lineupCount: 1, sortMetric: "ev" }, 400);
    assert.match(unavailableEv.message, /EV portfolio scoring requires complete/);
    portfolioReturnCount = 12;
    cokerAppearances = 0;
    const partialIds = Array.from({ length: 15 }, (_, i) => 201 + i);
    const beforePartial = writes.length;
    const partialRegen = await invoke("/api/lineups/sim-regenerate", { ...common, ids: partialIds });
    assert.equal(partialRegen.updated, 12);
    assert.equal(partialRegen.total, 15);
    assert.equal(partialRegen.partial, true);
    assert.match(partialRegen.message, /active constraints.*12 of 15/i);
    assert.equal(writes.length, beforePartial + 12, "validated partial portfolio is saved");
    failTransactionWriteAt = 2;
    const beforeFailedTransaction = writes.length;
    const failedPartial = await invoke("/api/lineups/sim-regenerate", { ...common, ids: partialIds }, 500);
    assert.match(failedPartial.message, /Injected transaction write failure/);
    assert.equal(writes.length, beforeFailedTransaction, "a failed partial save rolls back every lineup write");
    failTransactionWriteAt = undefined;
    portfolioReturnCount = undefined;
    cokerAppearances = undefined;
    // Real HTTP final boundary regression: 13/15 (rounded 87%) must never save.
    cokerAppearances = 13;
    const requestedIds = Array.from({ length: 15 }, (_, i) => 101 + i);
    const beforeExposureFailure = writes.length;
    for (const path of ["/api/optimize/pro", "/api/optimize/sim", "/api/lineups/sim-regenerate"]) {
      const rejected = await invoke(path, { ...common, ids: requestedIds, lineupCount: 15, numSims: 50, globalMaxExposure: 80 }, 400);
      assert.match(rejected.message, /exposure/i);
      assert.equal(writes.length, beforeExposureFailure);
    }
    cokerAppearances = 12;
    const expectedKeys = Array.from({ length: 15 }, (_, i) =>
      Array.from({ length: 9 }, (_, slot) => slot === 4 && i < 12 ? 1 : 1000 + i * 9 + slot).sort((a, b) => a - b).join(",")).sort();
    for (const path of ["/api/optimize/pro", "/api/optimize/sim"]) {
      const accepted = await invoke(path, { ...common, lineupCount: 15, numSims: 50, globalMaxExposure: 80 });
      assert.equal(accepted.lineups.length, 15, "the accepted engine set must not be trimmed");
      assert.equal(accepted.lineups.filter((c: any) => c.lineup.some((p: any) => p.id === 1)).length, 12);
      assert.deepEqual(accepted.lineups.map((c: any) => c.lineup.map((p: any) => p.id).sort((a: number, b: number) => a - b).join(",")).sort(), expectedKeys);
    }
    const validRegen = await invoke("/api/lineups/sim-regenerate", { ...common, ids: requestedIds, globalMaxExposure: 80 });
    assert.equal(validRegen.updated, 15);
    const savedBatch = writes.slice(beforeExposureFailure);
    assert.equal(savedBatch.length, 15);
    assert.equal(savedBatch.filter(c => c.playerIds.includes(1)).length, 12);
    assert.deepEqual(savedBatch.map(c => [...c.playerIds].sort((a: number, b: number) => a - b).join(",")).sort(), expectedKeys);
    for (const invalid of [-1, 101, "80", null]) {
      await invoke("/api/lineups/sim-regenerate", { ...common, ids: [1], globalMaxExposure: invalid }, 400);
      assert.equal(writes.length, beforeExposureFailure + 15);
    }
    cokerAppearances = undefined;
    failLegacyExposureGroup = true;
    const beforeLegacyFailure = writes.length;
    await invoke("/api/lineups/sim-regenerate", { ids: [1, 4], globalMaxExposure: 100 }, 400);
    assert.equal(writes.length, beforeLegacyFailure, "legacy exposure-constrained groups must all validate before any saves");
    failLegacyExposureGroup = false;
    savedPlayerOverrides = [{ playerId: 1, maxExposure: 80 }];
    cokerAppearances = 13;
    for (const path of ["/api/optimize/pro", "/api/optimize/sim", "/api/lineups/sim-regenerate"]) {
      const rejected = await invoke(path, {
        ...common, ids: requestedIds, lineupCount: 15, numSims: 50,
        globalMaxExposure: 100, exposureLimits: { 1: 100 },
      }, 400);
      assert.match(rejected.message, /exposure/i, "request 100 must not loosen stored 80");
      assert.equal(writes.length, beforeLegacyFailure);
    }
    cokerAppearances = undefined;
    const cappedNormal = await invoke("/api/optimize", { slateId: 77 }, 400);
    assert.match(cappedNormal.message, /batch/i);
    const cappedBulk = await invoke("/api/lineups/bulk-generate", {
      ids: [1], slateId: 77, globalMaxExposure: 100, exposureLimits: { 1: 100 },
    }, 400);
    assert.match(cappedBulk.message, /exposure/i);
    assert.equal(writes.length, beforeLegacyFailure);
    cokerAppearances = undefined;
    savedPlayerOverrides = [{ playerId: 1, customProjection: "40", boostPercent: 20, isLocked: true }, { playerId: 11, isExcluded: true }];
    for (const path of ["/api/optimize", "/api/optimize/pro", "/api/optimize/sim", "/api/lineups/sim-regenerate"]) {
      await invoke(path, { ...common, ids: [1], lineupCount: 1, numSims: 50, playerProjections: { 1: 1 } });
      const last = calls.at(-1);
      assert.ok(last.baseConstraints.lockedPlayerIds.includes(1), path);
      assert.ok(Number(last.pool.find((p: any) => p.id === 1)?.projectedPoints) >= 48, `${path} honors stored projection and boost`);
      assert.ok(last.baseConstraints.excludedPlayerIds.includes(11) || !last.pool.some((p: any) => p.id === 11), path);
    }
    const beforeBulk = writes.length;
    const configuredBulk = await invoke("/api/lineups/bulk-generate", { ids: [1], slateId: 77, globalMaxExposure: 100, useBoosts: false });
    assert.equal(configuredBulk.updated, 1);
    assert.equal(writes.length, beforeBulk + 1);
    assert.ok(writes.at(-1).playerIds.includes(1));
    assert.ok(!writes.at(-1).playerIds.includes(11));
    const clone = await invoke("/api/lineups/sim-regenerate", { ...common, slateId: 78, ids: [1], preserveSourceSlateId: true });
    assert.equal(clone.created, 1);
    assert.deepEqual(calls.at(-1).baseConstraints.lockedPlayerIds, [], "source-slate locks never leak into target configuration");
    assert.equal(writes.at(-1).userId, "owner", "clone belongs to source owner");
    assert.equal(writes.at(-1).slateId, 78);
    savedPlayerOverrides = [];
    const requestProjectionResult = await invoke("/api/optimize/sim", { ...common, numSims: 50, lineupCount: 1,
      playerProjections: { 1: 77 } });
    assert.equal(Number(calls.at(-1).pool.find((p: any) => p.id === 1).projectedPoints), 77,
      "request-only projection enters canonical baseline pool, not just simulation map");
    assert.equal(lastSimulationProjections[1], 77, "simulation and deterministic quality share the canonical edit");
    assert.equal(Number(requestProjectionResult.lineups[0].lineup.find((p: any) => p.id === 1).projectedPoints), 77);
    assert.equal(requestProjectionResult.lineups[0].totalProjectedPoints, 237);
    savedPlayerOverrides = [{ playerId: 1, boostPercent: 20 }];
    await invoke("/api/optimize/sim", { ...common, numSims: 50, lineupCount: 1,
      playerProjections: { 1: 50 } });
    assert.equal(Number(calls.at(-1).pool.find((p: any) => p.id === 1).projectedPoints), 60);
    savedPlayerOverrides = [];
    const normalDiagnostics = await invoke("/api/optimize", { slateId: 77 });
    assert.equal(normalDiagnostics.searchDiagnostics.candidatesConsidered, 1,
      "identical preference and baseline rosters count once");
    const emptyNormal = await invoke("/api/optimize", { slateId: 77, projectedPointsFloor: 500 });
    assert.equal(emptyNormal.searchDiagnostics.generatedCount, 0);
    assert.equal(emptyNormal.searchDiagnostics.effectiveFloor, 500);
    const mixedBulk = await invoke("/api/lineups/bulk-generate", { ids: [1, 4], globalMaxExposure: 100 });
    assert.deepEqual(mixedBulk.searchReports.map((entry: any) => entry.report.requestedCount), [1, 1]);
    const originalProjections = players.map(p => p.projectedPoints);
    try {
      players.forEach(p => { p.projectedPoints = "20.003"; });
      for (const path of ["/api/lineups/sim-regenerate", "/api/lineups/bulk-generate"]) {
        for (const target of [77, 78]) {
          const beforeFractional = writes.length;
          const fractional = await invoke(path, { ids: [1], slateId: target, preserveSourceSlateId: true,
            ...(path.endsWith("sim-regenerate") ? { contestType: "gpp", nflPortfolio: settings } : { contestType: "cash" }),
            globalMaxExposure: 100, projFloor: 180.025, useBoosts: false });
          assert.equal(fractional.updated + fractional.cloned, 1, `${path} returns the fractional qualifier`);
          assert.equal(writes.length, beforeFractional + 1);
          assert.ok(Number(writes.at(-1).totalProjectedPoints) >= 180.025,
            `${path} must not round an eligible update/clone below its floor`);
        }
      }
      players.forEach(p => { p.projectedPoints = p.id > 9 ? "1" : "20"; });
      forceWeakSimulation = true;
      const seeded = await invoke("/api/lineups/sim-regenerate", { ids: [1], contestType: "cash", projFloor: 179 });
      assert.equal(seeded.updated, 1, "deterministic qualifier remains selectable when simulated winners are weak");
      assert.ok(Number(writes.at(-1).totalProjectedPoints) >= 179);
    } finally {
      forceWeakSimulation = false;
      players.forEach((p, i) => { p.projectedPoints = originalProjections[i]; });
    }
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const [id, previous] of saved) {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    }
  }
});