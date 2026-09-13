import assert from "node:assert/strict";
import test from "node:test";
import type { Player, Slate } from "../shared/schema";
import {
  ExportResolutionError,
  resolvePlayersForExport,
  type ExportDraftable,
} from "../server/export-player-resolver";

function slate(overrides: Partial<Slate> = {}): Slate {
  return {
    id: 7,
    sport: "NBA",
    platform: "draftkings",
    name: "NBA Main",
    startTime: new Date("2025-09-12T23:00:00.000Z"),
    isMain: true,
    isActive: true,
    draftGroupId: 200,
    gameType: "Classic",
    label: "Main",
    gameCount: 1,
    contestCount: 1,
    salaryCap: 50000,
    ...overrides,
  };
}

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    slateId: 7,
    name: "Fixture Player",
    team: "BOS",
    position: "PG",
    salary: 5000,
    fppg: "20",
    projectedPoints: "25",
    opponent: "NYK",
    gameInfo: "BOS @ NYK",
    injuryStatus: null,
    injuryDetail: null,
    boostScore: null,
    boostReason: null,
    draftKingsPlayerId: 9001,
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
    draftableId: 3001,
    playerId: 9001,
    displayName: "Fixture Player",
    teamAbbreviation: "BOS",
    position: "PG",
    rosterSlotId: "UTIL",
    salary: 5000,
    ...overrides,
  };
}

function michaelWilson(overrides: Partial<Player> = {}): Player {
  return player({
    name: "Michael Wilson",
    team: "ARI",
    position: "WR",
    salary: 5300,
    ...overrides,
  });
}

function michaelWilsonDraftables(): ExportDraftable[] {
  return [
    {
      draftableId: 43727681,
      playerId: 1123529,
      displayName: "Michael Wilson",
      teamAbbreviation: "ARI",
      position: "WR",
      rosterSlotId: 68,
      salary: 5300,
      draftGroupId: 151307,
    },
    {
      draftableId: 43727682,
      playerId: 1123529,
      displayName: "Michael Wilson",
      teamAbbreviation: "ARI",
      position: "WR",
      rosterSlotId: 70,
      salary: 5300,
      draftGroupId: 151307,
    },
  ];
}

test("Classic export prefers either stored Michael Wilson contest draftable ID", () => {
  for (const storedId of [43727681, 43727682]) {
    const result = resolvePlayersForExport({
      slate: slate({
        sport: "NFL",
        draftGroupId: 151307,
      }),
      players: [michaelWilson({ draftKingsPlayerId: storedId })],
      playerIds: [1],
      draftables: michaelWilsonDraftables(),
    });

    assert.equal(result[0].draftKingsPlayerId, storedId);
  }
});

test("Classic export never uses an exact Michael Wilson row from another draft group", () => {
  assert.throws(
    () => resolvePlayersForExport({
      slate: slate({
        sport: "NFL",
        draftGroupId: 151307,
      }),
      players: [michaelWilson({ draftKingsPlayerId: 43727681 })],
      playerIds: [1],
      draftables: [
        ...michaelWilsonDraftables().map(row =>
          row.draftableId === 43727681
            ? { ...row, draftGroupId: 999999 }
            : row,
        ),
      ],
    }),
    (error: unknown) =>
      error instanceof ExportResolutionError &&
      /missing from the current contest/.test(error.message),
  );
});

test("Classic export requires identity verification before using an exact Michael Wilson row", () => {
  assert.throws(
    () => resolvePlayersForExport({
      slate: slate({
        sport: "NFL",
        draftGroupId: 151307,
      }),
      players: [michaelWilson({ draftKingsPlayerId: 43727681 })],
      playerIds: [1],
      draftables: [
        {
          ...michaelWilsonDraftables()[0],
          displayName: "Different Player",
        },
        michaelWilsonDraftables()[1],
      ],
    }),
    (error: unknown) =>
      error instanceof ExportResolutionError &&
      /missing from the current contest/.test(error.message),
  );
});

test("Showdown export still rejects equal-salary Michael Wilson CPT/FLEX alternatives", () => {
  assert.throws(
    () => resolvePlayersForExport({
      slate: slate({
        sport: "NFL",
        gameType: "Showdown",
        draftGroupId: 151307,
      }),
      players: [michaelWilson({ draftKingsPlayerId: 43727681 })],
      playerIds: [1],
      draftables: michaelWilsonDraftables(),
    }),
    (error: unknown) =>
      error instanceof ExportResolutionError &&
      /flex row .*missing|flex row .*ambiguous/i.test(error.message),
  );
});

