import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerPlayerConfiguration, retiredPlayerDetail } from "../server/player-configuration";

test("configuration HTTP persistence, scope, validation, expiry and resets", async () => {
  const future = new Date(Date.now() + 86400000);
  const slates: any[] = [
    { id: 1, startTime: future, isActive: true },
    { id: 2, startTime: future, isActive: true },
    { id: 3, startTime: new Date("2020-01-01T17:00:00Z"), isActive: false },
  ];
  const players: any[] = [
    { id: 10, slateId: 1, draftKingsPlayerId: 100, injuryDetail: null },
    { id: 11, slateId: 1, draftKingsPlayerId: 101, injuryDetail: null },
    { id: 20, slateId: 2, draftKingsPlayerId: 100, injuryDetail: null },
    { id: 30, slateId: 3, draftKingsPlayerId: 100, injuryDetail: null, gameInfo: "[DK_START:2020-01-01T23:00:00Z]" },
  ];
  let overrides: any[] = [];
  const lineups: any[] = [
    { userId: "a", slateId: 1, playerIds: [900, 900, 11], playerSnapshot: [{ id: 900, draftKingsPlayerId: 100 }] },
    { userId: "a", slateId: 1, playerIds: [10], playerSnapshot: [] },
    { userId: "a", slateId: 2, playerIds: [20], playerSnapshot: [] },
    { userId: "b", slateId: 1, playerIds: [11], playerSnapshot: [] },
  ];
  const storage: any = {
    getUser: async (id: string) => ({ id, isAdmin: id === "admin" }),
    getSubscription: async (id: string) => ({ tier: id === "free" ? "free" : "pro" }),
    getSlate: async (id: number) => slates.find(s => s.id === id),
    getPlayersBySlate: async (id: number) => players.filter(p => p.slateId === id),
    getPlayerOverrides: async (userId: string, slateId: number) => overrides.filter(o => o.userId === userId && o.slateId === slateId),
    getAllLineups: async () => lineups,
    upsertPlayerOverride: async (data: any) => {
      overrides = overrides.filter(o => !(o.userId === data.userId && o.slateId === data.slateId && o.playerId === data.playerId));
      overrides.push({ id: overrides.length + 1, ...data });
      return overrides.at(-1);
    },
    deletePlayerOverride: async (userId: string, slateId: number, playerId: number) => { overrides = overrides.filter(o => !(o.userId === userId && o.slateId === slateId && o.playerId === playerId)); },
    deletePlayerOverridesByUser: async (userId: string, slateId: number) => { overrides = overrides.filter(o => !(o.userId === userId && o.slateId === slateId)); },
  };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.session = { userId: req.headers["x-test-user"] }; next(); });
  registerPlayerConfiguration(app, storage);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const request = async (method: string, path: string, body?: any, user = "a") => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, headers: { "content-type": "application/json", "x-test-user": user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const put = (body: any, path = "/api/player-overrides/1/10") => request("PUT", path, body);
    assert.equal((await put({ maxExposure: 80, boostPercent: 15, customProjection: 30, notes: "keep" })).status, 200);
    assert.equal((await put({ notes: "changed" })).body.maxExposure, 80);
    const loaded = await request("GET", "/api/player-configuration/1");
    assert.equal(loaded.body.overrides[0].boostPercent, 15);
    assert.equal(loaded.body.overrides[0].customProjection, "30");
    assert.equal(loaded.body.lineupCount, 2);
    assert.deepEqual(loaded.body.exposures["10"], { count: 2, pct: 100 });
    assert.deepEqual(loaded.body.exposures["11"], { count: 1, pct: 50 });
    assert.equal((await request("GET", "/api/player-overrides/1")).body[0].dkPlayerId, 100);
    assert.equal((await request("GET", "/api/player-configuration/1", undefined, "b")).body.overrides.length, 0);
    assert.equal((await request("GET", "/api/player-configuration/2")).body.overrides.length, 0);
    for (const body of [{ isLocked: true }, { minExposure: 90 }, { customProjection: 501 }, { boostPercent: 9 }, { notes: "x".repeat(201) }, { dkPlayerId: 101 }]) assert.equal((await put(body)).status, 400);
    assert.equal((await put({ dkPlayerId: 100 }, "/api/player-overrides/1/20")).status, 400);
    assert.equal((await put({}, "/api/player-overrides/1/10junk")).status, 400);
    assert.equal((await request("DELETE", "/api/player-overrides/1/10", undefined, "free")).status, 403);
    assert.equal((await request("GET", "/api/player-configuration/1", undefined, "")).status, 401);
    assert.equal((await put({ maxExposure: null, customProjection: null, boostPercent: null })).body.maxExposure, null);
    assert.equal((await put({ isLocked: true })).status, 200);
    await put({ minExposure: 50 });
    const excluded = await put({ isExcluded: true });
    assert.equal(excluded.status, 200);
    assert.equal(excluded.body.isLocked, false);
    assert.equal(excluded.body.minExposure, null);
    assert.equal((await request("GET", "/api/player-configuration/1")).body.overrides[0].isExcluded, true);
    assert.equal((await request("GET", "/api/player-configuration/2")).body.overrides.length, 0);
    assert.equal((await request("GET", "/api/player-configuration/1", undefined, "b")).body.overrides.length, 0);
    const contradictory = await put({ isLocked: true, minExposure: 90 });
    assert.equal(contradictory.body.isLocked, false);
    assert.equal(contradictory.body.minExposure, null);
    const included = await put({ isExcluded: false });
    assert.equal(included.body.isExcluded, false);
    assert.equal(included.body.isLocked, false);
    assert.equal(included.body.minExposure, null);
    const expired = await request("GET", "/api/player-configuration/3");
    assert.equal(expired.body.isExpired, true);
    assert.equal(expired.body.expiresAt, "2020-01-02T02:00:00.000Z");
    for (const method of ["PUT", "DELETE"]) assert.equal((await request(method, "/api/player-overrides/3/30", {})).status, 409);
    assert.equal((await request("DELETE", "/api/player-overrides/3")).status, 409);
    // Same pool row remains addressable through a feed refresh.
    players[0].projectedPoints = "42";
    assert.equal((await request("GET", "/api/player-configuration/1")).body.overrides[0].playerId, 10);
    players[1].injuryDetail = retiredPlayerDetail;
    assert.equal((await request("GET", "/api/player-configuration/1")).body.players.length, 1);
    assert.equal((await request("DELETE", "/api/player-overrides/1/10")).status, 200);
    assert.equal((await request("GET", "/api/player-overrides/1")).body.length, 0);
    await put({ maxExposure: 80 });
    await request("PUT", "/api/player-overrides/1/10", { maxExposure: 60 }, "b");
    await request("DELETE", "/api/player-overrides/1");
    assert.equal((await request("GET", "/api/player-overrides/1")).body.length, 0);
    assert.equal((await request("GET", "/api/player-overrides/1", undefined, "b")).body[0].maxExposure, 60);
    await put({ maxExposure: 80, notes: "survives retirement" });
    players[0].injuryDetail = retiredPlayerDetail;
    players.push({ ...players[0], id: 12, injuryDetail: null });
    const rebound = await request("GET", "/api/player-configuration/1");
    assert.equal(rebound.body.overrides[0].playerId, 12);
    assert.equal(rebound.body.overrides[0].maxExposure, 80);
    assert.deepEqual(rebound.body.exposures["12"], { count: 2, pct: 100 }, "retired row without snapshot rebinds by retained DK identity");
    assert.equal((await put({ dkPlayerId: 100, boostPercent: 10 })).body.playerId, 12);
    assert.equal((await request("GET", "/api/player-overrides/1")).body[0].notes, "survives retirement");
    assert.equal(overrides.filter(o => o.userId === "a").length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});