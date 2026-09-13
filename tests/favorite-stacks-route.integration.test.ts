import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Player, Slate } from "../shared/schema";

const require = createRequire(import.meta.url);
const favoriteStacksPath = "/api/slates/:slateId/favorite-stacks";
const favoriteStackDeletePath = "/api/slates/:slateId/favorite-stacks/:id";
const simulationPath = "/api/optimize/sim";

function makeSlate(overrides: Partial<Slate> = {}): Slate {
  return {
    id: 77,
    sport: "NFL",
    platform: "draftkings",
    name: "NFL Classic",
    startTime: new Date("2099-09-13T17:00:00.000Z"),
    isMain: true,
    isActive: true,
    draftGroupId: 7701,
    gameType: "Classic",
    label: "NFL Classic",
    gameCount: 4,
    contestCount: 1,
    salaryCap: 50_000,
    ...overrides,
  } as Slate;
}

function makePlayer(id: number, team: string, position: string, gameInfo: string): Player {
  return {
    id,
    slateId: 77,
    name: `${team} ${position} ${id}`,
    position,
    team,
    salary: 5_000,
    projectedPoints: "12",
    fppg: "12",
    opponent: team === "BUF" ? "HOU" : team === "HOU" ? "BUF" : "NO",
    gameInfo,
    injuryStatus: null,
    injuryDetail: null,
  } as Player;
}

function makeApp() {
  const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const register = (path: string, ...registeredHandlers: any[]) => {
    handlers.set(`${path}:${registeredHandlers[registeredHandlers.length - 1].name}`, registeredHandlers[registeredHandlers.length - 1]);
  };
  return {
    app: {
      set() {},
      use() {},
      get: (path: string, ...routeHandlers: any[]) => {
        if (path === favoriteStacksPath) handlers.set("GET", routeHandlers[routeHandlers.length - 1]);
      },
      post: (path: string, ...routeHandlers: any[]) => {
        if (path === favoriteStacksPath) handlers.set("POST", routeHandlers[routeHandlers.length - 1]);
        if (path === simulationPath) handlers.set("SIM", routeHandlers[routeHandlers.length - 1]);
      },
      delete: (path: string, ...routeHandlers: any[]) => {
        if (path === favoriteStackDeletePath) handlers.set("DELETE", routeHandlers[routeHandlers.length - 1]);
      },
      put: register,
      patch: register,
    } as any,
    handler(method: string) {
      const handler = handlers.get(method);
      assert.ok(handler, `expected ${method} favorite-stack route`);
      return handler;
    },
  };
}