test("legacy Michael Wilson athlete IDs remain ambiguous across equal-priced contest rows", () => {
  assert.throws(
    () => resolvePlayersForExport({
      slate: slate({
        sport: "NFL",
        draftGroupId: 151307,
      }),
      players: [michaelWilson({ draftKingsPlayerId: 1123529 })],
      playerIds: [1],
      draftables: michaelWilsonDraftables(),
    }),
    (error: unknown) =>
      error instanceof ExportResolutionError &&
      /flex row .*ambiguous/i.test(error.message),
  );
});

test("scopes live rows to the selected draft group before resolving captain and flex IDs", () => {
  const result = resolvePlayersForExport({
    slate: slate({ draftGroupId: 200 }),
    players: [player()],
    playerIds: [1],
    captainId: 1,
    draftables: [
      draftable({ draftGroupId: 100, draftableId: 1001 }),
      draftable({ draftGroupId: 200, draftableId: 2001, rosterSlotId: "CPT", salary: 7500 }),
      draftable({ draftGroupId: 200, draftableId: 2002, rosterSlotId: "UTIL", salary: 5000 }),
    ],
  });

  assert.equal(result[0].draftKingsPlayerId, 2001);
});

test("uses the lower-priced flex row and a separate captain draftable ID", () => {
  const result = resolvePlayersForExport({
    slate: slate(),
    players: [player({ id: 1, draftKingsPlayerId: 3012 }), player({ id: 2, name: "Second Player", team: "LAL", draftKingsPlayerId: 9002 })],
    playerIds: [1, 2],
    captainId: 1,
    draftables: [
      draftable({ draftableId: 3011, rosterSlotId: "CPT", salary: 7500 }),
      draftable({ draftableId: 3012, rosterSlotId: "UTIL", salary: 5000 }),
      draftable({
        draftableId: 3022,
        playerId: 9002,
        displayName: "Second Player",
        teamAbbreviation: "LAL",
        rosterSlotId: "UTIL",
        salary: 4800,
      }),
    ],
  });

  assert.deepEqual(result.map(p => p.draftKingsPlayerId), [3011, 3022]);
});

test("infers numeric CPT/FLEX slots only from a strict 1.5x salary pair", () => {
  const result = resolvePlayersForExport({
    slate: slate({ gameType: "Showdown" }),
    players: [player({ draftKingsPlayerId: 4012, position: "PG/SG" })],
    playerIds: [1],
    captainId: 1,
    draftables: [
      draftable({
        draftableId: 4011,
        playerId: 9001,
        actualPosition: "G",
        position: "G",
        rosterSlotId: 901,
        salary: 7500,
      }),
      draftable({
        draftableId: 4012,
        playerId: 9001,
        actualPosition: "G",
        position: "G",
        rosterSlotId: 902,
        salary: 5000,
      }),
    ],
  });

  assert.equal(result[0].draftKingsPlayerId, 4011);
});

test("does not guess a numeric captain from an arbitrary higher salary", () => {
  assert.throws(
    () => resolvePlayersForExport({
      slate: slate({ gameType: "Showdown" }),
      players: [player({ draftKingsPlayerId: 4042, position: "PG/SG" })],
      playerIds: [1],
      captainId: 1,
      draftables: [
        draftable({
          draftableId: 4041,
          playerId: 9001,
          actualPosition: "G",
          position: "G",
          rosterSlotId: 906,
          salary: 8000,
        }),
        draftable({
          draftableId: 4042,
          playerId: 9001,
          actualPosition: "G",
          position: "G",
          rosterSlotId: 907,
          salary: 5000,
        }),
      ],
    }),
    /captain row .*missing|ambiguous/i,
  );
});

test("accepts ingestion position aliases for NBA F and soccer positions", () => {
  const nba = resolvePlayersForExport({
    slate: slate({ gameType: "Showdown" }),
    players: [player({ draftKingsPlayerId: 4022, position: "SF/PF" })],
    playerIds: [1],
    captainId: 1,
    draftables: [
      draftable({
        draftableId: 4021,
        playerId: 9001,
        actualPosition: "F",
        position: "F",
        rosterSlotId: 903,
        salary: 7500,
      }),
      draftable({
        draftableId: 4022,
        playerId: 9001,
        actualPosition: "F",
        position: "F",
        rosterSlotId: 904,
        salary: 5000,
      }),
    ],
  });
  assert.equal(nba[0].draftKingsPlayerId, 4021);

  const soccer = resolvePlayersForExport({
    slate: slate({ sport: "SOCCER", gameType: "Classic" }),
    players: [player({ draftKingsPlayerId: 4030, position: "M" })],
    playerIds: [1],
    draftables: [
      draftable({
        draftableId: 4030,
        playerId: 9001,
        actualPosition: "MID",
        position: "MID",
        rosterSlotId: 905,
        salary: 5000,
      }),
    ],
  });
  assert.equal(soccer[0].draftKingsPlayerId, 4030);
});

