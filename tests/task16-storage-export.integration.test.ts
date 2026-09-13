import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { Player, Slate } from "../shared/schema";
import { alerts, lineups, playerOverrides, players, props, slates } from "../shared/schema";
import { resolvePlayersForExport, type ExportDraftable } from "../server/export-player-resolver";

type TableName = "alerts" | "lineups" | "playerOverrides" | "players" | "props" | "slates";
type Row = Record<string, any>;

interface FakeState {
  alerts: Row[];
  lineups: Row[];
  playerOverrides: Row[];
  players: Row[];
  props: Row[];
  slates: Row[];
}

const columnRefs = new Map<object, { table: TableName; field: string }>([
  [alerts.lineupId, { table: "alerts", field: "lineupId" }],
  [alerts.playerId, { table: "alerts", field: "playerId" }],
  [lineups.id, { table: "lineups", field: "id" }],
  [lineups.slateId, { table: "lineups", field: "slateId" }],
  [lineups.playerIds, { table: "lineups", field: "playerIds" }],
  [playerOverrides.slateId, { table: "playerOverrides", field: "slateId" }],
  [playerOverrides.playerId, { table: "playerOverrides", field: "playerId" }],
  [players.id, { table: "players", field: "id" }],
  [players.slateId, { table: "players", field: "slateId" }],
  [props.playerId, { table: "props", field: "playerId" }],
  [slates.id, { table: "slates", field: "id" }],
]);

function tableName(table: object): TableName {
  if (table === alerts) return "alerts";
  if (table === lineups) return "lineups";
  if (table === playerOverrides) return "playerOverrides";
  if (table === players) return "players";
  if (table === props) return "props";
  if (table === slates) return "slates";
  const nameSymbol = Object.getOwnPropertySymbols(table)
    .find(symbol => String(symbol) === "Symbol(drizzle:Name)");
  const name = nameSymbol ? (table as any)[nameSymbol] : undefined;
  if (name === "player_overrides") return "playerOverrides";
  if (name === "lineups" || name === "players" || name === "props" || name === "alerts" || name === "slates") {
    return name;
  }
  throw new Error("The fake database received an unsupported table.");
}

function columnReference(column: object): { table: TableName; field: string } | undefined {
  const directReference = columnRefs.get(column);
  if (directReference) return directReference;
  const table = (column as any).table;
  if (!table) return undefined;
  const name = tableName(table);
  const fieldByDatabaseName: Record<string, string> = {
    id: "id",
    lineup_id: "lineupId",
    player_id: "playerId",
    player_ids: "playerIds",
    slate_id: "slateId",
  };
  const databaseName = String((column as any).name);
  const field = fieldByDatabaseName[databaseName] ||
    databaseName.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return field ? { table: name, field } : undefined;
}

function collectSqlParts(value: unknown, columns: { table: TableName; field: string }[], params: unknown[], seen = new Set<object>()): void {
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, any>;
  const column = columnReference(object);
  if (column) {
    columns.push(column);
    return;
  }
  if (object.constructor?.name === "Param" && Object.prototype.hasOwnProperty.call(object, "value")) {
    params.push(object.value);
    return;
  }
  if (seen.has(object)) return;
  seen.add(object);
  if (Array.isArray(value)) {
    for (const child of value) collectSqlParts(child, columns, params, seen);
    return;
  }
  if (Array.isArray(object.queryChunks)) {
    collectSqlParts(object.queryChunks, columns, params, seen);
  }
}

function matches(table: TableName, row: Row, condition: unknown): boolean {
  if (!condition) return true;
  const columns: { table: TableName; field: string }[] = [];
  const params: unknown[] = [];
  collectSqlParts(condition, columns, params);
  const tableColumns = columns.filter(column => column.table === table);
  if (tableColumns.length === 0) return false;

  if (tableColumns.length === 1 && params.length > 1) {
    return params.includes(row[tableColumns[0].field]);
  }
  return tableColumns.every((column, index) => row[column.field] === params[index]);
}

class SelectQuery {
  private source?: object;
  private condition?: unknown;

  constructor(private readonly database: FakeDatabase, private readonly projection?: Record<string, object>) {}

