import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Player, Slate } from "../shared/schema";

const require = createRequire(import.meta.url);
const importRoutePath = "/api/lineups/import-dk";

function makeSlate(overrides: Partial<Slate> = {}): Slate {
  return {
    id: 11,
    sport: "NFL",
    platform: "draftkings",
    name: "NFL Featured Main",
    startTime: new Date("2026-09-13T17:00:00.000Z"),
    isMain: true,
    isActive: true,
    draftGroupId: 1101,
    gameType: "Classic",
    label: "Featured Main",
    gameCount: 12,
    contestCount: 1,
    salaryCap: 50000,
    ...overrides,
  };
}

function makeDraftable(draftableId: number, position: string, displayName: string): Record<string, any> {
  return {
    draftableId,
    firstName: displayName.split(" ")[0],
    lastName: displayName.split(" ").slice(1).join(" "),
    displayName,
    playerId: draftableId,
    position,
    salary: 5000,
    status: "",
    newsStatus: "",
    teamAbbreviation: "SEA",
    teamId: 1,
    competition: {
      competitionId: 1,
      name: "SEA @ DEN",
      startTime: "2026-09-13T13:00:00.0000000",
    },
    draftStatAttributes: [],
    playerGameAttributes: [],
  };
}

function makeDraftablePool(ids: number[]): Record<string, any>[] {
  const positions = ["QB", "RB", "RB", "RB", "WR", "WR", "TE", "DST"];
  return [
    makeDraftable(ids[0], "WR", "Overlapping Receiver"),
    ...positions.map((position, index) =>
      makeDraftable(ids[index + 1], position, `${position} Player ${index + 1}`),
    ),
  ];
}

function makeApp() {
  let importHandler: ((req: any, res: any) => Promise<unknown>) | undefined;
  const register = (path: string, ...handlers: any[]) => {
    if (path === importRoutePath) importHandler = handlers[handlers.length - 1];
  };
  return {
    app: {
      set() {},
      use() {},
      get: register,
      post: register,
      put: register,
      patch: register,
      delete: register,
    } as any,
    getImportHandler: () => importHandler,
  };
}