test("fails clearly when the current group has no matching row", () => {
  assert.throws(
    () => resolvePlayersForExport({
      slate: slate(),
      players: [player()],
      playerIds: [1],
      draftables: [draftable({ draftGroupId: 999 })],
    }),
    (error: unknown) =>
      error instanceof ExportResolutionError &&
      error.status === 400 &&
      /missing from the current contest/.test(error.message),
  );
});

test("keeps a saved NFL extended-slate lineup on its original group after featured-main ingestion", () => {
  const oldExtendedSlate = slate({
    id: 70,
    sport: "NFL",
    name: "NFL Sunday-Monday Extended",
    label: "Sunday-Monday Extended",
    startTime: new Date("2026-09-13T17:00:00.000Z"),
    draftGroupId: 9101,
    gameCount: 14,
  });
  const featuredMainSlate = slate({
    id: 71,
    sport: "NFL",
    name: "NFL Featured Main",
    label: "Featured Main",
    startTime: new Date("2026-09-13T17:00:00.000Z"),
    draftGroupId: 9202,
    gameCount: 12,
  });
  const savedPlayer = player({
    id: 7001,
    slateId: oldExtendedSlate.id,
    name: "Monday Night Receiver",
    team: "SEA",
    position: "WR",
    salary: 5500,
    // Older saved rows can contain the stable athlete ID instead of the
    // contest-specific draftable ID.
    draftKingsPlayerId: 99101,
  });
  const oldDraftableId = 9101001;
  const featuredDraftableId = 9202001;

  const result = resolvePlayersForExport({
    slate: oldExtendedSlate,
    players: [savedPlayer],
    playerIds: [savedPlayer.id],
    draftables: [
      draftable({
        draftGroupId: featuredMainSlate.draftGroupId,
        draftableId: featuredDraftableId,
        playerId: savedPlayer.draftKingsPlayerId,
        displayName: savedPlayer.name,
        teamAbbreviation: savedPlayer.team,
        position: savedPlayer.position,
        salary: 5000,
      }),
      draftable({
        draftGroupId: oldExtendedSlate.draftGroupId,
        draftableId: oldDraftableId,
        playerId: savedPlayer.draftKingsPlayerId,
        displayName: savedPlayer.name,
        teamAbbreviation: savedPlayer.team,
        position: savedPlayer.position,
        salary: savedPlayer.salary,
      }),
    ],
  });

  assert.equal(result[0].id, savedPlayer.id);
  assert.equal(result[0].slateId, oldExtendedSlate.id);
  assert.equal(result[0].draftKingsPlayerId, oldDraftableId);
  assert.notEqual(result[0].draftKingsPlayerId, featuredDraftableId);
  // Resolving an export must not rewrite the saved player object in place.
  assert.equal(savedPlayer.draftKingsPlayerId, 99101);
});

test("does not resolve a saved old-slate player from the newly ingested featured group", () => {
  const oldExtendedSlate = slate({
    id: 72,
    sport: "NFL",
    name: "NFL Sunday-Monday Extended",
    label: "Sunday-Monday Extended",
    startTime: new Date("2026-09-13T17:00:00.000Z"),
    draftGroupId: 9303,
    gameCount: 14,
  });
  const savedPlayer = player({
    id: 7201,
    slateId: oldExtendedSlate.id,
    name: "Monday Night Receiver",
    team: "SEA",
    position: "WR",
    salary: 5500,
    draftKingsPlayerId: 99102,
  });

  assert.throws(
    () => resolvePlayersForExport({
      slate: oldExtendedSlate,
      players: [savedPlayer],
      playerIds: [savedPlayer.id],
      draftables: [
        draftable({
          draftGroupId: 9404,
          draftableId: 9404001,
          playerId: savedPlayer.draftKingsPlayerId,
          displayName: savedPlayer.name,
          teamAbbreviation: savedPlayer.team,
          position: savedPlayer.position,
        }),
      ],
    }),
    (error: unknown) =>
      error instanceof ExportResolutionError &&
      /missing from the current contest/.test(error.message),
  );
});

test("validates FanDuel IDs while allowing Yahoo's stored names", () => {
  assert.throws(
    () => resolvePlayersForExport({
      slate: slate({ platform: "fanduel" }),
      players: [player({ fanDuelPlayerId: null })],
      playerIds: [1],
    }),
    /FanDuel player ID is missing/,
  );

  const yahoo = resolvePlayersForExport({
    slate: slate({ platform: "yahoo" }),
    players: [player({ yahooPlayerId: null })],
    playerIds: [1],
  });
  assert.equal(yahoo[0].name, "Fixture Player");
});