  from(table: object): this {
    this.source = table;
    return this;
  }

  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  private execute(): Row[] {
    const source = this.source;
    if (!source) throw new Error("The fake select query has no source table.");
    const name = tableName(source);
    const rows = this.database.state[name].filter(row => matches(name, row, this.condition));
    if (!this.projection) return rows.map(row => ({ ...row }));
    return rows.map(row => Object.fromEntries(
      Object.entries(this.projection).map(([key, column]) => {
        const reference = columnReference(column);
        return [key, reference ? row[reference.field] : undefined];
      }),
    ));
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class UpdateQuery {
  private values: Row = {};
  private condition?: unknown;

  constructor(private readonly database: FakeDatabase, private readonly source: object) {}

  set(values: Row): this {
    this.values = values;
    return this;
  }

  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }

  private execute(): Row[] {
    const name = tableName(this.source);
    for (const row of this.database.state[name]) {
      if (matches(name, row, this.condition)) Object.assign(row, this.values);
    }
    return [];
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class InsertQuery {
  private valuesToInsert: Row[] = [];

  constructor(private readonly database: FakeDatabase, private readonly source: object) {}

  values(values: Row | Row[]): this {
    this.valuesToInsert = Array.isArray(values) ? values : [values];
    return this;
  }

  private execute(): Row[] {
    const name = tableName(this.source);
    const rows = this.database.state[name];
    const idField = name === "players" ? "id" : name === "lineups" ? "id" : name === "slates" ? "id" : null;
    let nextId = idField
      ? Math.max(0, ...rows.map(row => Number(row[idField]) || 0)) + 1
      : 0;
    const created = this.valuesToInsert.map(value => {
      const row = { ...value };
      if (idField && row[idField] == null) row[idField] = nextId++;
      rows.push(row);
      return row;
    });
    return created;
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class DeleteQuery {
  private condition?: unknown;

  constructor(private readonly database: FakeDatabase, private readonly source: object) {}

  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }

  private execute(): Row[] {
    const name = tableName(this.source);
    const removed = this.database.state[name].filter(row => matches(name, row, this.condition));
    if (name === "players") {
      const removedPlayerIds = new Set(removed.map(row => row.id));
      const danglingOverride = this.database.state.playerOverrides.find(override =>
        removedPlayerIds.has(override.playerId),
      );
      if (danglingOverride) {
        throw new Error(`foreign key violation: player override ${danglingOverride.id} references a removed player`);
      }
    }
    this.database.state[name] = this.database.state[name].filter(row => !matches(name, row, this.condition));
    return removed;
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class FakeDatabase {
  state: FakeState = {
    alerts: [],
    lineups: [],
    playerOverrides: [],
    players: [],
    props: [],
    slates: [],
  };

  reset(state: FakeState): void {
    this.state = {
      alerts: state.alerts.map(row => ({ ...row })),
      lineups: state.lineups.map(row => ({ ...row })),
      playerOverrides: state.playerOverrides.map(row => ({ ...row })),
      players: state.players.map(row => ({ ...row })),
      props: state.props.map(row => ({ ...row })),
      slates: state.slates.map(row => ({ ...row })),
    };
  }

  select(projection?: Record<string, object>): SelectQuery {
    return new SelectQuery(this, projection);
  }

  update(table: object): UpdateQuery {
    return new UpdateQuery(this, table);
  }

  insert(table: object): InsertQuery {
    return new InsertQuery(this, table);
  }

  delete(table: object): DeleteQuery {
    return new DeleteQuery(this, table);
  }

  async transaction<T>(callback: (transaction: FakeDatabase) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

const fakeDatabase = new FakeDatabase();
const require = createRequire(import.meta.url);
let storageModule: typeof import("../server/storage") | undefined;

function getStorage(): InstanceType<typeof import("../server/storage").DatabaseStorage> {
  if (!storageModule) {
    // Loading through tsx's CommonJS bridge lets the test replace the db
    // module before storage.ts captures its imported binding.  This keeps the
    // integration suite entirely in-memory without touching DATABASE_URL.
    const dbPath = require.resolve("../server/db.ts");
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: { db: fakeDatabase, pool: {} },
    } as any;
    storageModule = require("../server/storage.ts") as typeof import("../server/storage");
  }
  return new storageModule.DatabaseStorage();
}

function makeSlate(overrides: Partial<Slate> = {}): Slate {
  return {
    id: 101,
    sport: "NFL",
    platform: "draftkings",
    name: "NFL Sunday-Monday Extended",
    startTime: new Date("2026-09-13T17:00:00.000Z"),
    isMain: false,
    isActive: true,
    draftGroupId: 9101,
    gameType: "Classic",
    label: "Sunday-Monday Extended",
    gameCount: 14,
    contestCount: 1,
    salaryCap: 50000,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 501,
    slateId: 101,
    name: "Monday Night Receiver",
    team: "SEA",
    position: "WR",
    salary: 5500,
    fppg: "10",
    projectedPoints: "12",
    opponent: "DEN",
    gameInfo: "SEA @ DEN 8:15 PM ET",
    injuryStatus: null,
    injuryDetail: null,
    boostScore: null,
    boostReason: null,
    draftKingsPlayerId: 9101001,
    fanDuelPlayerId: null,
    yahooPlayerId: null,
    fanDuelSalary: null,
    yahooSalary: null,
    isConfirmedStarter: false,
    ...overrides,
  };
}

function draftable(overrides: Partial<ExportDraftable> = {}): ExportDraftable {
  return {
    draftableId: 9101001,
    playerId: 99101,
    displayName: "Monday Night Receiver",
    teamAbbreviation: "SEA",
    position: "WR",
    salary: 5500,
    draftGroupId: 9101,
    ...overrides,
  };
}

function baseState(): FakeState {
  const oldSlate = makeSlate();
  const featuredSlate = makeSlate({
    id: 102,
    name: "NFL Featured Main",
    label: "Featured Main",
    isMain: true,
    draftGroupId: 9202,
    gameCount: 12,
  });
  return {
    alerts: [],
    lineups: [{
      id: 801,
      slateId: oldSlate.id,
      playerIds: [501],
      playerSnapshot: null,
      status: "active",
    }],
    playerOverrides: [],
    players: [
      makePlayer(),
      makePlayer({
        id: 502,
        name: "Sunday Player",
        team: "BUF",
        position: "RB",
        draftKingsPlayerId: 9101002,
      }),
      makePlayer({
        id: 601,
        slateId: featuredSlate.id,
        name: "Featured Main Player",
        team: "BUF",
        position: "RB",
        draftKingsPlayerId: 9202001,
      }),
    ],
    props: [],
    slates: [oldSlate, featuredSlate],
  };
}

test("deleteSlateAndPlayers keeps referenced old-slate players and old export identity", async () => {
  fakeDatabase.reset(baseState());
  const storage = getStorage();
  const oldSlate = makeSlate();
  fakeDatabase.state.playerOverrides.push(
    { id: 901, slateId: oldSlate.id, playerId: 501 },
    { id: 902, slateId: oldSlate.id, playerId: 502 },
  );
  await storage.deleteSlateAndPlayers(oldSlate.id);

  const retained = fakeDatabase.state.players.find(player => player.id === 501);
  const removed = fakeDatabase.state.players.find(player => player.id === 502);
  const retainedOverride = fakeDatabase.state.playerOverrides.find(override => override.id === 901);
  const removedOverride = fakeDatabase.state.playerOverrides.find(override => override.id === 902);
  const featured = fakeDatabase.state.players.find(player => player.id === 601);
  const savedLineup = fakeDatabase.state.lineups.find(lineup => lineup.id === 801);

  assert.ok(retained, "a player referenced by a saved lineup must remain");
  assert.equal(removed, undefined, "unreferenced old-slate players can be removed");
  assert.ok(retainedOverride, "overrides for retained players must remain");
  assert.equal(removedOverride, undefined, "overrides for removed players must be deleted first");
  assert.equal(featured?.slateId, 102, "cleanup must not touch the featured group");
  assert.equal(savedLineup?.status, "review");
  assert.deepEqual(savedLineup?.playerSnapshot?.map((player: Player) => player.id), [501]);
  assert.ok(fakeDatabase.state.slates.some(slate => slate.id === oldSlate.id), "referenced source slate must remain");

  const resolved = resolvePlayersForExport({
    slate: oldSlate,
    players: [retained as Player],
    playerIds: [retained!.id],
    draftables: [
      draftable({
        draftGroupId: 9202,
        draftableId: 9202001,
        playerId: 99101,
        salary: 5000,
      }),
      draftable(),
    ],
  });

  assert.equal(resolved[0].slateId, oldSlate.id);
  assert.equal(resolved[0].draftKingsPlayerId, 9101001);
});

test("refreshPlayersByDraftKingsId updates only the requested draft-group slate", async () => {
  fakeDatabase.reset(baseState());
  const storage = await getStorage();
  const oldPlayer = makePlayer();
  const featuredBefore = fakeDatabase.state.players.find(player => player.id === 601);

  const result = await storage.refreshPlayersByDraftKingsId(101, [{
    ...oldPlayer,
    salary: 6100,
    projectedPoints: "18",
  }]);

  const refreshedOld = fakeDatabase.state.players.find(player => player.id === 501);
  const staleOld = fakeDatabase.state.players.find(player => player.id === 502);
  const featuredAfter = fakeDatabase.state.players.find(player => player.id === 601);

  assert.deepEqual(result, { updated: 1, inserted: 0, retired: 1 });
  assert.equal(refreshedOld?.salary, 6100);
  assert.equal(refreshedOld?.projectedPoints, "18");
  assert.equal(staleOld, undefined, "a complete refresh may retire an unreferenced old-slate player");
  assert.deepEqual(featuredAfter, featuredBefore, "refreshing the old group must not update the featured group");
});