test("route imports mixed groups, repairs an empty pool, creates an absent group, and rejects unknown contests", async () => {
  const dbPath = require.resolve("../server/db.ts");
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { db: {}, pool: {} },
  } as any;

  const routesModule = require("../server/routes.ts") as typeof import("../server/routes");
  const storageModule = require("../server/storage.ts") as typeof import("../server/storage");
  const storage = storageModule.storage as any;

  const mainSlate = makeSlate();
  const slates: Slate[] = [mainSlate];
  const players: Player[] = [];
  const lineups: any[] = [{ id: 900, slateId: mainSlate.id, sport: "NFL" }];
  const recheckedDraftGroups: number[] = [];
  const nextPlayerId = { value: 1000 };
  const nextSlateId = { value: 12 };
  const nextLineupId = { value: 901 };
  const methods = [
    "getSubscription",
    "getUser",
    "getSlates",
    "getSlateByDraftGroup",
    "getPlayersBySlate",
    "bulkCreatePlayers",
    "createSlate",
    "deleteSlateAndPlayers",
    "getLineupCountBySport",
    "createLineup",
  ];
  const originals = new Map<string, unknown>();
  for (const method of methods) originals.set(method, storage[method]);

  storage.getSubscription = async () => ({ tier: "pro" });
  storage.getUser = async () => ({ id: "import-user", isAdmin: false });
  storage.getSlates = async () => slates.slice();
  storage.getSlateByDraftGroup = async (sport: string, platform: string, draftGroupId: number) => {
    recheckedDraftGroups.push(draftGroupId);
    return slates.find(slate =>
      slate.sport === sport &&
      slate.platform === platform &&
      slate.draftGroupId === draftGroupId,
    );
  };
  storage.getPlayersBySlate = async (slateId: number) => players.filter(player => player.slateId === slateId);
  storage.bulkCreatePlayers = async (incoming: any[]) => {
    const created = incoming.map(player => ({ ...player, id: nextPlayerId.value++ }));
    players.push(...created);
    return created;
  };
  storage.createSlate = async (incoming: any) => {
    const created = {
      id: nextSlateId.value++,
      isActive: true,
      gameType: "Classic",
      label: null,
      gameCount: 0,
      contestCount: 0,
      salaryCap: 50000,
      ...incoming,
    };
    slates.push(created);
    return created;
  };
  storage.deleteSlateAndPlayers = async (slateId: number) => {
    const index = slates.findIndex(slate => slate.id === slateId);
    if (index >= 0) slates.splice(index, 1);
    for (let i = players.length - 1; i >= 0; i--) {
      if (players[i].slateId === slateId) players.splice(i, 1);
    }
  };
  storage.getLineupCountBySport = async (_userId: string, sport: string) =>
    lineups.filter(lineup => lineup.sport === sport).length;
  storage.createLineup = async (incoming: any) => {
    const created = { id: nextLineupId.value++, ...incoming };
    lineups.push(created);
    return created;
  };

  const previousFetch = globalThis.fetch;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unit-test/unit-test";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "unit-test";

  const pools = new Map<number, Record<string, any>[]>();
  pools.set(1101, makeDraftablePool([5001, 5101, 5102, 5103, 5104, 5105, 5106, 5107, 5108]));
  pools.set(1102, makeDraftablePool([5001, 5201, 5202, 5203, 5204, 5205, 5206, 5207, 5208]));
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/lobby/getcontests?sport=NFL")) {
      return new Response(JSON.stringify({
        DraftGroups: [
          {
            DraftGroupId: 1101,
            GameCount: 12,
            StartDateEst: "2026-09-13T13:00:00.0000000",
            GameTypeId: 1,
            ContestTypeId: 21,
            DraftGroupTag: "Featured",
          },
          {
            DraftGroupId: 1102,
            GameCount: 14,
            StartDateEst: "2026-09-13T13:00:00.0000000",
            GameTypeId: 1,
            ContestTypeId: 21,
            ContestStartTimeSuffix: " (Sun-Mon)",
          },
        ],
        Contests: [
          { id: 2101, dg: 1101, n: "NFL Featured Main" },
          { id: 2102, dg: 1102, n: "NFL Sunday-Monday Extended" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    const draftGroupMatch = url.match(/draftgroups\/(\d+)\/draftables/);
    if (draftGroupMatch) {
      const draftables = pools.get(Number(draftGroupMatch[1])) || [];
      return new Response(JSON.stringify({ draftables }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in route regression: ${url}`);
  }) as typeof fetch;

  try {
    const { app, getImportHandler } = makeApp();
    await routesModule.registerRoutes({} as any, app);
    const importHandler = getImportHandler();
    assert.ok(importHandler, "the import route should be registered");

    const responseState: { status: number; body?: any } = { status: 200 };
    const response = {
      status(code: number) {
        responseState.status = code;
        return this;
      },
      json(body: any) {
        responseState.body = body;
        return this;
      },
      sendStatus(code: number) {
        responseState.status = code;
        return this;
      },
    };

    await importHandler!({
      session: { userId: "import-user" },
      body: {
        sport: "NFL",
        entries: [
          {
            entryId: "main-entry",
            contestId: "2101",
            contestName: "NFL Featured Main",
            dkPlayerIds: [5001, 5101, 5102, 5103, 5104, 5105, 5106, 5107, 5108],
          },
          {
            entryId: "extended-entry",
            contestId: "2102",
            contestName: "NFL Sunday-Monday Extended",
            dkPlayerIds: [5001, 5201, 5202, 5203, 5204, 5205, 5206, 5207, 5208],
          },
          {
            entryId: "unknown-entry",
            contestId: "9999",
            dkPlayerIds: [5001, 5101, 5102, 5103, 5104, 5105, 5106, 5107, 5108],
          },
        ],
      },
    }, response);

    assert.equal(responseState.status, 200);
    assert.equal(responseState.body.imported, 2);
    assert.equal(responseState.body.results.find((result: any) => result.entryId === "unknown-entry").status, "failed");
    assert.equal(responseState.body.results.find((result: any) => result.entryId === "unknown-entry").error, "Contest ID was not found in the live DraftKings lobby.");
    assert.deepEqual(
      lineups.filter(lineup => lineup.id !== 900).map(lineup => lineup.slateId),
      [11, 12],
      "each contest must save against its own local slate",
    );
    assert.equal(players.filter(player => player.slateId === 11).length, 9, "empty existing main pool should be repaired");
    assert.equal(players.filter(player => player.slateId === 12).length, 9, "missing extended pool should be imported");
    assert.ok(recheckedDraftGroups.includes(1102), "missing groups must be rechecked before create");
    assert.equal(slates.length, 2, "unknown contests must not create a slate");
    assert.equal(lineups.find(lineup => lineup.id === 900)?.slateId, 11, "old lineups must be preserved");
  } finally {
    globalThis.fetch = previousFetch;
    for (const [method, original] of originals) storage[method] = original;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
});