function capture() {
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

test("favorite-stack CRUD validates slate-local ownership and canonical player groups", async () => {
  const dbPath = require.resolve("../server/db.ts");
  const previousDbModule = require.cache[dbPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { db: {}, pool: {} },
  } as any;

  const routesModule = require("../server/routes.ts") as typeof import("../server/routes");
  const storageModule = require("../server/storage.ts") as typeof import("../server/storage");
  const storage = storageModule.storage as any;
  const slate = makeSlate();
  const showdown = makeSlate({ id: 78, gameType: "Showdown" });
  const players = [
    makePlayer(1, "BUF", "QB", "BUF @ HOU 1:00 PM ET"),
    makePlayer(2, "BUF", "WR", "BUF @ HOU 1:00 PM ET"),
    makePlayer(3, "HOU", "WR", "BUF @ HOU 1:00 PM ET"),
    makePlayer(4, "NO", "WR", "NO @ DET 1:00 PM ET"),
  ];
  const createdRows: any[] = [];
  let deleted: { userId: string; slateId: number; id: number } | undefined;
  const originals = new Map<string, unknown>();
  let favoriteLookupUserId = "";
  for (const method of [
    "getSlate",
    "getPlayersBySlate",
    "getFavoriteStacks",
    "createFavoriteStack",
    "deleteFavoriteStack",
    "getUser",
    "getSubscription",
  ]) {
    originals.set(method, storage[method]);
  }
  storage.getSlate = async (id: number) => id === slate.id ? slate : id === showdown.id ? showdown : undefined;
  storage.getPlayersBySlate = async (slateId: number) => slateId === slate.id ? players : [];
  storage.getFavoriteStacks = async (userId: string, slateId: number) =>
    (favoriteLookupUserId = userId, createdRows.filter(row => row.userId === userId && row.slateId === slateId));
  storage.getUser = async (userId: string) => ({ id: userId, isAdmin: false });
  storage.getSubscription = async () => ({ tier: "pro" });
  storage.createFavoriteStack = async (input: any) => {
    const row = { id: createdRows.length + 1, createdAt: new Date(), ...input };
    createdRows.push(row);
    return row;
  };
  storage.deleteFavoriteStack = async (userId: string, slateId: number, id: number) => {
    deleted = { userId, slateId, id };
    return createdRows.some(row => row.id === id && row.userId === userId && row.slateId === slateId);
  };

  try {
    const { app, handler } = makeApp();
    await routesModule.registerRoutes({} as any, app);
    const post = handler("POST");
    const get = handler("GET");
    const remove = handler("DELETE");
    const simulate = handler("SIM");
    const request = (body: any, userId = "owner") => ({
      params: { slateId: String(slate.id) },
      body,
      session: { userId },
    });

    let result = capture();
    await post(request({ kind: "game", name: "bad format", gameKey: "BUF @ HOU" }), result.response);
    assert.equal(result.state.status, 400);

    result = capture();
    await post(request({ kind: "players", name: "duplicate", playerIds: [1, 1, 2] }), result.response);
    assert.equal(result.state.status, 400);

    result = capture();
    await post(request({ kind: "players", name: "stale player", playerIds: [1, 999] }), result.response);
    assert.equal(result.state.status, 400);

    result = capture();
    await post(request({ kind: "players", name: "cross game", playerIds: [1, 4] }), result.response);
    assert.equal(result.state.status, 400);

    result = capture();
    await post(request({ kind: "game", name: "BUF game", gameKey: "HOU-BUF" }), result.response);
    assert.equal(result.state.status, 201);
    assert.equal(result.state.body.gameKey, "BUF-HOU");

    result = capture();
    await post(request({ kind: "players", name: "BUF group", playerIds: [3, 1, 2] }), result.response);
    assert.equal(result.state.status, 201);
    assert.deepEqual(result.state.body.playerIds, [1, 2, 3]);
    assert.equal(result.state.body.gameKey, "BUF-HOU");
    assert.equal(createdRows[1].userId, "owner");

    result = capture();
    await get({ params: { slateId: String(slate.id) }, session: { userId: "other" } }, result.response);
    assert.equal(result.state.status, 200);
    assert.deepEqual(result.state.body, []);

    result = capture();
    await remove({ params: { slateId: String(slate.id), id: "1" }, session: { userId: "other" } }, result.response);
    assert.equal(result.state.status, 404);
    assert.deepEqual(deleted, { userId: "other", slateId: slate.id, id: 1 });

    result = capture();
    await remove({ params: { slateId: String(slate.id), id: "1" }, session: { userId: "owner" } }, result.response);
    assert.equal(result.state.status, 204);

    // The simulation lookup must be scoped by the authenticated account. A
    // stack saved by owner is not resolvable by another account even when the
    // caller supplies its numeric ID.
    createdRows.push({
      id: 99,
      userId: "owner",
      slateId: slate.id,
      kind: "game",
      name: "Owner game",
      gameKey: "BUF-HOU",
      playerIds: [],
    });
    result = capture();
    await simulate({
      params: {},
      session: { userId: "other" },
      body: {
        slateId: slate.id,
        favoriteStackIds: [99],
        lineupCount: 1,
        numSims: 50,
      },
    }, result.response);
    assert.equal(result.state.status, 400);
    assert.match(result.state.body.message, /not saved for this slate/i);
    assert.equal(favoriteLookupUserId, "other");

    result = capture();
    await get({ params: { slateId: String(showdown.id) }, session: { userId: "owner" } }, result.response);
    assert.equal(result.state.status, 400);
  } finally {
    for (const [method, original] of originals) storage[method] = original;
    if (previousDbModule) require.cache[dbPath] = previousDbModule;
    else delete require.cache[dbPath];
  }
});